// ============================================================
// AI API Relay — Provider Resolver
// ============================================================

import type { ProviderConfig } from './types';
import { PROVIDERS } from './registry';
import { getDefaultConfigStore } from '../config-store';
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
    const store = getDefaultConfigStore();
    const config = await store.getModelAliases();
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
    const store = getDefaultConfigStore();
    const custom = await store.getProviders(forceRefresh);
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
    cachedProviders = cachedProviders ?? { ...PROVIDERS };
    cacheTimestamp = now;
    return cachedProviders;
  }
}

export function clearProvidersCache(): void {
  cachedProviders = null;
  cacheTimestamp = 0;
}

/**
 * Whether a provider can serve the given (already alias-resolved, lower-cased)
 * model. Mirrors the matching used by resolveProvider: an exact model-id match
 * in the provider's `models` list, or a prefix match against `modelPrefixes`
 * (wildcard prefixes end with -/./_; otherwise the prefix must equal the model).
 *
 * Used by smart routing to restrict the candidate pool to providers that
 * actually support the requested model, rather than every configured provider.
 */
export function providerSupportsModel(provider: ProviderConfig, lowerModel: string): boolean {
  if (provider.models) {
    for (const m of provider.models) {
      if (m.id && m.id.toLowerCase() === lowerModel) return true;
    }
  }
  for (const prefix of provider.modelPrefixes) {
    const isWildcard = prefix.endsWith('-') || prefix.endsWith('.') || prefix.endsWith('_');
    if (isWildcard) {
      if (lowerModel.startsWith(prefix)) return true;
    } else if (lowerModel === prefix) {
      return true;
    }
  }
  return false;
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
    const store = getDefaultConfigStore();
    const priorityRule = findMatchingPriorityRule(await store.getPriorityRules(), lowerModel);
    if (priorityRule) {
      const preferred = priorityRule.providerOrder.find((providerName) => allProviders[providerName]);
      if (preferred) return allProviders[preferred];
    }
  } catch {
    // Priority rules are an admin override. If KV/config is unavailable, fall back to legacy prefix matching.
  }

  const sortedForExact = Object.values(allProviders).sort((a, b) => {
    const aCustom = a.isCustom ? 1 : 0;
    const bCustom = b.isCustom ? 1 : 0;
    return bCustom - aCustom;
  });

  for (const provider of sortedForExact) {
    if (provider.models) {
      for (const m of provider.models) {
        if (m.id && m.id.toLowerCase() === lowerModel) {
          return provider;
        }
      }
    }
  }

  for (const provider of Object.values(allProviders)) {
    for (const prefix of provider.modelPrefixes) {
      const isWildcard = prefix.endsWith('-') || prefix.endsWith('.') || prefix.endsWith('_');
      if (isWildcard) {
        if (lowerModel.startsWith(prefix)) {
          if (prefix.length > longestPrefixLength) {
            longestPrefixLength = prefix.length;
            bestProvider = provider;
          }
        }
      } else {
        if (lowerModel === prefix) {
          if (prefix.length > longestPrefixLength) {
            longestPrefixLength = prefix.length;
            bestProvider = provider;
          }
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

/**
 * Normalize an Anthropic provider base URL into one safe to append `/messages`
 * (and `/messages/count_tokens`) to.
 *
 * Anthropic's API contract is unambiguous: the endpoint is always
 * `/v1/messages`. But base URLs arrive from many sources — built-in registry,
 * provider templates, cc-switch imports, the admin "custom provider" form — and
 * not all of them include the `/v1` prefix (the anthropic provider templates
 * store a bare `https://api.anthropic.com`, and cc-switch deep links carry a
 * bare origin because the Claude CLI normally appends `/v1/messages` itself). A
 * bare origin like `https://sub.100xlabs.space` would otherwise build
 * `https://sub.100xlabs.space/messages`, which on SPA-backed gateways 200s with
 * the site's index.html instead of the API, and the client fails to parse it.
 *
 * Rule: if the base has no path (just an origin, or a trailing `/`), default it
 * to `/v1`. Any base that already carries a path (`/v1`, `/v1beta`, `/v2`, …) is
 * left untouched. Trailing slashes are always stripped. Mirrors
 * normalizeImportedBaseUrl so configured and imported providers behave alike.
 *
 * This is intentionally NOT applied to OpenAI-format providers: a bare base for
 * an OpenAI-compatible gateway (NewAPI et al.) is genuinely ambiguous — the API
 * may live at the root or under `/v1` — so we leave those untouched and let the
 * key-test route probe both candidates (see getFallbackOpenAIUrl).
 */
export function normalizeUpstreamBase(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    if (!url.pathname || url.pathname === '/') {
      url.pathname = '/v1';
      return url.toString().replace(/\/+$/, '');
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function resolveProviderBase(provider: ProviderConfig): string {
  const customBase = provider.envBaseUrlField
    ? process.env[provider.envBaseUrlField]
    : undefined;
  return customBase || provider.baseUrl;
}

export function getUpstreamUrl(provider: ProviderConfig): string {
  const base = resolveProviderBase(provider);

  if (provider.headerFormat === 'anthropic') {
    return `${normalizeUpstreamBase(base)}/messages`;
  }
  return `${base}/chat/completions`;
}

/**
 * Get the upstream URL for an Anthropic provider's token-counting endpoint.
 * Only Anthropic-format upstreams expose /messages/count_tokens; for any other
 * format we have no real endpoint to forward to (callers fall back to a local
 * estimate instead). Throws for non-Anthropic providers.
 */
export function getUpstreamCountTokensUrl(provider: ProviderConfig): string {
  if (provider.headerFormat !== 'anthropic') {
    throw new Error(
      `count_tokens is only supported for Anthropic-format providers (${provider.displayName}).`
    );
  }
  return `${normalizeUpstreamBase(resolveProviderBase(provider))}/messages/count_tokens`;
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
  const base = resolveProviderBase(provider);
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

    default:
      // Fallback: use the first model ID in the provider's model list if available
      if (targetProvider && targetProvider.models && targetProvider.models.length > 0) {
        return targetProvider.models[0].id;
      }
      return originalModel;
  }
}
