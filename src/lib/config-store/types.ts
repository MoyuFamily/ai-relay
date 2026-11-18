// ============================================================
// AI API Relay — Config Store Interface
// ============================================================

import type { ProviderConfig } from '../providers/types';
import type { PriorityRule } from '../admin/priority-rules-core';

export interface ModelAliasConfig {
  aliases: Record<string, string>;
  hidden: string[];
}

export interface ConfigStore {
  getProviders(forceRefresh?: boolean): Promise<Record<string, ProviderConfig>>;
  getProviderKeys(provider: string, forceRefresh?: boolean, options?: { throwOnError?: boolean }): Promise<string[] | null>;
  getProviderKeysVersion?(provider: string, options?: { forceRefresh?: boolean; throwOnError?: boolean }): Promise<number>;
  getModelAliases(forceRefresh?: boolean): Promise<ModelAliasConfig>;
  getPriorityRules(forceRefresh?: boolean): Promise<PriorityRule[]>;
  getFallbackChain(provider: string, staticFallbacks?: string[] | string): Promise<string[]>;
  getConfigVersion(): Promise<number>;
}

export interface ConfigSnapshot {
  version: number;
  generatedAt: string;
  providers: Record<string, ProviderConfig>;
  providerKeys: Record<string, string[]>;
  modelAliases: ModelAliasConfig;
  priorityRules: PriorityRule[];
  fallbackChains: Record<string, string[]>;
}
