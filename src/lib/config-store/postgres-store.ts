// ============================================================
// AI Relay — Postgres Config Store (for Self-Hosted / VPS)
// ============================================================
// Persists runtime overrides (custom providers, managed keys,
// model aliases, priority rules, fallback chains, monotonic
// config versions) in PostgreSQL `kv_store` via admin-config's
// PostgresKVAdapter while preserving graceful fallback when DB
// is temporarily unavailable.

import type { ConfigStore, ModelAliasConfig } from './types';
import type { ProviderConfig } from '../providers/types';
import type { PriorityRule } from '../admin/priority-rules-core';
import {
  getCustomProviders,
  getManagedKeys,
  getManagedKeysVersion,
  getGlobalConfigVersion,
  getModelAliasConfig,
  getPriorityRules as getAdminPriorityRules,
  getFallbackChain as getAdminFallbackChain,
} from '../admin/admin-config';

export class PostgresConfigStore implements ConfigStore {
  readonly connectionString: string;

  constructor(connectionString?: string) {
    this.connectionString = connectionString || process.env.DATABASE_URL || '';
  }

  async getProviders(forceRefresh = false): Promise<Record<string, ProviderConfig>> {
    return await getCustomProviders(forceRefresh);
  }

  async getProviderKeys(
    provider: string,
    forceRefresh = false,
    options?: { throwOnError?: boolean }
  ): Promise<string[] | null> {
    return await getManagedKeys(provider, forceRefresh, options);
  }

  async getProviderKeysVersion(
    provider: string,
    options?: { forceRefresh?: boolean; throwOnError?: boolean }
  ): Promise<number> {
    return await getManagedKeysVersion(provider, options);
  }

  async getModelAliases(forceRefresh = false): Promise<ModelAliasConfig> {
    return await getModelAliasConfig(forceRefresh);
  }

  async getPriorityRules(forceRefresh = false): Promise<PriorityRule[]> {
    return await getAdminPriorityRules(forceRefresh);
  }

  async getFallbackChain(provider: string, staticFallbacks?: string[] | string): Promise<string[]> {
    return await getAdminFallbackChain(provider, staticFallbacks);
  }

  async getConfigVersion(): Promise<number> {
    return await getGlobalConfigVersion();
  }
}
