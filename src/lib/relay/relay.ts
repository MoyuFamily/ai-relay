// ============================================================
// AI API Relay — Core Relay Logic (with 429 protection)
// ============================================================

import type { ChatCompletionRequest } from '../types';
import type { RelayResult, ProviderConfig, ApiKey } from '../providers/types';
import { resolveProvider, getUpstreamUrl, resolveModelAlias, resolveFallbackModel, resolveUpstreamModel, getAllProviders } from '../providers';
import { selectKey, markCooldown, getKeyPool } from './key-pool';
import { buildHeaders, transformToAnthropic } from './transform';
import { RelayError } from '../errors';
import { KVUsageStorage } from '../usage/storage/kv-storage';
import {
  checkRateLimit,
  record429,
  recordSuccess,
  backoffSleep,
} from './rate-limiter';
import { withConcurrency } from './concurrency';

const usageStorage = new KVUsageStorage();

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
  return usageStorage.recordError({ provider, keyHash, statusCode, reason });
}

/**
 * Core relay function — forwards a chat completion request to the upstream provider.
 * Supports both streaming and non-streaming.
 *
 * 429 protection layers:
 * 1. Token bucket — proactive rate limiting before the request
 * 2. Circuit breaker — stops requests after consecutive 429s
 * 3. Exponential backoff — reactive delay between retries
 * 4. Key rotation — switch to next available key on 429/5xx
 */
export async function relayRequest(
  body: ChatCompletionRequest
): Promise<RelayResult> {
  const provider = await resolveProvider(body.model);
  if (!provider) {
    throw new RelayError(
      `Unknown model: ${body.model}. Supported prefixes: gpt-, claude-, deepseek-, mimo-`,
      'invalid_request_error',
      400
    );
  }

  let primaryResult: { result: RelayResult | null; lastError: Error | null } = { result: null, lastError: null };

  // Fetch fallback chain early to determine if we can fall back on rate limit/circuit breaker open
  const { getFallbackChain } = await import('../admin/admin-config');
  const fallbackNames = await getFallbackChain(
    provider.name,
    provider.fallbackProviders || provider.fallbackProvider
  );

  // Pre-flight: check rate limiter (token bucket + circuit breaker)
  const rateLimitCheck = checkRateLimit(provider.name);

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
    const apiKey = await selectKey(provider);
    if (apiKey) {
      // Retry with key rotation + exponential backoff
      const pool = await getKeyPool(provider);
      const maxRetries = Math.min(pool.keys.length, 3);

      // Try primary provider with retries (with concurrency control)
      primaryResult = await withConcurrency(
        () => tryProviderWithRetries(provider, body, apiKey, maxRetries)
      );
      if (primaryResult.result) {
        return primaryResult.result;
      }
    } else {
      primaryResult.lastError = new Error(`No API keys configured for provider: ${provider.displayName}`);
    }
  }

  const errors: { provider: string; error: string }[] = [
    { provider: provider.displayName, error: primaryResult.lastError?.message || 'unknown error' },
  ];

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

    const fbResult = await withConcurrency(
      () => tryProviderWithRetries(fbProvider, fbBody, fbKey, fbMaxRetries)
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
  body: ChatCompletionRequest,
  initialKey: ApiKey | null,
  maxRetries: number
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

    const url = getUpstreamUrl(provider);
    const isAnthropic = provider.headerFormat === 'anthropic';

    // Resolve target model and its alias for the current provider
    const targetModel = await resolveFallbackModel(body.model, provider.name);
    const resolvedAlias = await resolveModelAlias(targetModel);
    // Map virtual model name to real upstream model ID (e.g. mimo-v2.5-pro-coding → mimo-v2.5-pro)
    const resolvedModel = resolveUpstreamModel(resolvedAlias, provider);

    // Transform request body if needed (use resolved model name)
    // Inject stream_options.include_usage for streaming so upstream returns usage in final SSE chunk
    const bodyWithResolvedModel: Record<string, unknown> = { ...body, model: resolvedModel };
    if (body.stream && !isAnthropic) {
      const existingOpts = typeof body.stream_options === 'object' && body.stream_options !== null ? body.stream_options : {};
      bodyWithResolvedModel.stream_options = { include_usage: true, ...existingOpts };
    }
    const requestBody = isAnthropic ? transformToAnthropic(bodyWithResolvedModel as ChatCompletionRequest) : bodyWithResolvedModel;

    const startTime = Date.now();
    try {
      const upstreamResponse = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(provider.headerFormat, currentKey.key, !!body.stream),
        body: JSON.stringify(requestBody),
      });

      const latencyMs = Date.now() - startTime;

      // 429 → record in rate limiter + try next key
      if (upstreamResponse.status === 429) {
        await record429(provider.name);
        await markCooldown(currentKey);
        await recordError(provider.name, currentKey.hash, 429, 'Rate limited by upstream');
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

      // NOTE: Usage tracking is done in the route handler, not here.
      // This avoids double-counting for non-streaming responses.

      return { result: { response: upstreamResponse, provider, apiKey: currentKey }, lastError };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await markCooldown(currentKey);
      const nextKey = await selectKey(provider);
      if (nextKey && nextKey.hash !== currentKey.hash) {
        currentKey = nextKey;
        continue;
      }
    }
  }

  return { result: null, lastError };
}
