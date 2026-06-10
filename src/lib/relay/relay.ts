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

// Module-level cached storage instance for error recording.
// Falls back to KVUsageStorage synchronously on first call to avoid
// blocking the hot path; replaced with the correct backend after the
// first async resolution completes.
let _errorStorage: { recordError: (e: any) => Promise<void> } | null = null;

async function getErrorStorage() {
  if (_errorStorage) return _errorStorage;
  try {
    _errorStorage = await createUsageStorage();
  } catch {
    _errorStorage = new KVUsageStorage();
  }
  return _errorStorage;
}

type RelayApiType = 'chat' | 'responses' | 'anthropicMessages';
type RelayRequestBody = ChatCompletionRequest | ResponsesAPIRequest | AnthropicMessagesRequest;
const BROWSER_COMPAT_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'Mozilla/5.0',
];
const DEFAULT_UPSTREAM_TIMEOUT_MS = 50_000;

class UpstreamTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Upstream request timed out after ${timeoutMs}ms`);
    this.name = 'UpstreamTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function getUpstreamTimeoutMs(): number {
  const raw = process.env.RELAY_UPSTREAM_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_UPSTREAM_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_UPSTREAM_TIMEOUT_MS;
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
  return (response.headers.get('content-type') || '').includes('text/html');
}

async function fetchUpstreamWithUserAgentCandidates(input: {
  provider: ProviderConfig;
  apiKey: string;
  isStream: boolean;
  clientUserAgent?: string;
  url: string;
  body: unknown;
  passthroughHeaders?: Record<string, string>;
}): Promise<Response> {
  const payload = JSON.stringify(input.body);
  let lastResponse: Response | null = null;
  const timeoutMs = getUpstreamTimeoutMs();

  for (const customUserAgent of getUserAgentCandidates(input.provider)) {
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
  const smartRoutingConfigured = await isSmartRoutingConfigured();
  if (smartRoutingConfigured) {
    try {
      const routingDecision = await smartRoute(provider.name);
      if (routingDecision.provider !== provider.name) {
        const allProviders = await getAllProviders();
        const reroutedProvider = allProviders[routingDecision.provider];
        if (reroutedProvider) {
          console.log(`[smart-route] Rerouting ${provider.displayName} → ${reroutedProvider.displayName} (${routingDecision.reason})`);
          effectiveProvider = reroutedProvider;
        }
      }
    } catch {
      // Smart routing is non-blocking; fall through to original provider
    }
  }

  let primaryResult: { result: RelayResult | null; lastError: Error | null } = { result: null, lastError: null };

  // Fetch fallback chain early to determine if we can fall back on rate limit/circuit breaker open
  const { getFallbackChain } = await import('../admin/admin-config');
  const fallbackNames = await getFallbackChain(
    effectiveProvider.name,
    effectiveProvider.fallbackProviders || effectiveProvider.fallbackProvider
  );

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
        () => tryProviderWithRetries(effectiveProvider, body, apiKey, maxRetries, apiType, smartRoutingConfigured, userAgent, passthroughHeaders)
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
      () => tryProviderWithRetries(fbProvider, fbBody, fbKey, fbMaxRetries, apiType, smartRoutingConfigured, userAgent, passthroughHeaders)
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
    // Map virtual model name to real upstream model ID (e.g. mimo-v2.5-pro-coding → mimo-v2.5-pro)
    const resolvedModel = resolveUpstreamModel(resolvedAlias, provider);

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
      if (body.stream && !isAnthropic) {
        const existingOpts = typeof body.stream_options === 'object' && body.stream_options !== null ? body.stream_options : {};
        bodyWithResolvedModel.stream_options = { include_usage: true, ...existingOpts };
      }
      requestBody = isAnthropic ? transformToAnthropic(bodyWithResolvedModel as ChatCompletionRequest) : bodyWithResolvedModel;
    }

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
        passthroughHeaders,
      });

      const latencyMs = Date.now() - startTime;

      // 429 → record in rate limiter + try next key
      if (upstreamResponse.status === 429) {
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
