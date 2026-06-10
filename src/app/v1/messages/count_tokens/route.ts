// ============================================================
// AI API Relay — /v1/messages/count_tokens Route Handler
//
// Anthropic token-counting endpoint. Claude CLI / Claude app call this
// every turn to manage context, so it must exist alongside /v1/messages.
//
// Strategy:
//  - Anthropic-format upstream → forward the request verbatim and return the
//    upstream's authoritative {input_tokens} count.
//  - OpenAI-format upstream (translation path) → no real count_tokens endpoint
//    exists upstream, so return a local heuristic estimate. It only needs to be
//    good enough for the client's context budgeting.
// ============================================================

import { NextRequest } from 'next/server';
import { validateAuth } from '@/lib/relay';
import { resolveProvider, resolveModelAlias, getUpstreamCountTokensUrl, resolveFallbackModel, resolveUpstreamModel } from '@/lib/providers';
import { selectKey } from '@/lib/relay/key-pool';
import { buildHeaders } from '@/lib/relay/transform';
import type { AnthropicMessagesRequest } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

const CHARS_PER_TOKEN = 4;

function jsonError(status: number, message: string, type = 'invalid_request_error'): Response {
  return new Response(
    JSON.stringify({ error: { type, message } }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const obj = part as Record<string, unknown>;
      if (typeof obj.text === 'string') return obj.text;
      // tool_use / tool_result blocks carry structured payloads — fold their
      // JSON in so the estimate accounts for them rather than dropping to zero.
      if (obj.type === 'tool_use' || obj.type === 'tool_result') {
        try {
          return JSON.stringify(obj);
        } catch {
          return '';
        }
      }
      return '';
    })
    .join('');
}

function estimatePromptTokens(body: Partial<AnthropicMessagesRequest>): number {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const messageText = messages.map((message) => contentToText(message.content)).join('\n');
  const systemText = contentToText(body.system);
  // Tool definitions add to the prompt the model sees; include their schema.
  let toolsText = '';
  if (Array.isArray(body.tools)) {
    try {
      toolsText = JSON.stringify(body.tools);
    } catch {
      toolsText = '';
    }
  }
  return estimateTokens(`${systemText}\n${messageText}\n${toolsText}`);
}

function countTokensError(status: number, message: string): Response {
  // count_tokens shares the Messages API error envelope.
  return jsonError(status, message);
}

export async function POST(request: NextRequest) {
  if (!(await validateAuth(request))) {
    return countTokensError(401, 'Invalid API key. Provide a valid key in the Authorization or x-api-key header.');
  }

  let body: Partial<AnthropicMessagesRequest>;
  try {
    body = await request.json();
  } catch {
    return countTokensError(400, 'Invalid JSON in request body.');
  }

  // count_tokens requires model + messages, but NOT max_tokens (unlike Messages).
  if (!body.model || typeof body.model !== 'string') {
    return countTokensError(400, 'Missing required field: model.');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return countTokensError(400, 'Missing or empty required field: messages.');
  }

  const provider = await resolveProvider(body.model);

  // For Anthropic-format upstreams, forward to the real count_tokens endpoint
  // so the client gets an authoritative count. Any failure falls back to the
  // local estimate below rather than surfacing an error to the client.
  if (provider && provider.headerFormat === 'anthropic') {
    try {
      const apiKey = await selectKey(provider);
      if (apiKey) {
        const targetModel = await resolveFallbackModel(body.model, provider.name);
        const resolvedAlias = await resolveModelAlias(targetModel);
        const resolvedModel = resolveUpstreamModel(resolvedAlias, provider);

        const url = getUpstreamCountTokensUrl(provider);
        const userAgent = request.headers.get('user-agent') || undefined;
        const passthrough: Record<string, string> = {};
        const beta = request.headers.get('anthropic-beta');
        if (beta) passthrough['anthropic-beta'] = beta;
        const version = request.headers.get('anthropic-version');
        if (version) passthrough['anthropic-version'] = version;

        const upstream = await fetch(url, {
          method: 'POST',
          headers: buildHeaders(provider.headerFormat, apiKey.key, false, userAgent, undefined, passthrough),
          body: JSON.stringify({ ...body, model: resolvedModel }),
        });

        if (upstream.ok) {
          const text = await upstream.text();
          return new Response(text, {
            status: 200,
            headers: {
              'Content-Type': upstream.headers.get('content-type') || 'application/json',
              'X-Relay-Provider': provider.name,
              'X-Relay-Key': apiKey.hash,
            },
          });
        }
        // Non-OK upstream → fall through to local estimate.
        console.warn(`[count_tokens] upstream returned ${upstream.status}, falling back to estimate`);
      }
    } catch (error) {
      console.warn('[count_tokens] upstream forward failed, falling back to estimate:', error);
    }
  }

  // OpenAI-translation path (or Anthropic fallback): return a local estimate.
  const inputTokens = estimatePromptTokens(body);
  return new Response(
    JSON.stringify({ input_tokens: inputTokens }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Relay-Provider': provider?.name || 'estimate',
      },
    }
  );
}
