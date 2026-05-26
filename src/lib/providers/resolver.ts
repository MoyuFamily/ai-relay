// ============================================================
// AI API Relay — Provider Resolver
// ============================================================

import type { ProviderConfig } from './types';
import { PROVIDERS } from './registry';
import { getCustomProviders, getModelAliasConfig, getPriorityRules } from '../admin/admin-config';
import { findMatchingPriorityRule } from '../admin/priority-rules-core';

/**
 * Model alias mapping — lets users request common names that get
 * transparently rewritten to the actual upstream model ID.
 */
const MODEL_ALIASES: Record<string, string> = {
  'gpt-best': 'gpt-5.5',
  'gpt-latest': 'gpt-5.4',
  'gpt-fast': 'gpt-5.4-mini',
  'gpt-cheap': 'gpt-5.4-nano',
  'claude-best': 'claude-opus-4-7',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-fast': 'claude-haiku-4-5-20251001',
  'deepseek-fast': 'deepseek-v4-flash',
  'deepseek-pro': 'deepseek-v4-pro',
};

/**
 * Resolve a model alias to its actual model name.
 * Returns the original name if no alias exists.
 */
export async function resolveModelAlias(model: string, forceRefresh = false): Promise<string> {
  const original = model;
  let requested = model.toLowerCase();
  const seen = new Set<string>();
  try {
    const config = await getModelAliasConfig(forceRefresh);
    for (let depth = 0; depth < 5; depth++) {
      if (seen.has(requested)) return original;
      seen.add(requested);
      const next = config.aliases[requested] || MODEL_ALIASES[requested];
      if (!next) return depth === 0 ? original : requested;
      requested = next.toLowerCase();
    }
    return original;
  } catch {
    return MODEL_ALIASES[requested] || model;
  }
}

/**
 * Resolve which provider a model name belongs to.
 * Automatically resolves aliases before matching.
 * Returns null if no provider matches.
 */
let cachedProviders: Record<string, ProviderConfig> | null = null;
let cacheTimestamp = 0;

export async function getAllProviders(forceRefresh = false): Promise<Record<string, ProviderConfig>> {
  const now = Date.now();
  if (!forceRefresh && cachedProviders && now - cacheTimestamp < 5000) {
    return cachedProviders;
  }
  try {
    const custom = await getCustomProviders(forceRefresh);
    const merged = { ...PROVIDERS };
    for (const [name, config] of Object.entries(custom)) {
      merged[name] = {
        ...config,
        isCustom: true,
      };
    }
    cachedProviders = merged;
    cacheTimestamp = now;
    return merged;
  } catch (err) {
    console.error('[getAllProviders] Error loading custom providers:', err);
    return PROVIDERS;
  }
}

export function clearProvidersCache(): void {
  cachedProviders = null;
  cacheTimestamp = 0;
}

/**
 * Resolve which provider a model name belongs to.
 * Automatically resolves aliases before matching.
 * Returns null if no provider matches.
 */
export async function resolveProvider(model: string): Promise<ProviderConfig | null> {
  const resolved = await resolveModelAlias(model);
  const lowerModel = resolved.toLowerCase();
  let bestProvider: ProviderConfig | null = null;
  let longestPrefixLength = 0;

  const allProviders = await getAllProviders();
  try {
    const priorityRule = findMatchingPriorityRule(await getPriorityRules(), lowerModel);
    if (priorityRule) {
      const preferred = priorityRule.providerOrder.find((providerName) => allProviders[providerName]);
      if (preferred) return allProviders[preferred];
    }
  } catch {
    // Priority rules are an admin override. If KV/config is unavailable, fall back to legacy prefix matching.
  }

  for (const provider of Object.values(allProviders)) {
    for (const prefix of provider.modelPrefixes) {
      if (lowerModel.startsWith(prefix)) {
        if (prefix.length > longestPrefixLength) {
          longestPrefixLength = prefix.length;
          bestProvider = provider;
        }
      }
    }
  }
  return bestProvider;
}

/**
 * Get the upstream URL for a provider's chat completions endpoint.
 */
/**
 * Resolve the upstream model ID for a provider.
 * If the provider has a modelMapping, the user-facing model name is
 * translated to the real upstream model ID. Otherwise, returns as-is.
 */
export function resolveUpstreamModel(model: string, provider: ProviderConfig): string {
  if (provider.modelMapping) {
    const mapped = provider.modelMapping[model] || provider.modelMapping[model.toLowerCase()];
    if (mapped) return mapped;
  }
  return model;
}

export function getUpstreamUrl(provider: ProviderConfig): string {
  const customBase = provider.envBaseUrlField
    ? process.env[provider.envBaseUrlField]
    : undefined;
  const base = customBase || provider.baseUrl;

  if (provider.headerFormat === 'anthropic') {
    return `${base}/messages`;
  }
  return `${base}/chat/completions`;
}

/**
 * Get the upstream URL for a provider's responses endpoint.
 * Returns /responses path for OpenAI-compatible providers.
 * Throws for Anthropic (Responses API is OpenAI-only).
 */
export function getUpstreamResponsesUrl(provider: ProviderConfig): string {
  if (provider.headerFormat === 'anthropic') {
    throw new Error(
      `Responses API is not supported for Anthropic-format providers (${provider.displayName}). ` +
      `Only OpenAI-compatible providers support /v1/responses.`
    );
  }
  const customBase = provider.envBaseUrlField
    ? process.env[provider.envBaseUrlField]
    : undefined;
  const base = customBase || provider.baseUrl;
  return `${base}/responses`;
}

/**
 * Resolves a model ID suitable for the fallback provider based on the original model ID.
 * Maps reasoning models to reasoning models, cheap models to cheap models, and standard models to standard models.
 */
export async function resolveFallbackModel(originalModel: string, targetProviderName: string): Promise<string> {
  const lowerModel = originalModel.toLowerCase();
  const allProviders = await getAllProviders();
  const targetProvider = allProviders[targetProviderName];

  // 1. If the original model already starts with one of the target provider's prefixes,
  // we can use the original model directly.
  if (targetProvider) {
    for (const prefix of targetProvider.modelPrefixes) {
      if (lowerModel.startsWith(prefix)) {
        return originalModel;
      }
    }
  }

  // 2. Otherwise, map based on the target provider
  switch (targetProviderName) {
    case 'deepseek':
      // Map reasoning models to DeepSeek V4 Pro, others to DeepSeek V4 Flash
      if (
        lowerModel.includes('gpt-5.5') ||
        lowerModel.includes('reasoner') ||
        lowerModel.includes('r1')
      ) {
        return 'deepseek-v4-pro';
      }
      return 'deepseek-v4-flash';

    case 'xiaomi_sgp_coding':
      // SGP has both mimo-v2.5-pro-sgp and mimo-v2.5-flash-sgp
      if (
        lowerModel.includes('mini') ||
        lowerModel.includes('haiku') ||
        lowerModel.includes('flash') ||
        lowerModel.includes('3.5-turbo')
      ) {
        return 'mimo-v2.5-flash-sgp';
      }
      if (lowerModel.includes('mimo-v2.5') && !lowerModel.includes('pro')) {
        return 'mimo-v2.5-sgp';
      }
      return 'mimo-v2.5-pro-sgp';

    case 'xiaomi':
      if (lowerModel.includes('mimo-v2.5') && !lowerModel.includes('pro')) {
        return 'mimo-v2.5';
      }
      return 'mimo-v2.5-pro';

    case 'xiaomi_coding':
      if (lowerModel.includes('mimo-v2.5') && !lowerModel.includes('pro')) {
        return 'mimo-v2.5-coding';
      }
      return 'mimo-v2.5-pro-coding';

    case 'xiaomi_tudo':
      if (lowerModel.includes('mimo-v2.5') && !lowerModel.includes('pro')) {
        return 'mimo-v2.5';
      }
      return 'mimo-v2.5-pro';

    case 'openai':
      if (
        lowerModel.includes('gpt-5.5') ||
        lowerModel.includes('reasoner')
      ) {
        return 'gpt-5.5';
      }
      if (lowerModel.includes('nano')) {
        return 'gpt-5.4-nano';
      }
      if (
        lowerModel.includes('mini') ||
        lowerModel.includes('haiku') ||
        lowerModel.includes('flash')
      ) {
        return 'gpt-5.4-mini';
      }
      return 'gpt-5.4';

    case 'anthropic':
      if (
        lowerModel.includes('mini') ||
        lowerModel.includes('haiku') ||
        lowerModel.includes('flash') ||
        lowerModel.includes('nano')
      ) {
        return 'claude-haiku-4-5-20251001';
      }
      return 'claude-sonnet-4-6';

    case 'lpgpt':
      return 'gpt-5.4';

    default:
      // Fallback: use the first model ID in the provider's model list if available
      if (targetProvider && targetProvider.models && targetProvider.models.length > 0) {
        return targetProvider.models[0].id;
      }
      return originalModel;
  }
}
