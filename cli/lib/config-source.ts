// ============================================================
// AI API Relay — Config Source Abstraction
//
// Provides a unified interface for loading relay configuration from
// different sources: cloud API, local files, or inline config.
// ============================================================

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { ConfigSnapshot, ModelAliasConfig } from '../../src/lib/config-store/types';
import type { ProviderConfig } from '../../src/lib/providers/types';
import type { PriorityRule } from '../../src/lib/admin/priority-rules-core';

/**
 * Abstract interface for configuration sources.
 * Implementations can load config from cloud APIs, local files, or other sources.
 */
export interface ConfigSource {
  /**
   * Load the current configuration snapshot.
   * @throws Error if config cannot be loaded
   */
  load(): Promise<ConfigSnapshot>;

  /**
   * Optional: Watch for configuration changes and invoke callback.
   * Used for auto-reloading when config is updated.
   */
  watch?(callback: () => void): void;

  /**
   * Optional: Clean up resources (timers, file watchers, etc).
   * Called when the config source is no longer needed.
   */
  dispose?(): void;

  /**
   * Human-readable description of this config source.
   * Used for status display and logging.
   */
  describe(): string;
}

/**
 * Loads configuration from a cloud or local HTTP API endpoint.
 *
 * Polls the endpoint periodically (via watch()) and supports
 * optional authentication with device tokens.
 */
export class CloudConfigSource implements ConfigSource {
  private watchInterval?: NodeJS.Timeout;

  constructor(
    private readonly cloudUrl: string,
    private readonly deviceToken?: string
  ) {}

  async load(): Promise<ConfigSnapshot> {
    const url = `${this.cloudUrl}/api/local/config/snapshot`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.deviceToken) {
      headers['Authorization'] = `Bearer ${this.deviceToken}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch config from ${this.cloudUrl}: ${response.status} ${response.statusText}`
      );
    }

    const snapshot = await response.json();
    return snapshot as ConfigSnapshot;
  }

  watch(callback: () => void): void {
    // Poll every 30 seconds
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }
    this.watchInterval = setInterval(callback, 30000);
  }

  describe(): string {
    return `Cloud API (${this.cloudUrl})`;
  }

  /**
   * Stop watching for changes.
   */
  dispose(): void {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = undefined;
    }
  }
}

/**
 * File-based configuration format.
 * Simpler than ConfigSnapshot - supports only the essential fields.
 */
export interface FileConfig {
  version?: number;
  providers?: Record<string, Partial<ProviderConfig> & { apiKeys?: string[] }>;
  modelAliases?: {
    aliases?: Record<string, string>;
    hidden?: string[];
  };
  routing?: {
    strategy?: string;
    priorityRules?: PriorityRule[];
    fallbackChains?: Record<string, string[]>;
  };
}

/**
 * Transform FileConfig to ConfigSnapshot.
 * Shared utility for FileConfigSource and InlineConfigSource.
 */
export function fileConfigToSnapshot(fileConfig: Partial<FileConfig>): ConfigSnapshot {
  // Extract provider keys from provider configs
  const providerKeys: Record<string, string[]> = {};
  const providers: Record<string, ProviderConfig> = {};

  if (fileConfig.providers) {
    for (const [id, config] of Object.entries(fileConfig.providers)) {
      const { apiKeys, ...providerConfig } = config;

      // Store keys separately
      if (apiKeys && apiKeys.length > 0) {
        providerKeys[id] = apiKeys;
      }

      // Store provider config (without keys)
      providers[id] = {
        name: config.name || id,
        baseUrl: config.baseUrl || '',
        ...providerConfig,
      } as ProviderConfig;
    }
  }

  const modelAliases: ModelAliasConfig = {
    aliases: fileConfig.modelAliases?.aliases || {},
    hidden: fileConfig.modelAliases?.hidden || [],
  };

  return {
    version: fileConfig.version || 1,
    generatedAt: new Date().toISOString(),
    providers,
    providerKeys,
    modelAliases,
    priorityRules: fileConfig.routing?.priorityRules || [],
    fallbackChains: fileConfig.routing?.fallbackChains || {},
  };
}

/**
 * Loads configuration from a local JSON file.
 *
 * Supports a simplified config format and transforms it into
 * the full ConfigSnapshot structure. Watches file for changes.
 */
export class FileConfigSource implements ConfigSource {
  private watcher?: fsSync.FSWatcher;

  constructor(private readonly filePath: string) {}

  async load(): Promise<ConfigSnapshot> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const fileConfig: FileConfig = JSON.parse(content);
      return fileConfigToSnapshot(fileConfig);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Config file not found: ${this.filePath}`);
      }
      throw new Error(`Failed to load config from ${this.filePath}: ${(error as Error).message}`);
    }
  }

  watch(callback: () => void): void {
    // Watch file for changes
    if (this.watcher) {
      this.watcher.close();
    }

    // fs.watch can fire multiple times for a single change, debounce it
    let timeout: NodeJS.Timeout | undefined;
    try {
      this.watcher = fsSync.watch(this.filePath, () => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(callback, 100);
      });

      // Handle watcher errors (e.g., file deleted)
      this.watcher.on('error', (error: Error) => {
        console.error(`⚠️  Config file watcher error: ${error.message}`);
        if (this.watcher) {
          this.watcher.close();
          this.watcher = undefined;
        }
      });
    } catch (error) {
      console.error(`⚠️  Failed to watch config file: ${(error as Error).message}`);
    }
  }

  describe(): string {
    return `Local file (${this.filePath})`;
  }

  /**
   * Stop watching for changes.
   */
  dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
}

/**
 * Creates configuration from inline data (e.g., environment variables).
 *
 * Useful for quick setup without files or cloud connection.
 * Commonly used for CI/CD or simple local testing.
 */
export class InlineConfigSource implements ConfigSource {
  constructor(private readonly config: Partial<FileConfig>) {}

  async load(): Promise<ConfigSnapshot> {
    return fileConfigToSnapshot(this.config);
  }

  describe(): string {
    const sources: string[] = [];
    if (this.config.providers) {
      const providerIds = Object.keys(this.config.providers);
      sources.push(`${providerIds.length} provider(s)`);
    }
    return `Inline config (${sources.join(', ') || 'empty'})`;
  }
}

/**
 * Merges configuration from multiple sources with priority.
 *
 * Sources are merged in order (first source has highest priority).
 * Useful for layering configs: e.g., local overrides on top of cloud defaults.
 */
export class HybridConfigSource implements ConfigSource {
  constructor(private readonly sources: ConfigSource[]) {}

  async load(): Promise<ConfigSnapshot> {
    // Load all sources in parallel, ignore failures
    const results = await Promise.allSettled(
      this.sources.map(source => source.load())
    );

    const configs = results
      .filter((r): r is PromiseFulfilledResult<ConfigSnapshot> => r.status === 'fulfilled')
      .map(r => r.value);

    if (configs.length === 0) {
      throw new Error('All config sources failed to load');
    }

    // Merge configs with priority (first wins)
    return this.mergeConfigs(configs);
  }

  private mergeConfigs(configs: ConfigSnapshot[]): ConfigSnapshot {
    if (configs.length === 0) {
      throw new Error('No configs to merge');
    }

    if (configs.length === 1) {
      return configs[0];
    }

    // Start with the first config as base
    const merged: ConfigSnapshot = {
      version: configs[0].version,
      generatedAt: new Date().toISOString(),
      providers: {},
      providerKeys: {},
      modelAliases: { aliases: {}, hidden: [] },
      priorityRules: [],
      fallbackChains: {},
    };

    // Merge in reverse order (last to first) so first source wins
    // Last config provides defaults, first config overrides
    for (let i = configs.length - 1; i >= 0; i--) {
      const config = configs[i];

      // Merge providers - later iterations (lower index = higher priority) override
      Object.assign(merged.providers, config.providers);

      // Merge provider keys
      Object.assign(merged.providerKeys, config.providerKeys);

      // Merge model aliases
      Object.assign(merged.modelAliases.aliases, config.modelAliases.aliases);
      merged.modelAliases.hidden = [
        ...new Set([...merged.modelAliases.hidden, ...config.modelAliases.hidden]),
      ];

      // Merge priority rules (first source's rules take precedence)
      if (i === 0) {
        merged.priorityRules = config.priorityRules;
      }

      // Merge fallback chains
      Object.assign(merged.fallbackChains, config.fallbackChains);

      // Use highest version number
      if (config.version > merged.version) {
        merged.version = config.version;
      }
    }

    return merged;
  }

  watch(callback: () => void): void {
    // Watch all sources that support watching
    for (const source of this.sources) {
      if (source.watch) {
        source.watch(callback);
      }
    }
  }

  describe(): string {
    return this.sources.map(s => s.describe()).join(' + ');
  }

  /**
   * Dispose all sources that support disposal.
   */
  dispose(): void {
    for (const source of this.sources) {
      if ('dispose' in source && typeof source.dispose === 'function') {
        source.dispose();
      }
    }
  }
}
