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
  'gpt-best': 'gpt-6.2-astra',
  'gpt-latest': 'gpt-6.2-sol',
  'gpt-fast': 'gpt-6-luna',
  'claude-best': 'claude-fable-5-2',
  'claude-opus': 'claude-opus-5-5',
  'claude-sonnet': 'claude-sonnet-5-5',
  'claude-fast': 'claude-haiku-5-5',
  'gemini-best': 'gemini-4-neon',
  'gemini-latest': 'gemini-4-argon',
  'gemini-fast': 'gemini-4-hydrogen',
  'deepseek-fast': 'deepseek-flash',
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
const sharedProvidersCache: {
  providers: Record<string, ProviderConfig> | null;
  timestamp: number;
} = ((globalThis as any).__aiRelayProvidersCache ??= {
  providers: null,
  timestamp: 0,
});

export async function getAllProviders(forceRefresh = false): Promise<Record<string, ProviderConfig>> {
  const now = Date.now();
  if (!forceRefresh && sharedProvidersCache.providers && now - sharedProvidersCache.timestamp < 5000) {
    return sharedProvidersCache.providers;
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
    sharedProvidersCache.providers = merged;
    sharedProvidersCache.timestamp = now;
    return merged;
  } catch (err) {
    console.error('[getAllProviders] Error loading custom providers:', err);
    sharedProvidersCache.providers = sharedProvidersCache.providers ?? { ...PROVIDERS };
    sharedProvidersCache.timestamp = now;
    return sharedProvidersCache.providers;
  }
}

export function clearProvidersCache(): void {
  sharedProvidersCache.providers = null;
  sharedProvidersCache.timestamp = 0;
}

/**
 * Whether a provider can serve the given (already alias-resolved, lower-cased)
 * model. Mirrors the matching used by resolveProvider: an exact model-id match
 * in the provider's `models` list, or a prefix match against `modelPrefixes`
 * (wildcard prefixes end with -/./_///:; otherwise the prefix must equal the model).
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
    const lowerPrefix = prefix.toLowerCase();
    const isWildcard =
      lowerPrefix.endsWith('-') ||
      lowerPrefix.endsWith('.') ||
      lowerPrefix.endsWith('_') ||
      lowerPrefix.endsWith('/') ||
      lowerPrefix.endsWith(':');
    if (isWildcard) {
      if (lowerModel.startsWith(lowerPrefix)) return true;
    } else if (lowerModel === lowerPrefix) {
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
      const lowerPrefix = prefix.toLowerCase();
      const isWildcard =
        lowerPrefix.endsWith('-') ||
        lowerPrefix.endsWith('.') ||
        lowerPrefix.endsWith('_') ||
        lowerPrefix.endsWith('/') ||
        lowerPrefix.endsWith(':');
      if (isWildcard) {
        if (lowerModel.startsWith(lowerPrefix)) {
          if (lowerPrefix.length > longestPrefixLength) {
            longestPrefixLength = lowerPrefix.length;
            bestProvider = provider;
          }
        }
      } else {
        if (lowerModel === lowerPrefix) {
          if (lowerPrefix.length > longestPrefixLength) {
            longestPrefixLength = lowerPrefix.length;
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
      if (
        lowerModel.includes('astra') ||
        lowerModel.includes('fable') ||
        lowerModel.includes('opus') ||
        lowerModel.includes('neon') ||
        lowerModel.includes('pro') ||
        lowerModel.includes('reasoner')
      ) {
        return 'deepseek-v4-pro';
      }
      return 'deepseek-flash';

    case 'google':
      if (
        lowerModel.includes('luna') ||
        lowerModel.includes('haiku') ||
        lowerModel.includes('flash') ||
        lowerModel.includes('hydrogen') ||
        lowerModel.includes('mini')
      ) {
        return 'gemini-4-hydrogen';
      }
      if (
        lowerModel.includes('astra') ||
        lowerModel.includes('fable') ||
        lowerModel.includes('opus') ||
        lowerModel.includes('pro')
      ) {
        return 'gemini-4-neon';
      }
      return 'gemini-4-argon';

    case 'openrouter':
      if (
        lowerModel.includes('luna') ||
        lowerModel.includes('haiku') ||
        lowerModel.includes('flash') ||
        lowerModel.includes('hydrogen') ||
        lowerModel.includes('mini')
      ) {
        return 'openai/gpt-6-luna';
      }
      return 'anthropic/claude-sonnet-5-5';

    case 'xiaomi_sgp_coding':
      if (lowerModel.includes('flash') || lowerModel.includes('luna') || lowerModel.includes('haiku')) {
        return 'mimo-v2.6-flash-sgp';
      }
      return 'mimo-v2.6-pro-sgp';

    case 'xiaomi':
      if (lowerModel.includes('flash') || lowerModel.includes('luna') || lowerModel.includes('haiku')) {
        return 'mimo-v2.6-flash';
      }
      return 'mimo-v2.6-pro';

    case 'xiaomi_coding':
      if (lowerModel.includes('flash') || lowerModel.includes('luna') || lowerModel.includes('haiku')) {
        return 'mimo-v2.6-flash-coding';
      }
      return 'mimo-v2.6-pro-coding';

    case 'openai':
      if (
        lowerModel.includes('astra') ||
        lowerModel.includes('fable') ||
        lowerModel.includes('opus') ||
        lowerModel.includes('neon') ||
        lowerModel.includes('pro')
      ) {
        return 'gpt-6.2-astra';
      }
      if (
        lowerModel.includes('luna') ||
        lowerModel.includes('haiku') ||
        lowerModel.includes('flash') ||
        lowerModel.includes('hydrogen') ||
        lowerModel.includes('mini')
      ) {
        return 'gpt-6-luna';
      }
      return 'gpt-6.2-sol';

    case 'anthropic':
      if (
        lowerModel.includes('luna') ||
        lowerModel.includes('haiku') ||
        lowerModel.includes('flash') ||
        lowerModel.includes('hydrogen') ||
        lowerModel.includes('mini')
      ) {
        return 'claude-haiku-5-5';
      }
      if (
        lowerModel.includes('astra') ||
        lowerModel.includes('fable') ||
        lowerModel.includes('neon') ||
        lowerModel.includes('opus') ||
        lowerModel.includes('pro')
      ) {
        return 'claude-opus-5-5';
      }
      return 'claude-sonnet-5-5';

    default:
      // Fallback: use the first model ID in the provider's model list if available
      if (targetProvider && targetProvider.models && targetProvider.models.length > 0) {
        return targetProvider.models[0].id;
      }
      return originalModel;
  }
}
