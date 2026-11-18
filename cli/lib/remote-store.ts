// ============================================================
// AI Relay Local Runtime — Remote Config Store
// ============================================================

import type { ConfigStore, ConfigSnapshot, ModelAliasConfig } from '../../src/lib/config-store/types';
import type { ProviderConfig } from '../../src/lib/providers/types';
import type { PriorityRule } from '../../src/lib/admin/priority-rules-core';
import Database from 'better-sqlite3';

export class RemoteConfigStore implements ConfigStore {
  private db: Database.Database;
  private cloudUrl: string;
  private deviceToken: string;

  constructor(cloudUrl: string, deviceToken: string, dbPath: string) {
    this.cloudUrl = cloudUrl;
    this.deviceToken = deviceToken;
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  }

  async sync(): Promise<void> {
    const response = await fetch(`${this.cloudUrl}/api/local/config/snapshot`, {
      headers: {
        'Authorization': `Bearer ${this.deviceToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Config sync failed: ${response.status}`);
    }

    const snapshot: ConfigSnapshot = await response.json();

    const stmt = this.db.prepare(`
      INSERT INTO config_snapshots (version, snapshot_json, applied_at)
      VALUES (?, ?, ?)
    `);

    stmt.run(
      snapshot.version,
      JSON.stringify(snapshot),
      new Date().toISOString()
    );
  }

  private getLatestSnapshot(): ConfigSnapshot | null {
    const stmt = this.db.prepare(`
      SELECT snapshot_json FROM config_snapshots
      ORDER BY applied_at DESC LIMIT 1
    `);
    const row = stmt.get() as any;
    if (!row) return null;
    return JSON.parse(row.snapshot_json);
  }

  async getProviders(): Promise<Record<string, ProviderConfig>> {
    const snapshot = this.getLatestSnapshot();
    return snapshot?.providers || {};
  }

  async getProviderKeys(provider: string): Promise<string[] | null> {
    const snapshot = this.getLatestSnapshot();
    return snapshot?.providerKeys[provider] || null;
  }

  async getModelAliases(): Promise<ModelAliasConfig> {
    const snapshot = this.getLatestSnapshot();
    return snapshot?.modelAliases || { aliases: {}, hidden: [] };
  }

  async getPriorityRules(): Promise<PriorityRule[]> {
    const snapshot = this.getLatestSnapshot();
    return snapshot?.priorityRules || [];
  }

  async getFallbackChain(provider: string, staticFallbacks?: string[] | string): Promise<string[]> {
    const snapshot = this.getLatestSnapshot();
    const cloudChain = snapshot?.fallbackChains[provider] || [];
    if (cloudChain.length > 0) return cloudChain;

    // Fallback to static config
    if (!staticFallbacks) return [];
    return Array.isArray(staticFallbacks) ? staticFallbacks : [staticFallbacks];
  }

  async getConfigVersion(): Promise<number> {
    const snapshot = this.getLatestSnapshot();
    return snapshot?.version || 0;
  }

  close() {
    this.db.close();
  }
}
