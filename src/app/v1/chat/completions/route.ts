// ============================================================
// AI API Relay — /v1/chat/completions Route Handler
//
// Usage tracking strategy:
// - Non-streaming: parse JSON response, extract usage → record
// - Streaming: wrap SSE stream, intercept usage chunks → record
//   * OpenAI format: usage in final SSE chunk (stream_options.include_usage)
//   * Anthropic format: usage in message_delta events
//   * Fallback: estimate tokens from response text if no usage data
// ============================================================

import { NextRequest } from 'next/server';
import { validateAuth, relayRequest, validateBase64ImageSizes, validateRequestSize, validateContentLengthHeader } from '@/lib/relay';
import { collectPassthroughHeaders } from '@/lib/relay/passthrough';
import { mapAnthropicStopReasonToOpenAI, transformAnthropicMessageToOpenAIChat } from '@/lib/relay/transform';
import { RelayError } from '@/lib/errors';
import { createUsageEvent, getBatchRecorder } from '@/lib/usage';
import { createUsageStorage } from '@/lib/usage/factory';
import { recordRequestLog } from '@/lib/observability/request-logs';
import { chunkHasUsage, jsonStringFieldLength, createByteCountingStream, estimateCompletionTokensFromStreamBytes } from '@/lib/usage/stream-usage';
import { isCloudflareSync, runAfterResponse, createAfterStreamHook, type AfterStreamHook } from '@/lib/cf-env';

export const runtime = 'nodejs';
// Vercel Hobby (Fluid Compute) supports up to 300s maxDuration.
export const maxDuration = 300;

const batchRecorder = getBatchRecorder();

/** Rough chars-per-token estimate for fallback */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from text (rough fallback).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/**
 * Wrap a streaming SSE response to intercept and track token usage.
 *
 * Supports two formats:
 * 1. OpenAI: final SSE chunk has `usage` object
 * 2. Anthropic: `message_delta` event has `usage` with `input_tokens`/`output_tokens`
 */
function wrapStreamWithUsageTracking(
  upstreamBody: ReadableStream<Uint8Array>,
  apiKeyHash: string,
  providerName: string,
  model: string,
  startTime: number,
  requestPromptTokens: number,
  traceId: string,
  abortUpstream?: () => void,
  afterStream?: AfterStreamHook
): ReadableStream<Uint8Array> {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  let accumulatedContentChars = 0;
  let recorded = false;
  const onVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

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
    await batchRecorder.record(event);
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
    if (onVercel) {
      await batchRecorder.flushForServerlessAfter();
    }
  }

  return new ReadableStream({
    async pull(controller) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        afterStream?.complete();
        controller.error(error);
        return;
      }
      if (done) {
        // Stream ended — record usage
        const finalize = async () => {
          if (lastUsage) {
            await recordUsage(lastUsage.prompt_tokens || 0, lastUsage.completion_tokens || 0);
          } else if (accumulatedContentChars > 0) {
            // Fallback: estimate tokens from accumulated content length.
            await recordUsage(requestPromptTokens, estimateTokensFromChars(accumulatedContentChars));
          }
        };
        if (onVercel && afterStream) {
          afterStream.schedule(finalize);
        } else {
          await finalize();
          afterStream?.complete();
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
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') continue;

        // Fast path: usage data only ever lives in chunks carrying a
        // *_tokens field. For the thousands of content-delta chunks in a
        // large generation, skip JSON.parse entirely and just measure the
        // delta length via a substring scan — this is what keeps the worker
        // under Cloudflare's CPU-time budget on big (code) responses.
        if (!chunkHasUsage(data)) {
          if (lastUsage) continue; // already have real usage; fallback unneeded
          if (providerName === 'anthropic') {
            // content_block_delta → { delta: { text } }
            accumulatedContentChars += jsonStringFieldLength(data, 'text');
          } else {
            // chat.completion.chunk → choices[].delta.content
            accumulatedContentChars += jsonStringFieldLength(data, 'content');
          }
          continue;
        }

        // Slow path: rare, only for usage-bearing chunks.
        try {
          const parsed = JSON.parse(data);
          if (parsed.usage) {
            lastUsage = parsed.usage;
          }
          if (providerName === 'anthropic' && parsed.type === 'message_delta' && parsed.usage) {
            lastUsage = {
              prompt_tokens: parsed.usage.input_tokens || 0,
              completion_tokens: parsed.usage.output_tokens || 0,
            };
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
      abortUpstream?.();
      afterStream?.complete();
    },
  });
}

/**
 * Translate Anthropic message SSE into OpenAI chat-completion SSE while also
 * tracking usage. This keeps OpenAI-compatible clients insulated from a
 * fallback to an Anthropic-format upstream.
 */
function wrapAnthropicStreamToOpenAI(
  upstreamBody: ReadableStream<Uint8Array>,
  apiKeyHash: string,
  providerName: string,
  model: string,
  startTime: number,
  requestPromptTokens: number,
  traceId: string,
  abortUpstream?: () => void,
  afterStream?: AfterStreamHook
): ReadableStream<Uint8Array> {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let responseId = `chatcmpl_${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  let sentRole = false;
  let recorded = false;
  let inputTokensFromUsage: number | null = null;
  let outputTokensFromUsage: number | null = null;
  let accumulatedContentChars = 0;
  let finalFinishReason: string | null = null;
  const toolBlocks = new Map<number, { toolCallIndex: number; id: string; name: string }>();
  let nextToolCallIndex = 0;

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
    await batchRecorder.record(event);
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

  function chunk(delta: Record<string, unknown>, finishReason: string | null = null, usage?: Record<string, number>): Uint8Array {
    const payload: Record<string, unknown> = {
      id: responseId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason,
        },
      ],
    };
    if (usage) payload.usage = usage;
    return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function ensureRole(controller: ReadableStreamDefaultController<Uint8Array>) {
    if (sentRole) return;
    sentRole = true;
    controller.enqueue(chunk({ role: 'assistant' }));
  }

  return new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            const finalPromptTokens = inputTokensFromUsage ?? requestPromptTokens;
            const finalCompletionTokens = outputTokensFromUsage ?? estimateTokensFromChars(accumulatedContentChars);
            const onVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
            const finalize = async () => {
              try {
                await recordUsage(finalPromptTokens, finalCompletionTokens);
                if (onVercel) {
                  await batchRecorder.flushForServerlessAfter();
                }
              } catch (error) {
                console.error('[Usage] anthropic-to-openai stream recordUsage failed:', error);
              }
            };
            if (onVercel && afterStream) {
              afterStream.schedule(finalize);
            } else {
              await finalize();
              afterStream?.complete();
            }
            ensureRole(controller);
            controller.enqueue(chunk({}, finalFinishReason || 'stop', {
              prompt_tokens: finalPromptTokens,
              completion_tokens: finalCompletionTokens,
              total_tokens: finalPromptTokens + finalCompletionTokens,
            }));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.type === 'message_start' && parsed.message) {
                if (parsed.message.id) responseId = parsed.message.id;
                if (parsed.message.usage?.input_tokens !== undefined) {
                  inputTokensFromUsage = parsed.message.usage.input_tokens;
                }
                ensureRole(controller);
                continue;
              }

              if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
                ensureRole(controller);
                const toolCallIndex = nextToolCallIndex++;
                const id = parsed.content_block.id || `call_${Date.now().toString(36)}_${toolCallIndex}`;
                const name = parsed.content_block.name || '';
                toolBlocks.set(parsed.index, { toolCallIndex, id, name });
                controller.enqueue(chunk({
                  tool_calls: [
                    {
                      index: toolCallIndex,
                      id,
                      type: 'function',
                      function: { name, arguments: '' },
                    },
                  ],
                }));
                continue;
              }

              if (parsed.type === 'content_block_delta' && parsed.delta) {
                ensureRole(controller);
                if (parsed.delta.type === 'text_delta') {
                  const text = parsed.delta.text || '';
                  accumulatedContentChars += text.length;
                  controller.enqueue(chunk({ content: text }));
                } else if (parsed.delta.type === 'input_json_delta') {
                  const block = toolBlocks.get(parsed.index);
                  if (block) {
                    const partial = parsed.delta.partial_json || '';
                    accumulatedContentChars += partial.length;
                    controller.enqueue(chunk({
                      tool_calls: [
                        {
                          index: block.toolCallIndex,
                          function: { arguments: partial },
                        },
                      ],
                    }));
                  }
                }
                continue;
              }

              if (parsed.type === 'message_delta') {
                finalFinishReason = mapAnthropicStopReasonToOpenAI(parsed.delta?.stop_reason);
                if (parsed.usage?.output_tokens !== undefined) {
                  outputTokensFromUsage = parsed.usage.output_tokens;
                }
              }
            } catch {
              // Ignore malformed SSE payloads and continue streaming valid chunks.
            }
          }
        }
      } catch (error) {
        afterStream?.complete();
        controller.error(error);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
      abortUpstream?.();
      afterStream?.complete();
    },
  });
}

/**
 * Estimate prompt tokens from request body.
 */
function estimatePromptTokens(body: { messages?: Array<{ content?: string | Array<unknown> }> }): number {
  if (!body.messages) return 0;
  let totalChars = 0;
  let imageCount = 0;
  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      // Multi-modal: estimate text parts
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null) {
          if ('text' in part) {
            totalChars += String((part as { text: string }).text).length;
          } else if ('type' in part && (part as { type: string }).type === 'image_url') {
            imageCount++;
          }
        }
      }
    }
  }
  const textTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  const imageTokens = imageCount * 85; // Rough estimate of standard low-res image token cost
  return Math.max(1, textTokens + imageTokens);
}

/**
 * POST /v1/chat/completions
 *
 * OpenAI-compatible chat completions endpoint.
 * Routes requests to the appropriate upstream provider based on model prefix.
 */
export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-request-id') || `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const routeStartTime = Date.now();
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

  // 1.5. Cheap O(1) Content-Length pre-check before buffering request body
  const headerSizeCheck = validateContentLengthHeader(request.headers);
  if (!headerSizeCheck.valid) {
    return new Response(
      JSON.stringify({
        error: {
          message: headerSizeCheck.error,
          type: 'invalid_request_error',
          code: 400,
        },
      }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'X-Request-ID': traceId } }
    );
  }

  const usageStorage = await createUsageStorage();
  batchRecorder.setStorage(usageStorage as any);

  // 2. Parse request body
  // Keep the original request text across ALL platforms (Cloudflare, Vercel,
  // and self-hosted Node) so the relay can forward it byte-for-byte whenever
  // the outgoing body is unchanged, skipping a costly JSON.stringify of large
  // contexts (saves CF 10ms CPU and Vercel Fluid Compute Active CPU / memory).
  const onCloudflare = isCloudflareSync();
  let body;
  let rawBody: string | undefined;
  try {
    rawBody = await request.text();
    body = JSON.parse(rawBody);
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

  // Guard against oversized inline payloads (abuse / accidental huge images).
  // Always enforce the O(1) total request-size cap first (4.5MB on Vercel, 10MB
  // elsewhere) to catch chunked bodies without Content-Length. Off Cloudflare,
  // also run the precise per-image 1MB base64 scan (too expensive for CF's 10ms CPU).
  const totalSizeCheck = validateRequestSize(rawBody?.length ?? 0);
  const sizeCheck = !totalSizeCheck.valid
    ? totalSizeCheck
    : onCloudflare
      ? totalSizeCheck
      : validateBase64ImageSizes(body);
  if (!sizeCheck.valid) {
    return new Response(
      JSON.stringify({
        error: {
          message: sizeCheck.error,
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

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Missing or empty required field: messages.',
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
    const userAgent = request.headers.get('user-agent') || undefined;
    const passthroughHeaders = collectPassthroughHeaders(request.headers);
    const { response, provider, apiKey, abortUpstream } = await relayRequest(
      body,
      'chat',
      userAgent,
      rawBody,
      passthroughHeaders,
      request.signal
    );
    const latencyMs = Date.now() - startTime;
    const isAnthropicProvider = provider.headerFormat === 'anthropic';

    // 5. Stream or return the response.
    // Gate on response.ok so upstream error bodies (4xx/5xx) fall through to
    // the non-streaming path below and are returned as-is — never wrapped as a
    // text/event-stream and logged as a successful 200.
    if (body.stream && response.ok && response.body) {
      // Cloudflare Free (~10ms CPU/request): the precise wrapper is O(response
      // bytes) and blows the budget on large generations. Pass chunks straight
      // through, tally only byte length, and estimate completion tokens once —
      // trading usage precision for near-constant per-byte CPU. Vercel keeps the
      // exact wrapper below.
      // Anthropic fallback must be translated, so large CF streams can exceed the CPU budget.
      if (isCloudflareSync() && !isAnthropicProvider) {
        const cfBody = createByteCountingStream(
          response.body,
          (totalBytes) => {
            // Schedule usage recording in the background so slow D1/log writes
            // don't delay the client's stream close. See runAfterResponse.
            const completionTokens = estimateCompletionTokensFromStreamBytes(totalBytes);
            const recordLatencyMs = Date.now() - startTime;
            const event = createUsageEvent({
              provider: provider.name,
              model: body.model,
              apiKeyHash: apiKey.hash,
              statusCode: 200,
              promptTokens: estimatedPromptTokens,
              completionTokens,
              latencyMs: recordLatencyMs,
              isStream: true,
            });
            runAfterResponse(async () => {
              await batchRecorder.record(event);
              await recordRequestLog({
                traceId,
                timestamp: new Date().toISOString(),
                apiKeyHash: apiKey.hash,
                model: body.model,
                provider: provider.name,
                status: 'success',
                httpStatus: 200,
                latencyMs: recordLatencyMs,
                promptTokens: estimatedPromptTokens,
                completionTokens,
                totalTokens: estimatedPromptTokens + completionTokens,
                isStream: true,
              });
            });
          },
          abortUpstream
        );
        return new Response(cfBody, {
          status: response.status,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Relay-Provider': provider.name,
            'X-Relay-Key': apiKey.hash,
            'X-Request-ID': traceId,
          },
        });
      }

      const afterStream = createAfterStreamHook();
      const wrappedBody = isAnthropicProvider
        ? wrapAnthropicStreamToOpenAI(
            response.body,
            apiKey.hash,
            provider.name,
            body.model,
            startTime,
            estimatedPromptTokens,
            traceId,
            abortUpstream,
            afterStream
          )
        : wrapStreamWithUsageTracking(
            response.body,
            apiKey.hash,
            provider.name,
            body.model,
            startTime,
            estimatedPromptTokens,
            traceId,
            abortUpstream,
            afterStream
          );
      return new Response(wrappedBody, {
        status: response.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Relay-Provider': provider.name,
          'X-Relay-Key': apiKey.hash,
          'X-Request-ID': traceId,
        },
      });
    } else {
      let responseBody = await response.text();

      // Track usage for non-streaming (ONLY place — no duplicate from relay.ts)
      if (response.ok) {
        try {
          const data = JSON.parse(responseBody);
          let promptTokens = isAnthropicProvider
            ? (data.usage?.input_tokens || 0)
            : (data.usage?.prompt_tokens || 0);
          let completionTokens = isAnthropicProvider
            ? (data.usage?.output_tokens || 0)
            : (data.usage?.completion_tokens || 0);

          if (isAnthropicProvider) {
            responseBody = JSON.stringify(transformAnthropicMessageToOpenAIChat(data, body.model));
          }

          // Fallback: if upstream doesn't return usage, estimate from response text
          if (!data.usage || (promptTokens === 0 && completionTokens === 0)) {
            const estimatedCompletion = estimateTokens(responseBody);
            promptTokens = estimatedPromptTokens;
            completionTokens = estimatedCompletion;
            console.log(`[Usage] non-stream fallback estimation: prompt=${promptTokens}, completion=${completionTokens}, model=${body.model}`);
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
          await batchRecorder.record(event);
          if (process.env.VERCEL || process.env.VERCEL_ENV) {
            runAfterResponse(() => batchRecorder.flushForServerlessAfter());
          }
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
          console.error('[Usage] non-stream track failed:', e);
        }
      } else {
        runAfterResponse(() =>
          recordRequestLog({
            traceId,
            timestamp: new Date().toISOString(),
            apiKeyHash: apiKey.hash,
            model: body.model,
            provider: provider.name,
            status: 'error',
            httpStatus: response.status,
            latencyMs,
            isStream: Boolean(body.stream),
            errorType: 'upstream_error',
            errorMessage: responseBody.slice(0, 500),
          })
        );
      }

      return new Response(responseBody, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'X-Relay-Provider': provider.name,
          'X-Relay-Key': apiKey.hash,
          'X-Request-ID': traceId,
        },
      });
    }
  } catch (error) {
    const errLatencyMs = Date.now() - routeStartTime;
    if (error instanceof RelayError) {
      runAfterResponse(() =>
        recordRequestLog({
          traceId,
          timestamp: new Date().toISOString(),
          model: requestedModel,
          status: 'error',
          httpStatus: error.status,
          latencyMs: errLatencyMs,
          isStream: Boolean(body?.stream),
          errorType: error.type,
          errorMessage: error.message,
        })
      );
      const res = error.toResponse();
      res.headers.set('X-Request-ID', traceId);
      return res;
    }

    console.error('Relay error:', error);
    runAfterResponse(() =>
      recordRequestLog({
        traceId,
        timestamp: new Date().toISOString(),
        model: requestedModel,
        status: 'error',
        httpStatus: 500,
        latencyMs: errLatencyMs,
        isStream: Boolean(body?.stream),
        errorType: 'server_error',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    );
    return new Response(
      JSON.stringify({
        error: {
          message: 'Internal relay error.',
          type: 'server_error',
          code: 500,
        },
      }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'X-Request-ID': traceId } }
    );
  }
}
