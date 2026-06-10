// ============================================================
// AI API Relay — /v1/messages Route Handler
//
// Anthropic Messages API support for Claude-compatible clients.
// ============================================================

import { NextRequest } from 'next/server';
import { validateAuth, relayRequest } from '@/lib/relay';
import { transformOpenAIToAnthropic } from '@/lib/relay/transform';
import { RelayError } from '@/lib/errors';
import { createUsageEvent, getBatchRecorder } from '@/lib/usage';
import { createUsageStorage } from '@/lib/usage/factory';
import { recordRequestLog } from '@/lib/observability/request-logs';
import { chunkHasUsage, jsonStringFieldLength } from '@/lib/usage/stream-usage';
import type { AnthropicMessagesRequest } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const batchRecorder = getBatchRecorder();

const CHARS_PER_TOKEN = 4;

function jsonError(status: number, message: string, type = 'invalid_request_error'): Response {
  return new Response(
    JSON.stringify({
      error: {
        type,
        message,
      },
    }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function estimateTokensFromChars(charCount: number): number {
  return Math.max(1, Math.ceil(charCount / CHARS_PER_TOKEN));
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const obj = part as Record<string, unknown>;
      if (typeof obj.text === 'string') return obj.text;
      return '';
    })
    .join('');
}

function estimatePromptTokens(body: AnthropicMessagesRequest): number {
  const messageText = body.messages.map((message) => contentToText(message.content)).join('\n');
  const systemText = contentToText(body.system);
  return estimateTokens(`${systemText}\n${messageText}`);
}

function extractOutputText(data: Record<string, unknown>): string {
  if (!Array.isArray(data.content)) return '';
  return data.content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const obj = part as Record<string, unknown>;
      return typeof obj.text === 'string' ? obj.text : '';
    })
    .join('');
}

function wrapAnthropicStreamWithUsageTracking(
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
  let accumulatedContentChars = 0;
  let lastUsage: { input_tokens?: number; output_tokens?: number } | null = null;
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

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        try {
          if (lastUsage) {
            await recordUsage(lastUsage.input_tokens ?? requestPromptTokens, lastUsage.output_tokens ?? 0);
          } else if (accumulatedContentChars > 0) {
            await recordUsage(requestPromptTokens, estimateTokensFromChars(accumulatedContentChars));
          }
        } catch (error) {
          console.error('[Usage] anthropic stream recordUsage failed:', error);
        }
        controller.close();
        return;
      }

      controller.enqueue(value);

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        // Fast path: skip JSON.parse for content_block_delta chunks (the bulk
        // of a large generation). Usage lives only in message_start /
        // message_delta, which always carry a *_tokens field.
        if (!chunkHasUsage(data)) {
          if (!lastUsage?.output_tokens) {
            accumulatedContentChars += jsonStringFieldLength(data, 'text');
          }
          continue;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'message_start' && parsed.message?.usage) {
            lastUsage = {
              input_tokens: parsed.message.usage.input_tokens,
              output_tokens: parsed.message.usage.output_tokens,
            };
          }
          if (parsed.type === 'message_delta' && parsed.usage) {
            lastUsage = {
              input_tokens: lastUsage?.input_tokens,
              output_tokens: parsed.usage.output_tokens,
            };
          }
        } catch {
          // Ignore non-JSON SSE payloads.
        }
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

function wrapOpenAIStreamToAnthropic(
  openAiStream: ReadableStream<Uint8Array>,
  apiKeyHash: string,
  providerName: string,
  model: string,
  startTime: number,
  requestPromptTokens: number,
  traceId: string
): ReadableStream<Uint8Array> {
  const reader = openAiStream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let messageId = `msg_${Date.now().toString(36)}`;
  let hasSentStart = false;
  let accumulatedCompletionTokens = 0;
  let recorded = false;
  let lastFinishReason: string | null = null;
  const promptTokens = requestPromptTokens;
  let inputTokensFromUsage: number | null = null;
  let outputTokensFromUsage: number | null = null;

  // Anthropic content blocks are addressed by a monotonic index. A text block
  // (if any) occupies the lowest indices; each OpenAI tool_call becomes its own
  // tool_use block. We track which blocks are open so we can emit the matching
  // content_block_stop before moving on / finishing.
  let nextBlockIndex = 0;
  let textBlockIndex: number | null = null;
  let textBlockOpen = false;
  // OpenAI streams tool_calls keyed by their own `index`; map that to our
  // Anthropic block index and remember whether the block is still open.
  const toolBlocks = new Map<number, { blockIndex: number; open: boolean }>();

  async function recordUsage(pTokens: number, cTokens: number): Promise<void> {
    if (recorded) return;
    recorded = true;
    const latencyMs = Date.now() - startTime;
    const event = createUsageEvent({
      provider: providerName,
      model,
      apiKeyHash,
      statusCode: 200,
      promptTokens: pTokens,
      completionTokens: cTokens,
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
      promptTokens: pTokens,
      completionTokens: cTokens,
      totalTokens: pTokens + cTokens,
      isStream: true,
    });
  }

  function formatSseEvent(event: Record<string, unknown>): Uint8Array {
    return encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  return new ReadableStream({
    async start(controller) {
      // Emit message_start (once) followed by a ping, matching the Anthropic
      // streaming contract. Safe to call repeatedly — it self-guards.
      function ensureStarted() {
        if (hasSentStart) return;
        hasSentStart = true;
        controller.enqueue(formatSseEvent({
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: inputTokensFromUsage ?? promptTokens,
              output_tokens: 0,
            },
          },
        }));
        controller.enqueue(formatSseEvent({ type: 'ping' }));
      }

      // Close any open text block before starting a tool block (Anthropic
      // requires blocks to be opened/closed in strict index order).
      function closeTextBlock() {
        if (textBlockOpen && textBlockIndex !== null) {
          controller.enqueue(formatSseEvent({ type: 'content_block_stop', index: textBlockIndex }));
          textBlockOpen = false;
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Empty upstream stream: ensure we at least emit message_start/stop so
            // the client gets a parseable (albeit empty) response instead of hanging.
            if (!hasSentStart) {
              ensureStarted();
            }

            if (hasSentStart) {
              // Close whatever block is still open (text or the last tool_use).
              closeTextBlock();
              for (const tb of toolBlocks.values()) {
                if (tb.open) {
                  controller.enqueue(formatSseEvent({ type: 'content_block_stop', index: tb.blockIndex }));
                  tb.open = false;
                }
              }

              const stopReasonMap: Record<string, string> = {
                stop: 'end_turn',
                length: 'max_tokens',
                tool_calls: 'tool_use',
                content_filter: 'stop_sequence',
              };
              const stopReason = lastFinishReason ? (stopReasonMap[lastFinishReason] || 'end_turn') : 'end_turn';

              const finalPromptTokens = inputTokensFromUsage ?? promptTokens;
              const finalCompletionTokens = outputTokensFromUsage ?? accumulatedCompletionTokens;

              controller.enqueue(formatSseEvent({
                type: 'message_delta',
                delta: {
                  stop_reason: stopReason,
                  stop_sequence: null,
                },
                usage: {
                  output_tokens: finalCompletionTokens,
                },
              }));

              controller.enqueue(formatSseEvent({
                type: 'message_stop',
              }));

              try {
                await recordUsage(finalPromptTokens, finalCompletionTokens);
              } catch (error) {
                console.error('[Usage] translate stream recordUsage failed:', error);
              }
            }
            controller.close();
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              if (parsed.id) messageId = parsed.id;

              if (parsed.usage) {
                if (typeof parsed.usage.prompt_tokens === 'number') {
                  inputTokensFromUsage = parsed.usage.prompt_tokens;
                }
                if (typeof parsed.usage.completion_tokens === 'number') {
                  outputTokensFromUsage = parsed.usage.completion_tokens;
                }
              }

              const choice = parsed.choices?.[0];
              if (!choice) continue;

              if (choice.finish_reason) {
                lastFinishReason = choice.finish_reason;
              }

              const delta = choice.delta || {};
              const content: string = delta.content || '';

              // --- Text delta ---
              if (content) {
                ensureStarted();
                if (textBlockIndex === null) {
                  textBlockIndex = nextBlockIndex++;
                }
                if (!textBlockOpen) {
                  textBlockOpen = true;
                  controller.enqueue(formatSseEvent({
                    type: 'content_block_start',
                    index: textBlockIndex,
                    content_block: { type: 'text', text: '' },
                  }));
                }
                accumulatedCompletionTokens += estimateTokens(content);
                controller.enqueue(formatSseEvent({
                  type: 'content_block_delta',
                  index: textBlockIndex,
                  delta: { type: 'text_delta', text: content },
                }));
              }

              // --- Tool call deltas ---
              // OpenAI streams tool_calls as an array; each entry carries an
              // `index`, with the id/name on the first delta and `arguments`
              // accumulated across subsequent deltas.
              if (Array.isArray(delta.tool_calls)) {
                ensureStarted();
                for (const tc of delta.tool_calls) {
                  const oaIndex = typeof tc.index === 'number' ? tc.index : 0;
                  let block = toolBlocks.get(oaIndex);

                  // First time we see this tool_call index → open a tool_use block.
                  if (!block) {
                    // A tool_use block must come after the text block; close it first.
                    closeTextBlock();
                    const blockIndex = nextBlockIndex++;
                    block = { blockIndex, open: true };
                    toolBlocks.set(oaIndex, block);
                    controller.enqueue(formatSseEvent({
                      type: 'content_block_start',
                      index: blockIndex,
                      content_block: {
                        type: 'tool_use',
                        id: tc.id || `toolu_${Date.now().toString(36)}_${oaIndex}`,
                        name: tc.function?.name || '',
                        input: {},
                      },
                    }));
                  }

                  const argChunk: string = tc.function?.arguments || '';
                  if (argChunk) {
                    accumulatedCompletionTokens += estimateTokens(argChunk);
                    controller.enqueue(formatSseEvent({
                      type: 'content_block_delta',
                      index: block.blockIndex,
                      delta: { type: 'input_json_delta', partial_json: argChunk },
                    }));
                  }
                }
              }
            } catch {
              // Ignore non-JSON SSE payloads.
            }
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

/**
 * Collect client-supplied Anthropic headers worth forwarding to an Anthropic
 * upstream. Claude CLI / Claude app gate features (prompt caching, interleaved
 * thinking, fine-grained tool streaming, …) behind `anthropic-beta`, and pin
 * the API version via `anthropic-version`. Forwarding them keeps those features
 * working on the native path; on the OpenAI-translation path they are ignored.
 */
function collectAnthropicPassthroughHeaders(request: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const beta = request.headers.get('anthropic-beta');
  if (beta) out['anthropic-beta'] = beta;
  const version = request.headers.get('anthropic-version');
  if (version) out['anthropic-version'] = version;
  return out;
}

function validateBody(body: Partial<AnthropicMessagesRequest>): string | null {
  if (!body.model || typeof body.model !== 'string') {
    return 'Missing required field: model.';
  }
  if (!Number.isFinite(body.max_tokens) || Number(body.max_tokens) <= 0) {
    return 'Missing or invalid required field: max_tokens.';
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return 'Missing or empty required field: messages.';
  }
  return null;
}

export async function POST(request: NextRequest) {
  const traceId = request.headers.get('x-request-id') || `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  if (!(await validateAuth(request))) {
    return jsonError(401, 'Invalid API key. Provide a valid key in the Authorization or x-api-key header.', 'authentication_error');
  }

  const usageStorage = await createUsageStorage();
  batchRecorder.setStorage(usageStorage as any);

  let body: AnthropicMessagesRequest;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON in request body.');
  }

  const validationError = validateBody(body);
  if (validationError) return jsonError(400, validationError);

  const quota = await usageStorage.checkQuota(true);
  if (!quota.allowed) {
    return new Response(
      JSON.stringify({
        error: {
          type: 'rate_limit_error',
          message: `Rate limit exceeded. Daily: ${quota.dailyUsed}/${quota.dailyLimit}, Monthly: ${quota.monthlyUsed}/${quota.monthlyLimit}. Retry after ${quota.retryAfter}s.`,
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

  const estimatedPromptTokens = estimatePromptTokens(body);

  try {
    const startTime = Date.now();
    const userAgent = request.headers.get('user-agent') || undefined;
    const passthroughHeaders = collectAnthropicPassthroughHeaders(request);
    const { response, provider, apiKey } = await relayRequest(body, 'anthropicMessages', userAgent, passthroughHeaders);
    const latencyMs = Date.now() - startTime;

    const isAnthropic = provider.headerFormat === 'anthropic';

    if (body.stream && response.ok && response.body) {
      const wrappedBody = isAnthropic
        ? wrapAnthropicStreamWithUsageTracking(
            response.body,
            apiKey.hash,
            provider.name,
            body.model,
            startTime,
            estimatedPromptTokens,
            traceId
          )
        : wrapOpenAIStreamToAnthropic(
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
    }

    let responseBody = await response.text();

    if (response.ok) {
      try {
        let promptTokens: number;
        let completionTokens: number;

        if (isAnthropic) {
          const data = JSON.parse(responseBody);
          promptTokens = data.usage?.input_tokens ?? estimatedPromptTokens;
          completionTokens = data.usage?.output_tokens ?? estimateTokens(extractOutputText(data));
        } else {
          // Translate OpenAI response to Anthropic format
          const openAiData = JSON.parse(responseBody);
          const translatedData = transformOpenAIToAnthropic(openAiData, body.model);
          responseBody = JSON.stringify(translatedData);
          promptTokens = openAiData.usage?.prompt_tokens ?? estimatedPromptTokens;
          completionTokens = openAiData.usage?.completion_tokens ?? estimateTokens(extractOutputText(translatedData as any));
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
      } catch (error) {
        console.error('[Usage] response translation / usage tracking failed:', error);
      }
    }

    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': isAnthropic ? (response.headers.get('content-type') || 'application/json') : 'application/json',
        'X-Relay-Provider': provider.name,
        'X-Relay-Key': apiKey.hash,
      },
    });
  } catch (error) {
    if (error instanceof RelayError) {
      return jsonError(error.status, error.message, error.type);
    }

    console.error('Anthropic relay error:', error);
    return jsonError(500, 'Internal relay error.', 'server_error');
  }
}
