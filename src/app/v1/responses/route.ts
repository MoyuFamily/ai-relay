// ============================================================
// AI API Relay — /v1/responses Route Handler
//
// OpenAI Responses API support.
// Forwards requests to upstream providers via the relay layer.
//
// Usage tracking strategy (mirrors chat/completions):
// - Non-streaming: parse JSON response, extract usage → record
// - Streaming: wrap SSE stream, intercept usage events → record
// ============================================================

import { NextRequest } from 'next/server';
import { validateAuth, relayRequest } from '@/lib/relay';
import { RelayError } from '@/lib/errors';
import { KVUsageStorage, createUsageEvent } from '@/lib/usage';
import { recordRequestLog } from '@/lib/observability/request-logs';

export const runtime = 'nodejs';
export const maxDuration = 60;

const usageStorage = new KVUsageStorage();

/** Rough chars-per-token estimate for fallback */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from text (rough fallback).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Extract output text from a Responses API response for token estimation.
 */
function extractOutputText(data: Record<string, unknown>): string | null {
  if (!Array.isArray(data.output)) return null;
  let text = '';
  for (const item of data.output) {
    if (item && typeof item === 'object' && 'type' in item) {
      const obj = item as Record<string, unknown>;
      if (obj.type === 'message' && Array.isArray(obj.content)) {
        for (const part of obj.content) {
          if (part && typeof part === 'object' && 'text' in part) {
            text += String((part as { text: string }).text);
          }
        }
      }
    }
  }
  return text || null;
}

/**
 * Estimate prompt tokens from Responses API request body.
 * input can be a string or an array of items.
 */
function estimatePromptTokens(body: { input?: unknown; instructions?: string }): number {
  let totalChars = 0;

  // Count instructions
  if (body.instructions) {
    totalChars += body.instructions.length;
  }

  if (!body.input) return Math.max(1, Math.ceil(totalChars / CHARS_PER_TOKEN));

  if (typeof body.input === 'string') {
    totalChars += body.input.length;
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (typeof item === 'string') {
        totalChars += item.length;
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (typeof obj.content === 'string') {
          totalChars += obj.content.length;
        } else if (Array.isArray(obj.content)) {
          for (const part of obj.content) {
            if (typeof part === 'object' && part !== null && 'text' in part) {
              totalChars += String((part as { text: string }).text).length;
            }
          }
        }
      }
    }
  }

  return Math.max(1, Math.ceil(totalChars / CHARS_PER_TOKEN));
}

/**
 * Wrap a streaming SSE response to intercept and track token usage
 * for Responses API format.
 *
 * Responses API streaming events include:
 * - response.created
 * - response.output_item.done (contains usage in some implementations)
 * - response.completed (contains final usage)
 */
function wrapStreamWithUsageTracking(
  upstreamBody: ReadableStream<Uint8Array>,
  apiKeyHash: string,
  providerName: string,
  model: string,
  startTime: number,
  requestPromptTokens: number,
  traceId: string
): ReadableStream<Uint8Array> {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number } | null = null;
  let accumulatedContent = '';
  let recorded = false;

  async function recordUsage(promptTokens: number, completionTokens: number): Promise<void> {
    if (recorded) return;
    recorded = true;
    const latencyMs = Date.now() - startTime;
    const event = createUsageEvent({
      provider: providerName,
      model,
      apiKeyHash,
      statusCode: 200,
      promptTokens,
      completionTokens,
      latencyMs,
      isStream: true,
    });
    await usageStorage.record(event);
    await recordRequestLog({
      traceId,
      timestamp: new Date().toISOString(),
      apiKeyHash,
      model,
      provider: providerName,
      status: 'success',
      httpStatus: 200,
      latencyMs,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      isStream: true,
    });
  }

  return new ReadableStream({
    async pull(controller) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        controller.error(error);
        return;
      }

      if (done) {
        // Flush remaining buffer content
        const flushed = decoder.decode();
        if (flushed) buffer += flushed;
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6).trim();
            if (data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                if (parsed.usage) lastUsage = parsed.usage;
                if (parsed.type === 'response.completed' && parsed.response?.usage) {
                  lastUsage = parsed.response.usage;
                }
              } catch { /* not valid JSON */ }
            }
          }
        }

        // Record usage (best-effort, never stall the stream)
        try {
          if (lastUsage) {
            const prompt = lastUsage.prompt_tokens ?? lastUsage.input_tokens ?? requestPromptTokens;
            const completion = lastUsage.completion_tokens ?? lastUsage.output_tokens ?? 0;
            await recordUsage(prompt, completion);
          } else if (accumulatedContent) {
            const estimatedCompletion = estimateTokens(accumulatedContent);
            await recordUsage(requestPromptTokens, estimatedCompletion);
          }
        } catch (e) {
          console.error('[Usage] streaming recordUsage failed:', e);
        }
        controller.close();
        return;
      }

      // Pass through the chunk unchanged
      controller.enqueue(value);

      // Parse SSE lines to find usage data
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);

            // Responses API usage fields
            if (parsed.usage) {
              lastUsage = parsed.usage;
            }

            // Accumulate content from output text deltas
            if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
              accumulatedContent += parsed.delta;
            }

            // Also handle response.completed which may have final usage
            if (parsed.type === 'response.completed' && parsed.response?.usage) {
              lastUsage = parsed.response.usage;
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

/**
 * POST /v1/responses
 *
 * OpenAI Responses API endpoint.
 * Routes requests to the appropriate upstream provider based on model prefix.
 */
export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-request-id') || `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let requestedModel: string | undefined;

  // 1. Validate authentication
  if (!(await validateAuth(request))) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Invalid API key. Provide a valid key in the Authorization header.',
          type: 'authentication_error',
          code: 401,
        },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 2. Parse request body
  let body;
  try {
    body = await request.json();
    requestedModel = body?.model;
  } catch {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Invalid JSON in request body.',
          type: 'invalid_request_error',
          code: 400,
        },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3. Validate required fields
  if (!body.model) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Missing required field: model.',
          type: 'invalid_request_error',
          code: 400,
        },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (body.input === undefined || body.input === null) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Missing required field: input.',
          type: 'invalid_request_error',
          code: 400,
        },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if ((typeof body.input === 'string' && body.input.length === 0) ||
      (Array.isArray(body.input) && body.input.length === 0)) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Field "input" must not be empty.',
          type: 'invalid_request_error',
          code: 400,
        },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 3.5. Check rate limits (quota)
  const quota = await usageStorage.checkQuota(true);
  if (!quota.allowed) {
    return new Response(
      JSON.stringify({
        error: {
          message: `Rate limit exceeded. Daily: ${quota.dailyUsed}/${quota.dailyLimit}, Monthly: ${quota.monthlyUsed}/${quota.monthlyLimit}. Retry after ${quota.retryAfter}s.`,
          type: 'rate_limit_error',
          code: 429,
        },
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(quota.retryAfter || 60),
        },
      }
    );
  }

  // Pre-estimate prompt tokens for fallback
  const estimatedPromptTokens = estimatePromptTokens(body);

  // 4. Relay the request
  try {
    const startTime = Date.now();
    const { response, provider, apiKey } = await relayRequest(body, 'responses');
    const latencyMs = Date.now() - startTime;

    // 5. Stream or return the response
    if (body.stream && response.ok && response.body) {
      const wrappedBody = wrapStreamWithUsageTracking(
        response.body,
        apiKey.hash,
        provider.name,
        body.model,
        startTime,
        estimatedPromptTokens,
        traceId
      );
      return new Response(wrappedBody, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Relay-Provider': provider.name,
          'X-Relay-Key': apiKey.hash,
        },
      });
    } else {
      const responseBody = await response.text();

      // Track usage for non-streaming
      if (response.ok) {
        try {
          const data = JSON.parse(responseBody);
          let promptTokens = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0;
          let completionTokens = data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0;

          // Fallback: only when upstream omitted usage entirely
          if (!data.usage) {
            const outputText = extractOutputText(data);
            const estimatedCompletion = outputText ? estimateTokens(outputText) : estimateTokens(responseBody);
            promptTokens = estimatedPromptTokens;
            completionTokens = estimatedCompletion;
            console.log(`[Usage] responses non-stream fallback estimation: prompt=${promptTokens}, completion=${completionTokens}, model=${body.model}`);
          }

          const event = createUsageEvent({
            provider: provider.name,
            model: body.model,
            apiKeyHash: apiKey.hash,
            statusCode: response.status,
            promptTokens,
            completionTokens,
            latencyMs,
            isStream: false,
          });
          await usageStorage.record(event);
          await recordRequestLog({
            traceId,
            timestamp: new Date().toISOString(),
            apiKeyHash: apiKey.hash,
            model: body.model,
            provider: provider.name,
            status: 'success',
            httpStatus: response.status,
            latencyMs,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            isStream: false,
          });
        } catch (e) {
          console.error('[Usage] responses non-stream track failed:', e);
        }
      }

      return new Response(responseBody, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'X-Relay-Provider': provider.name,
          'X-Relay-Key': apiKey.hash,
        },
      });
    }
  } catch (error) {
    if (error instanceof RelayError) {
      return error.toResponse();
    }

    // Handle Responses API specific errors (e.g., Anthropic provider not supported)
    if (error instanceof Error && error.message.includes('not supported for Anthropic')) {
      return new Response(
        JSON.stringify({
          error: {
            message: error.message,
            type: 'invalid_request_error',
            code: 400,
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.error('Relay error:', error);
    return new Response(
      JSON.stringify({
        error: {
          message: 'Internal relay error.',
          type: 'server_error',
          code: 500,
        },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
