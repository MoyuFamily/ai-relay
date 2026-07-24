// ============================================================
// AI API Relay — Request Transformation
// ============================================================

import type { ChatCompletionRequest, ChatCompletionResponse } from '../types';
import { RELAY_MANAGED_HEADERS } from './passthrough';

/**
 * Transform OpenAI-format request to Anthropic format.
 */
export function transformToAnthropic(body: ChatCompletionRequest): Record<string, unknown> {
  const { messages, model, max_tokens, temperature, top_p, stream, stop } = body;

  // Extract system message
  const systemMsg = messages.find((m) => m.role === 'system');
  const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

  const anthropicBody: Record<string, unknown> = {
    model,
    max_tokens: max_tokens || 4096,
    messages: nonSystemMsgs.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content || '',
    })),
  };

  if (systemMsg?.content) {
    anthropicBody.system = systemMsg.content;
  }
  if (temperature !== undefined) anthropicBody.temperature = temperature;
  if (top_p !== undefined) anthropicBody.top_p = top_p;
  if (stream !== undefined) anthropicBody.stream = stream;
  if (stop) anthropicBody.stop_sequences = Array.isArray(stop) ? stop : [stop];

  return anthropicBody;
}

/**
 * Neutral default User-Agents by upstream header format, used when the client
 * UA is missing or a blocked script UA. These present as ordinary SDK clients
 * that upstreams expect, and intentionally do NOT reveal that the request
 * passed through a relay. Override any of them with RELAY_DEFAULT_USER_AGENT.
 */
const DEFAULT_USER_AGENTS: Record<'openai' | 'anthropic' | 'azure', string> = {
  openai: 'openai-python/2.40.0',
  azure: 'openai-python/2.40.0',
  anthropic: 'anthropic-sdk-python/0.105.2',
};

/**
 * Lowercased prefixes/substrings of generic scripting-client User-Agents that
 * some upstream providers reject outright. These carry no useful identity, so
 * we replace them with a neutral default UA rather than forwarding them.
 */
const BLOCKED_USER_AGENT_PATTERNS = [
  'python-requests',
  'python-httpx',
  'python-urllib',
  'aiohttp',
  'go-http-client',
  'curl/',
  'wget/',
  'okhttp',
  'node-fetch',
  'axios/',
  'undici',
  'java/',
  'libwww-perl',
];

/**
 * Decide which User-Agent to present to the upstream provider.
 *
 * A legitimate client UA (e.g. `claude-cli/1.2.3`) is forwarded unchanged so
 * the upstream sees the real caller. A missing UA, or one belonging to a
 * generic scripting library known to be blocked, is replaced with a neutral
 * SDK UA matching the upstream format — never anything that identifies the
 * relay — so the request is accepted without leaking relay identity.
 */
export function resolveUpstreamUserAgent(
  clientUserAgent: string | undefined,
  headerFormat: 'openai' | 'anthropic' | 'azure'
): string {
  const ua = clientUserAgent?.trim();
  if (ua && !isBlockedUserAgent(ua)) return ua;
  return defaultUserAgent(headerFormat);
}

function isBlockedUserAgent(ua: string): boolean {
  const lower = ua.toLowerCase();
  return BLOCKED_USER_AGENT_PATTERNS.some(p => lower.includes(p));
}

function defaultUserAgent(headerFormat: 'openai' | 'anthropic' | 'azure'): string {
  return process.env.RELAY_DEFAULT_USER_AGENT?.trim() || DEFAULT_USER_AGENTS[headerFormat];
}

function setHeaderCaseInsensitive(
  headers: Record<string, string>,
  name: string,
  value: string
): void {
  const lowerName = name.toLowerCase();
  for (const existingName of Object.keys(headers)) {
    if (existingName !== name && existingName.toLowerCase() === lowerName) {
      delete headers[existingName];
    }
  }
  headers[name] = value;
}

/**
 * Build upstream request headers based on provider format.
 *
 * `passthroughHeaders` carries client headers that should reach the upstream
 * unchanged. For Anthropic upstreams, this includes anthropic-beta, x-app,
 * x-claude-code-session-id, x-stainless-*, anthropic-dangerous-direct-browser-access,
 * etc. — all headers that help the upstream identify client context and enable features.
 * For OpenAI/Azure upstreams, passthroughHeaders are still forwarded (e.g. for
 * x-stainless-* SDK tracking), but Anthropic-specific headers are harmless noise.
 */
export function buildHeaders(
  headerFormat: 'openai' | 'anthropic' | 'azure',
  apiKey: string,
  isStream: boolean,
  userAgent?: string,
  customUserAgent?: string,
  passthroughHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (headerFormat === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (headerFormat === 'azure') {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  if (isStream) {
    headers['Accept'] = 'text/event-stream';
  }

  // Forward client-supplied headers to the upstream. Relay-managed headers are
  // rejected here as a second line of defense in case a caller bypasses the
  // route-level collector. Other headers are assigned case-insensitively so an
  // intentional override such as anthropic-version cannot become a duplicate.
  if (passthroughHeaders) {
    for (const [name, value] of Object.entries(passthroughHeaders)) {
      if (value && !RELAY_MANAGED_HEADERS.has(name.toLowerCase())) {
        setHeaderCaseInsensitive(headers, name, value);
      }
    }
  }

  // Priority: custom provider UA > client UA > default SDK UA
  setHeaderCaseInsensitive(
    headers,
    'User-Agent',
    customUserAgent || resolveUpstreamUserAgent(userAgent, headerFormat)
  );

  return headers;
}

/**
 * Anthropic top-level fields that are either explicitly translated below or
 * have no OpenAI equivalent. They must NOT be blindly passed through to an
 * OpenAI upstream (e.g. `top_k`, `thinking`, `metadata` would trigger a 400).
 */
const ANTHROPIC_ONLY_OR_HANDLED_FIELDS = new Set([
  'messages',
  'model',
  'max_tokens',
  'temperature',
  'top_p',
  'top_k',
  'stream',
  'system',
  'stop_sequences',
  'tools',
  'tool_choice',
  'thinking',
  'metadata',
  'anthropic_version',
  'anthropic_beta',
]);

/**
 * Translate an Anthropic `tool_choice` to the OpenAI equivalent.
 *  - {type:'auto'}     → 'auto'
 *  - {type:'any'}      → 'required'
 *  - {type:'tool', name}→ {type:'function', function:{name}}
 */
function translateToolChoice(toolChoice: any): unknown {
  if (!toolChoice || typeof toolChoice !== 'object') return undefined;
  switch (toolChoice.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'tool':
      return toolChoice.name
        ? { type: 'function', function: { name: toolChoice.name } }
        : 'required';
    case 'none':
      return 'none';
    default:
      return undefined;
  }
}

/**
 * Translate Anthropic tool definitions ({name, description, input_schema}) to
 * OpenAI tool definitions ({type:'function', function:{name, description, parameters}}).
 */
function translateToolsToOpenAI(tools: any[]): any[] {
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== 'object') return null;
      // Already in OpenAI shape — pass through.
      if (tool.type === 'function' && tool.function) return tool;
      if (!tool.name) return null;
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.input_schema || { type: 'object', properties: {} },
        },
      };
    })
    .filter(Boolean);
}

/**
 * Flatten an Anthropic content array (which may contain tool_result blocks)
 * into plain text for an OpenAI `tool` message.
 */
function toolResultContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: any) => {
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (part.type === 'tool_result') return toolResultContentToText(part.content);
      return JSON.stringify(part);
    })
    .join('');
}

/**
 * Transform Anthropic-format request to OpenAI format.
 *
 * Handles text, images, and the tool-calling protocol:
 *  - assistant `tool_use` blocks  → assistant message with `tool_calls`
 *  - user `tool_result` blocks    → one OpenAI `tool` message per result
 *  - `tools` / `tool_choice`      → OpenAI function-calling shapes
 */
export function transformAnthropicToOpenAI(body: Record<string, any>): Record<string, any> {
  const { messages, model, max_tokens, temperature, top_p, stream, system, stop_sequences, tools, tool_choice } = body;

  const openAiMessages: any[] = [];
  if (system) {
    const systemContent = typeof system === 'string' ? system : Array.isArray(system)
      ? system.map((part: any) => part.text || '').join('')
      : '';
    if (systemContent) {
      openAiMessages.push({ role: 'system', content: systemContent });
    }
  }

  for (const msg of messages || []) {
    // String content: trivial passthrough.
    if (typeof msg.content === 'string') {
      openAiMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
      continue;
    }

    if (!Array.isArray(msg.content)) {
      openAiMessages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: '',
      });
      continue;
    }

    // Array content: may mix text/image/tool_use (assistant) or text/tool_result (user).
    const textAndImageParts: any[] = [];
    const toolCalls: any[] = [];
    const toolResultMessages: any[] = [];

    for (const part of msg.content) {
      if (!part || typeof part !== 'object') continue;

      if (part.type === 'text') {
        textAndImageParts.push({ type: 'text', text: part.text || '' });
      } else if (part.type === 'image' && part.source) {
        const mimeType = part.source.media_type || 'image/jpeg';
        const base64Data = part.source.data || '';
        textAndImageParts.push({
          type: 'image_url',
          image_url: { url: `data:${mimeType};base64,${base64Data}` },
        });
      } else if (part.type === 'tool_use') {
        // Anthropic tool_use → OpenAI assistant tool_call
        toolCalls.push({
          id: part.id,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input ?? {}),
          },
        });
      } else if (part.type === 'tool_result') {
        // Anthropic tool_result → OpenAI tool message (one per result)
        let resultContent = toolResultContentToText(part.content);
        // OpenAI tool messages have no explicit error flag, so prefix error results.
        if (part.is_error) {
          resultContent = `[ERROR] ${resultContent}`;
        }
        toolResultMessages.push({
          role: 'tool',
          tool_call_id: part.tool_use_id,
          content: resultContent,
        });
      }
    }

    if (msg.role === 'assistant') {
      // Assistant turn: combine text content with any tool_calls.
      const assistantMsg: any = { role: 'assistant' };
      const textOnly = textAndImageParts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      assistantMsg.content = textOnly || null;
      if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
      // Skip an entirely empty assistant message.
      if (assistantMsg.content !== null || toolCalls.length > 0) {
        openAiMessages.push(assistantMsg);
      }
    } else {
      // User turn: emit content (text/image) first, then tool results as separate messages.
      if (textAndImageParts.length > 0) {
        // If only text, collapse to a string for broader upstream compatibility.
        const onlyText = textAndImageParts.every((p) => p.type === 'text');
        openAiMessages.push({
          role: 'user',
          content: onlyText ? textAndImageParts.map((p) => p.text).join('') : textAndImageParts,
        });
      }
      for (const trm of toolResultMessages) {
        openAiMessages.push(trm);
      }
    }
  }

  const openAiBody: Record<string, any> = {
    model,
    messages: openAiMessages,
  };

  if (max_tokens !== undefined) openAiBody.max_tokens = max_tokens;
  if (temperature !== undefined) openAiBody.temperature = temperature;
  if (top_p !== undefined) openAiBody.top_p = top_p;
  if (stream !== undefined) openAiBody.stream = stream;
  if (stop_sequences) openAiBody.stop = stop_sequences;

  if (Array.isArray(tools) && tools.length > 0) {
    const translatedTools = translateToolsToOpenAI(tools);
    if (translatedTools.length > 0) openAiBody.tools = translatedTools;
  }
  if (tool_choice !== undefined) {
    const tc = translateToolChoice(tool_choice);
    if (tc !== undefined) openAiBody.tool_choice = tc;
  }

  // Passthrough any other options that are NOT Anthropic-specific or already handled.
  for (const [key, val] of Object.entries(body)) {
    if (!ANTHROPIC_ONLY_OR_HANDLED_FIELDS.has(key)) {
      openAiBody[key] = val;
    }
  }

  return openAiBody;
}

/**
 * Parse an OpenAI tool_call `arguments` string into a JSON object for the
 * Anthropic `tool_use.input` field. Falls back to an empty object on malformed
 * JSON so a single bad call doesn't break the whole response.
 */
function parseToolArguments(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object') return args as Record<string, unknown>;
  if (typeof args !== 'string' || args.trim() === '') return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Transform OpenAI chat completion response to Anthropic message format.
 *
 * Handles text and the tool-calling protocol (OpenAI `tool_calls` →
 * Anthropic `tool_use` content blocks). NOTE: extended-thinking blocks have no
 * OpenAI equivalent, so an OpenAI upstream can never produce them; we simply
 * omit them rather than emitting a malformed block.
 */
export function transformOpenAIToAnthropic(
  openAiResponse: Record<string, any>,
  model: string
): Record<string, any> {
  const content: any[] = [];
  const message = openAiResponse.choices?.[0]?.message;
  if (message) {
    if (message.content) {
      content.push({
        type: 'text',
        text: message.content,
      });
    }
    // OpenAI tool_calls → Anthropic tool_use blocks
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (!call || call.type !== 'function' || !call.function) continue;
        content.push({
          type: 'tool_use',
          id: call.id || `toolu_${Date.now().toString(36)}_${content.length}`,
          name: call.function.name,
          input: parseToolArguments(call.function.arguments),
        });
      }
    }
  }

  const stopReasonMap: Record<string, string> = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
    content_filter: 'stop_sequence',
  };

  const openAiFinishReason = openAiResponse.choices?.[0]?.finish_reason;
  const stopReason = stopReasonMap[openAiFinishReason] || null;

  return {
    id: openAiResponse.id || `msg_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openAiResponse.usage?.prompt_tokens || 0,
      output_tokens: openAiResponse.usage?.completion_tokens || 0,
    },
  };
}

export function mapAnthropicStopReasonToOpenAI(stopReason: string | null | undefined): string | null {
  if (!stopReason) return null;
  const map: Record<string, string> = {
    end_turn: 'stop',
    max_tokens: 'length',
    stop_sequence: 'stop',
    tool_use: 'tool_calls',
  };
  return map[stopReason] || 'stop';
}

/**
 * Transform an Anthropic message response to OpenAI Chat Completions format.
 *
 * This keeps OpenAI-compatible clients insulated from a fallback to an
 * Anthropic-format upstream. Text blocks are concatenated into message.content,
 * and tool_use blocks are translated to OpenAI tool_calls.
 */
export function transformAnthropicMessageToOpenAIChat(
  anthropicResponse: Record<string, any>,
  model: string
): ChatCompletionResponse {
  const toolCalls: any[] = [];
  let text = '';

  for (const part of anthropicResponse.content || []) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      text += part.text;
    } else if (part.type === 'tool_use') {
      toolCalls.push({
        id: part.id || `call_${Date.now().toString(36)}_${toolCalls.length}`,
        type: 'function',
        function: {
          name: part.name || '',
          arguments: JSON.stringify(part.input ?? {}),
        },
      });
    }
  }

  const finishReason = anthropicResponse.stop_reason
    ? mapAnthropicStopReasonToOpenAI(anthropicResponse.stop_reason)
    : null;

  const promptTokens = anthropicResponse.usage?.input_tokens || 0;
  const completionTokens = anthropicResponse.usage?.output_tokens || 0;

  const message: ChatCompletionResponse['choices'][number]['message'] = {
    role: 'assistant',
    content: text || null,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  return {
    id: anthropicResponse.id || `chatcmpl_${Date.now().toString(36)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}
