// ============================================================
// AI API Relay — Core Relay Logic (with 429 protection)
// ============================================================

import type { AnthropicMessagesRequest, ChatCompletionRequest, ResponsesAPIRequest } from '../types';
import type { RelayResult, ProviderConfig, ApiKey } from '../providers/types';
import { resolveProvider, getUpstreamUrl, getUpstreamResponsesUrl, resolveModelAlias, resolveFallbackModel, resolveUpstreamModel, getAllProviders } from '../providers';
import { selectKey, markCooldown, getKeyPool } from './key-pool';
import { buildHeaders, transformToAnthropic } from './transform';
import { RelayError } from '../errors';
import { KVUsageStorage } from '../usage/storage/kv-storage';
import { createUsageStorage } from '../usage/factory';
import {
  checkRateLimit,
  record429,
  recordSuccess,
  backoffSleep,
} from './rate-limiter';
import { withConcurrency } from './concurrency';
import { smartRoute, recordProviderResult, isSmartRoutingConfigured } from '../smart-routing';
import { isCloudflareSync } from '../cf-env';

// Resolve usage/error storage per call instead of caching at module scope:
// on Cloudflare Workers, D1 bindings come from request-scoped AsyncLocalStorage
// (`getCloudflareContext()`), so reusing a D1UsageStorage across requests would
// violate workerd's cross-request I/O isolation.
async function getErrorStorage() {
  try {
    return await createUsageStorage();
  } catch {
    return new KVUsageStorage();
  }
}

async function cancelResponseBody(response: Response | null | undefined): Promise<void> {
  try {
    if (response?.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
  } catch {
    // Ignore already-consumed or mocked response streams
  }
}

type RelayApiType = 'chat' | 'responses' | 'anthropicMessages';
type RelayRequestBody = ChatCompletionRequest | ResponsesAPIRequest | AnthropicMessagesRequest;

/**
 * Whether the original request text can be forwarded upstream byte-for-byte
 * instead of re-serializing the (possibly transformed) request body.
 *
 * Raw forwarding is the Cloudflare CPU optimization: it skips a JSON.stringify
 * of large request bodies. It is ONLY safe when the outgoing body is provably
 * semantically identical to the original request text — i.e. nothing rewrote
 * the body. The body IS rewritten (→ not eligible) when any of:
 *   - `modelChanged`: the upstream model differs from the requested one
 *     (alias resolution, virtual→real model mapping, or fallback override), or
 *   - `injectStreamOptions`: stream_options.include_usage was injected
 *     (chat / non-anthropic / non-CF streaming), or
 *   - chat → Anthropic transform (`apiType === 'chat' && isAnthropicProvider`,
 *     via transformToAnthropic), or
 *   - anthropicMessages → OpenAI transform (`apiType === 'anthropicMessages' &&
 *     !isAnthropicProvider`, via transformAnthropicToOpenAI).
 *
 * The anthropicMessages→anthropic and responses paths only swap the model, so
 * an unchanged model there leaves the body byte-identical and forwardable.
 *
 * Exported for direct unit testing of each disable condition.
 */
export function isRawForwardEligible(input: {
  apiType: RelayApiType;
  isAnthropicProvider: boolean;
  modelChanged: boolean;
  injectStreamOptions: boolean;
}): boolean {
  const { apiType, isAnthropicProvider, modelChanged, injectStreamOptions } = input;
  const bodyRewritten =
    modelChanged ||
    injectStreamOptions ||
    (apiType === 'chat' && isAnthropicProvider) ||
    (apiType === 'anthropicMessages' && !isAnthropicProvider);
  return !bodyRewritten;
}

const BROWSER_COMPAT_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0',
];
const DEFAULT_SERVERLESS_UPSTREAM_TIMEOUT_MS = 50_000;
const DEFAULT_SELF_HOSTED_UPSTREAM_TIMEOUT_MS = 300_000;

class UpstreamTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Upstream request timed out after ${timeoutMs}ms`);
    this.name = 'UpstreamTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function getDefaultUpstreamTimeoutMs(): number {
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.CF_PAGES || isCloudflareSync()) {
    return DEFAULT_SERVERLESS_UPSTREAM_TIMEOUT_MS;
  }
  return DEFAULT_SELF_HOSTED_UPSTREAM_TIMEOUT_MS;
}

function getUpstreamTimeoutMs(): number {
  const defaultTimeout = getDefaultUpstreamTimeoutMs();
  const raw = process.env.RELAY_UPSTREAM_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return defaultTimeout;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultTimeout;
  if (parsed <= 0) return 0;
  return Math.max(1_000, Math.floor(parsed));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getUserAgentCandidates(provider: ProviderConfig): Array<string | undefined> {
  const candidates: Array<string | undefined> = [
    provider.userAgent?.trim() || undefined,
    undefined,
    ...BROWSER_COMPAT_USER_AGENTS,
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate || '__client_or_default_sdk__';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldRetryWithAlternateUserAgent(response: Response): boolean {
  const contentType = typeof response?.headers?.get === 'function'
    ? (response.headers.get('content-type') || '')
    : '';
  return contentType.includes('text/html');
}

async function fetchUpstreamWithUserAgentCandidates(input: {
  provider: ProviderConfig;
  apiKey: string;
  isStream: boolean;
  clientUserAgent?: string;
  url: string;
  body: unknown;
  // When the request body is forwarded unchanged (no model rewrite /
  // transform / stream_options injection), the caller passes the original
  // request text here so we can skip a costly re-serialization of large
  // bodies. Falls back to JSON.stringify when absent. See tryProviderWithRetries.
  rawPayload?: string;
  passthroughHeaders?: Record<string, string>;
}): Promise<Response> {
  const payload = input.rawPayload ?? JSON.stringify(input.body);
  let lastResponse: Response | null = null;
  const timeoutMs = getUpstreamTimeoutMs();

  const uaCandidates = getUserAgentCandidates(input.provider);

  for (let idx = 0; idx < uaCandidates.length; idx++) {
    const customUserAgent = uaCandidates[idx];
    const controller = timeoutMs > 0 ? new AbortController() : null;
    let timedOut = false;
    const timer = controller
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

    let response: Response;
    try {
      response = await fetch(input.url, {
        method: 'POST',
        headers: buildHeaders(input.provider.headerFormat, input.apiKey, input.isStream, input.clientUserAgent, customUserAgent, input.passthroughHeaders),
        body: payload,
        signal: controller?.signal,
      });
    } catch (error) {
      if (timedOut || isAbortError(error)) {
        throw new UpstreamTimeoutError(timeoutMs);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }

    lastResponse = response;
    if (!shouldRetryWithAlternateUserAgent(response)) {
      return response;
    }
    // Release socket before retrying with the next User-Agent candidate
    // (skip on the final candidate so the caller can still inspect lastResponse).
    if (idx < uaCandidates.length - 1) {
      await cancelResponseBody(response);
    }
  }

  return lastResponse!;
}

/**
 * Record an upstream error to KV for admin dashboard tracking.
 * Fire-and-forget — never blocks the request.
 */
function recordError(
  provider: string,
  keyHash: string,
  statusCode: number,
  reason: string
): Promise<void> {
  return getErrorStorage().then(s => s.recordError({ provider, keyHash, statusCode, reason }));
}

/**
 * Core relay function — forwards a request to the upstream provider.
 * Supports both streaming and non-streaming, and both Chat Completions and Responses API.
 *
 * 429 protection layers:
 * 1. Token bucket — proactive rate limiting before the request
 * 2. Circuit breaker — stops requests after consecutive 429s
 * 3. Exponential backoff — reactive delay between retries
 * 4. Key rotation — switch to next available key on 429/5xx
 */
export async function relayRequest(
  body: RelayRequestBody,
  apiType: RelayApiType = 'chat',
  userAgent?: string,
  rawBody?: string,
  passthroughHeaders?: Record<string, string>
): Promise<RelayResult> {
  const provider = await resolveProvider(body.model);
  if (!provider) {
    throw new RelayError(
      `Unknown model: ${body.model}. Supported prefixes: gpt-, claude-, deepseek-, mimo-`,
      'invalid_request_error',
      400
    );
  }

  if (apiType === 'anthropicMessages') {
    const resolvedModel = await resolveModelAlias(body.model);
    if (!resolvedModel.toLowerCase().startsWith('claude-')) {
      throw new RelayError(
        `/v1/messages requires a claude-* model. Got ${body.model} (resolves to ${resolvedModel}).`,
        'invalid_request_error',
        400
      );
    }
  }

  if (apiType === 'responses' && provider.headerFormat === 'anthropic') {
    throw new RelayError(
      `Responses API is not supported for Anthropic-format providers (${provider.displayName}). Only OpenAI-compatible providers support /v1/responses.`,
      'invalid_request_error',
      400
    );
  }

  let effectiveProvider = provider;

  // Two mutually-exclusive routing modes determine effectiveProvider and fallbackNames.
  //
  //   Smart routing (config.enabled):
  //     Smart routing fully takes over — it picks the primary provider from the
  //     model-compatible candidate pool and supplies its own scored fallback
  //     chain. Priority rules and traditional per-provider fallback config are
  //     ignored entirely in this mode.
  //
  //   Traditional mode (default):
  //     The provider resolved from the model name is used as-is. Its fallback
  //     chain comes first from a matching priority rule's providerOrder (the
  //     entries after the current provider), and falls back to the provider's
  //     own configured/static fallback chain when no priority rule applies.
  //
  // The model used for compatibility filtering is the alias-resolved name, so a
  // `claude-best` alias is restricted to providers that actually serve the real
  // claude-* model rather than every configured provider.
  const smartRoutingConfigured = await isSmartRoutingConfigured();
  let fallbackNames: string[] = [];

  if (smartRoutingConfigured) {
    try {
      const resolvedForRouting = await resolveModelAlias(body.model);
      const routingDecision = await smartRoute(provider.name, resolvedForRouting);
      const allProviders = await getAllProviders();
      if (routingDecision.provider !== provider.name) {
        const reroutedProvider = allProviders[routingDecision.provider];
        if (reroutedProvider) {
          console.log(`[smart-route] Rerouting ${provider.displayName} → ${reroutedProvider.displayName} (${routingDecision.reason})`);
          effectiveProvider = reroutedProvider;
        }
      }
      // Smart routing supplies its own fallback chain (the remaining scored
      // candidates). Filter to existing providers and drop the primary so the
      // request has single-attempt failover within the model-compatible pool.
      fallbackNames = routingDecision.fallbackChain
        .filter((name) => allProviders[name] && name !== effectiveProvider.name);
      console.log(`[smart-route] Fallback chain: ${fallbackNames.join(' → ') || 'none'}`);
    } catch (e) {
      console.error('[smart-route] Failed, falling back to traditional failover:', e);
      try {
        const { getFallbackChain } = await import('../admin/admin-config');
        fallbackNames = await getFallbackChain(
          effectiveProvider.name,
          effectiveProvider.fallbackProviders || effectiveProvider.fallbackProvider
        );
      } catch {
        // Fallback fallback is best effort
      }
    }
  } else {
    // Traditional mode: priority rule providerOrder first, then static fallback.
    try {
      const { getPriorityRules } = await import('../admin/admin-config');
      const { findMatchingPriorityRule } = await import('../admin/priority-rules-core');
      const resolvedForRule = (await resolveModelAlias(body.model)).toLowerCase();
      const priorityRule = findMatchingPriorityRule(await getPriorityRules(), resolvedForRule);
      if (priorityRule && priorityRule.providerOrder.length > 1) {
        const currentIndex = priorityRule.providerOrder.indexOf(effectiveProvider.name);
        const remaining = currentIndex >= 0
          ? priorityRule.providerOrder.slice(currentIndex + 1)
          : priorityRule.providerOrder.filter((name) => name !== effectiveProvider.name);
        if (remaining.length > 0) {
          const allProviders = await getAllProviders();
          fallbackNames = remaining.filter((name) => allProviders[name]);
          if (fallbackNames.length > 0) {
            console.log(`[priority-fallback] Using providerOrder: ${fallbackNames.join(' → ')}`);
          }
        }
      }
    } catch {
      // Priority rules are an optional override; ignore failures and fall back
      // to the provider's own configured chain below.
    }

    if (fallbackNames.length === 0) {
      const { getFallbackChain } = await import('../admin/admin-config');
      fallbackNames = await getFallbackChain(
        effectiveProvider.name,
        effectiveProvider.fallbackProviders || effectiveProvider.fallbackProvider
      );
    }
  }

  let primaryResult: { result: RelayResult | null; lastError: Error | null } = { result: null, lastError: null };

  // Pre-flight: check rate limiter (token bucket + circuit breaker)
  const rateLimitCheck = checkRateLimit(effectiveProvider.name);

  if (!rateLimitCheck.allowed) {
    // If no fallbacks are configured, fail immediately with 429
    if (fallbackNames.length === 0) {
      throw new RelayError(
        rateLimitCheck.reason || 'Rate limit exceeded',
        'rate_limit_error',
        429
      );
    }
    primaryResult.lastError = new Error(rateLimitCheck.reason || 'Rate limit exceeded');
  } else {
    // Select an API key
    const apiKey = await selectKey(effectiveProvider);
    if (apiKey) {
      // Retry with key rotation + exponential backoff
      const pool = await getKeyPool(effectiveProvider);
      const maxRetries = Math.min(pool.keys.length, 3);

      // Try primary provider with retries (with concurrency control)
      primaryResult = await withConcurrency(
        () => tryProviderWithRetries(effectiveProvider, body, apiKey, maxRetries, apiType, smartRoutingConfigured, userAgent, rawBody, passthroughHeaders)
      );
      if (primaryResult.result) {
        return primaryResult.result;
      }
    } else {
      primaryResult.lastError = new Error(`No API keys configured for provider: ${effectiveProvider.displayName}`);
    }
  }

  const errors: { provider: string; error: string }[] = [
    { provider: effectiveProvider.displayName, error: primaryResult.lastError?.message || 'unknown error' },
  ];

  const attemptedProviders = new Set<string>([effectiveProvider.name]);

  for (const fbEntry of fallbackNames) {
    // Parse "provider:model" format — model is optional
    const colonIdx = fbEntry.indexOf(':');
    const fbName = colonIdx >= 0 ? fbEntry.slice(0, colonIdx) : fbEntry;
    const explicitModel = colonIdx >= 0 ? fbEntry.slice(colonIdx + 1) : null;

    const allProviders = await getAllProviders();
    const fbProvider = allProviders[fbName];
    if (!fbProvider) {
      console.warn(`[fallback] Unknown provider: ${fbName}, skipping`);
      errors.push({ provider: fbName, error: 'Unknown provider' });
      continue;
    }

    if (attemptedProviders.has(fbProvider.name)) {
      console.warn(`[fallback] Provider ${fbProvider.displayName} already attempted in this request, skipping to avoid loop`);
      continue;
    }
    attemptedProviders.add(fbProvider.name);

    console.log(`Trying fallback: ${fbProvider.displayName}${explicitModel ? ` (model: ${explicitModel})` : ''} (after ${provider.displayName} failed)`);
    const fbKey = await selectKey(fbProvider);
    if (!fbKey) {
      console.warn(`[fallback] ${fbProvider.displayName} has no API keys (env: ${fbProvider.envKeyField})`);
      errors.push({ provider: fbProvider.displayName, error: 'No API keys configured' });
      continue;
    }
    const fbPool = await getKeyPool(fbProvider);
    const fbMaxRetries = Math.min(fbPool.keys.length, 3);
    if (fbMaxRetries === 0) {
      console.warn(`[fallback] ${fbProvider.displayName} pool is empty, skipping`);
      errors.push({ provider: fbProvider.displayName, error: 'Key pool empty' });
      continue;
    }

    // If an explicit model was specified in the fallback entry, override the request model
    const fbBody = explicitModel ? { ...body, model: explicitModel } : body;

    // Skip Anthropic-format providers for Responses API (they don't support it)
    if (apiType === 'responses' && fbProvider.headerFormat === 'anthropic') {
      console.warn(`[fallback] ${fbProvider.displayName} does not support Responses API, skipping`);
      errors.push({ provider: fbProvider.displayName, error: 'Responses API not supported (Anthropic format)' });
      continue;
    }

    // Supported fallback to non-Anthropic format via request translation.

    const fbResult = await withConcurrency(
      () => tryProviderWithRetries(fbProvider, fbBody, fbKey, fbMaxRetries, apiType, smartRoutingConfigured, userAgent, undefined, passthroughHeaders)
    );
    if (fbResult.result) {
      return fbResult.result;
    }
    errors.push({ provider: fbProvider.displayName, error: fbResult.lastError?.message || 'unknown error' });
  }

  // All providers failed — report every error
  const detail = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
  throw new RelayError(
    `All providers failed — ${detail}`,
    'server_error',
    502
  );
}

/**
 * Try a provider with retries. Returns RelayResult on success, null if all retries failed.
 */
async function tryProviderWithRetries(
  provider: ProviderConfig,
  body: RelayRequestBody,
  initialKey: ApiKey | null,
  maxRetries: number,
  apiType: RelayApiType = 'chat',
  smartRoutingConfigured = false,
  userAgent?: string,
  // Original request text. When the outgoing body would be byte-identical to
  // it (no model rewrite / transform / stream_options injection), it is
  // forwarded as-is to skip a costly JSON.stringify of large bodies. Only
  // supplied for the primary attempt on Cloudflare; fallbacks remap the model
  // and so always re-serialize. See relayRequest.
  rawBody?: string,
  passthroughHeaders?: Record<string, string>
): Promise<{ result: RelayResult | null; lastError: Error | null }> {
  let currentKey = initialKey;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Exponential backoff between retries (skip on first attempt)
    if (attempt > 0) {
      await backoffSleep(attempt - 1);
    }

    // Re-check circuit breaker before each attempt
    const retryCheck = await checkRateLimit(provider.name);
    if (!retryCheck.allowed) {
      lastError = new Error(retryCheck.reason || 'Rate limit exceeded');
      continue;
    }

    // Select an API key if needed
    if (!currentKey) {
      currentKey = await selectKey(provider);
      if (!currentKey) {
        lastError = new Error(`No API keys configured for provider: ${provider.displayName}`);
        continue;
      }
    }

    const isAnthropic = provider.headerFormat === 'anthropic';

    // Resolve target model and its alias for the current provider
    const targetModel = await resolveFallbackModel(body.model, provider.name);
    const resolvedAlias = await resolveModelAlias(targetModel);
    // Map virtual model name to real upstream model ID (e.g. mimo-v2.6-pro-coding → mimo-v2.6-pro)
    const resolvedModel = resolveUpstreamModel(resolvedAlias, provider);

    // On Cloudflare, streaming usage is estimated from byte counts (see the
    // byte-counting passthrough in the route handlers), so we no longer need
    // to inject stream_options.include_usage. Skipping it keeps the body
    // byte-identical to the client's, which lets us forward the raw text below.
    // Keyed to the actual CF runtime (not to rawBody presence) so a future
    // non-CF caller passing rawBody can never accidentally suppress usage.
    const injectStreamOptions = !!body.stream && !isAnthropic && !isCloudflareSync();

    // Transform request body if needed (use resolved model name)
    // For Responses API: pass body directly (no Anthropic transform — Responses API is OpenAI-only)
    // For Chat API: inject stream_options and optionally transform to Anthropic format
    let requestBody: Record<string, unknown>;
    if (apiType === 'responses') {
      requestBody = { ...body, model: resolvedModel };
    } else if (apiType === 'anthropicMessages') {
      if (provider.headerFormat === 'anthropic') {
        requestBody = { ...body, model: resolvedModel };
      } else {
        const { transformAnthropicToOpenAI } = await import('./transform');
        requestBody = transformAnthropicToOpenAI({ ...body, model: resolvedModel });
        // Inject stream_options for OpenAI streaming so usage arrives in the final chunk
        if (body.stream) {
          const existingOpts = typeof requestBody.stream_options === 'object' && requestBody.stream_options !== null ? requestBody.stream_options : {};
          requestBody.stream_options = { include_usage: true, ...existingOpts };
        }
      }
    } else {
      const bodyWithResolvedModel: Record<string, unknown> = { ...body, model: resolvedModel };
      if (injectStreamOptions) {
        const existingOpts = typeof body.stream_options === 'object' && body.stream_options !== null ? body.stream_options : {};
        bodyWithResolvedModel.stream_options = { include_usage: true, ...existingOpts };
      }
      requestBody = isAnthropic ? transformToAnthropic(bodyWithResolvedModel as ChatCompletionRequest) : bodyWithResolvedModel;
    }

    // Raw-forward eligibility: only forward the original request text when the
    // outgoing body is provably semantically identical to it (see
    // isRawForwardEligible). Otherwise re-serialize requestBody.
    const rawPayload =
      rawBody &&
      isRawForwardEligible({
        apiType,
        isAnthropicProvider: isAnthropic,
        modelChanged: resolvedModel !== body.model,
        injectStreamOptions,
      })
        ? rawBody
        : undefined;

    const startTime = Date.now();
    let url: string;
    try {
      url = apiType === 'responses' ? getUpstreamResponsesUrl(provider) : getUpstreamUrl(provider);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      break;
    }
    try {
      const upstreamResponse = await fetchUpstreamWithUserAgentCandidates({
        provider,
        apiKey: currentKey.key,
        isStream: !!body.stream,
        clientUserAgent: userAgent,
        url,
        body: requestBody,
        rawPayload,
        passthroughHeaders,
      });

      const latencyMs = Date.now() - startTime;

      // 429 → record in rate limiter + try next key
      if (upstreamResponse.status === 429) {
        await cancelResponseBody(upstreamResponse);
        await record429(provider.name);
        await markCooldown(currentKey);
        await recordError(provider.name, currentKey.hash, 429, 'Rate limited by upstream');
        if (smartRoutingConfigured) recordProviderResult(provider.name, false, latencyMs, 429);
        lastError = new Error('Rate limited by upstream');
        const nextKey = await selectKey(provider);
        if (nextKey && nextKey.hash !== currentKey.hash) {
          currentKey = nextKey;
          continue;
        }
        continue;
      }

      // 401/403 → key invalid/expired, rotate to next key
      if (upstreamResponse.status === 401 || upstreamResponse.status === 403) {
        await cancelResponseBody(upstreamResponse);
        await markCooldown(currentKey);
        await recordError(provider.name, currentKey.hash, upstreamResponse.status, 'Auth failed — key invalid or expired');
        if (smartRoutingConfigured) recordProviderResult(provider.name, false, latencyMs, upstreamResponse.status);
        lastError = new Error('Auth failed — key invalid or expired');
        const nextKey = await selectKey(provider);
        if (nextKey && nextKey.hash !== currentKey.hash) {
          currentKey = nextKey;
          continue;
        }
        continue;
      }

      // 5xx → try next key (but don't count as 429 for circuit breaker)
      if (upstreamResponse.status >= 500) {
        await cancelResponseBody(upstreamResponse);
        await markCooldown(currentKey);
        await recordError(provider.name, currentKey.hash, upstreamResponse.status, 'Upstream server error');
        if (smartRoutingConfigured) recordProviderResult(provider.name, false, latencyMs, upstreamResponse.status);
        lastError = new Error(`Upstream server error (HTTP ${upstreamResponse.status})`);
        const nextKey = await selectKey(provider);
        if (nextKey && nextKey.hash !== currentKey.hash) {
          currentKey = nextKey;
          continue;
        }
        continue;
      }

      // Success → record in rate limiter
      await recordSuccess(provider.name);

      if (smartRoutingConfigured) {
        recordProviderResult(provider.name, true, latencyMs, upstreamResponse.status);
      }

      // NOTE: Usage tracking is done in the route handler, not here.
      // This avoids double-counting for non-streaming responses.

      return { result: { response: upstreamResponse, provider, apiKey: currentKey }, lastError };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (smartRoutingConfigured) recordProviderResult(provider.name, false, Date.now() - startTime);
      if (error instanceof UpstreamTimeoutError) {
        if (currentKey) {
          markCooldown(currentKey);
          await recordError(provider.name, currentKey.hash, 504, `Upstream timeout after ${error.timeoutMs}ms`);
        }
        // Fail fast with 504 without attempting fallback providers: on Vercel
        // (maxDuration=60s) and CF Pages, DEFAULT_UPSTREAM_TIMEOUT_MS=50s leaves
        // just enough headroom to return a structured JSON 504 before the platform
        // hard-kills the function.
        throw new RelayError(
          `${provider.displayName} timed out after ${error.timeoutMs}ms while waiting for upstream response.`,
          'upstream_error',
          504
        );
      }
      if (currentKey) {
        await markCooldown(currentKey);
        const nextKey = await selectKey(provider);
        if (nextKey && nextKey.hash !== currentKey.hash) {
          currentKey = nextKey;
          continue;
        }
      }
    }
  }

  return { result: null, lastError };
}
