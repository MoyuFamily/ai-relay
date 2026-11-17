// ============================================================
// AI Relay — Postgres Config Store (for VPS deployment)
// ============================================================

import type { ConfigStore, ModelAliasConfig } from './types';
import type { ProviderConfig } from '../providers/types';
import type { PriorityRule } from '../admin/priority-rules-core';

export class PostgresConfigStore implements ConfigStore {
  private connectionString: string;

  constructor(connectionString?: string) {
    this.connectionString = connectionString || process.env.DATABASE_URL || '';
  }

  async getProviders(): Promise<Record<string, ProviderConfig>> {
    // Graceful fallback until Postgres config tables are populated:
    // return empty custom provider map so static/env providers keep working.
    return {};
  }

  async getProviderKeys(_provider: string): Promise<string[] | null> {
    return null;
  }

  async getProviderKeysVersion(_provider: string): Promise<number> {
    return 0;
  }

  async getModelAliases(): Promise<ModelAliasConfig> {
    return { aliases: {}, hidden: [] };
  }

  async getPriorityRules(): Promise<PriorityRule[]> {
    return [];
  }

  async getFallbackChain(_provider: string, staticFallbacks?: string[] | string): Promise<string[]> {
    if (!staticFallbacks) return [];
    return Array.isArray(staticFallbacks) ? staticFallbacks : [staticFallbacks];
  }

  async getConfigVersion(): Promise<number> {
    return 0;
  }
}
