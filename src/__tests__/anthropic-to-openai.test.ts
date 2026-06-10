import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { transformAnthropicToOpenAI, transformOpenAIToAnthropic } from '../lib/relay/transform';
import { savePriorityRules } from '../lib/admin/admin-config';

describe('Anthropic-to-OpenAI Payload Translation', () => {
  it('should translate basic Anthropic request to OpenAI format', () => {
    const input = {
      model: 'claude-sonnet',
      max_tokens: 512,
      messages: [
        { role: 'user', content: 'hello' }
      ],
      system: 'You are a helpful assistant',
      temperature: 0.5,
      top_p: 0.9,
      stop_sequences: ['\n\nHuman:'],
      stream: true,
      custom_param: 'passed-through'
    };

    const output = transformAnthropicToOpenAI(input);

    expect(output.model).toBe('claude-sonnet');
    expect(output.max_tokens).toBe(512);
    expect(output.temperature).toBe(0.5);
    expect(output.top_p).toBe(0.9);
    expect(output.stop).toEqual(['\n\nHuman:']);
    expect(output.stream).toBe(true);
    expect(output.custom_param).toBe('passed-through');

    expect(output.messages).toHaveLength(2);
    expect(output.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant' });
    expect(output.messages[1]).toEqual({ role: 'user', content: 'hello' });
  });

  it('should handle array system messages and multimodal image conversion', () => {
    const input = {
      model: 'claude-sonnet',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe this' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
              }
            }
          ]
        }
      ],
      system: [{ type: 'text', text: 'system instruction' }]
    };

    const output = transformAnthropicToOpenAI(input);

    expect(output.messages[0]).toEqual({ role: 'system', content: 'system instruction' });
    
    const userMsg = output.messages[1];
    expect(userMsg.role).toBe('user');
    expect(userMsg.content).toHaveLength(2);
    expect(userMsg.content[0]).toEqual({ type: 'text', text: 'describe this' });
    expect(userMsg.content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      }
    });
  });

  it('should translate OpenAI response to Anthropic message format', () => {
    const openAiResponse = {
      id: 'chatcmpl-999',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello, this is a response.'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40
      }
    };

    const output = transformOpenAIToAnthropic(openAiResponse, 'claude-sonnet');

    expect(output.id).toBe('chatcmpl-999');
    expect(output.type).toBe('message');
    expect(output.role).toBe('assistant');
    expect(output.model).toBe('claude-sonnet');
    expect(output.content).toEqual([{ type: 'text', text: 'Hello, this is a response.' }]);
    expect(output.stop_reason).toBe('end_turn');
    expect(output.usage).toEqual({ input_tokens: 15, output_tokens: 25 });
  });

  it('should translate Anthropic tools and tool_choice to OpenAI shape', () => {
    const input = {
      model: 'claude-sonnet',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'what is the weather?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get current weather',
          input_schema: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'get_weather' },
      top_k: 40,
    };

    const output = transformAnthropicToOpenAI(input);

    expect(output.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: { location: { type: 'string' } },
            required: ['location'],
          },
        },
      },
    ]);
    expect(output.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });
    // Anthropic-only params must NOT leak to the OpenAI upstream.
    expect(output.top_k).toBeUndefined();
  });

  it('should translate assistant tool_use and user tool_result turns to OpenAI messages', () => {
    const input = {
      model: 'claude-sonnet',
      max_tokens: 100,
      messages: [
        { role: 'user', content: 'weather in SF?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'let me check' },
            { type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { location: 'SF' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny, 22C' },
          ],
        },
      ],
    };

    const output = transformAnthropicToOpenAI(input);

    expect(output.messages[0]).toEqual({ role: 'user', content: 'weather in SF?' });

    const assistantMsg = output.messages[1];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toBe('let me check');
    expect(assistantMsg.tool_calls).toEqual([
      {
        id: 'toolu_1',
        type: 'function',
        function: { name: 'get_weather', arguments: JSON.stringify({ location: 'SF' }) },
      },
    ]);

    const toolMsg = output.messages[2];
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'toolu_1', content: 'sunny, 22C' });
  });

  it('should translate OpenAI tool_calls response to Anthropic tool_use blocks', () => {
    const openAiResponse = {
      id: 'chatcmpl-tool',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function',
                function: { name: 'get_weather', arguments: '{"location":"SF"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const output = transformOpenAIToAnthropic(openAiResponse, 'claude-sonnet');

    expect(output.stop_reason).toBe('tool_use');
    expect(output.content).toEqual([
      { type: 'tool_use', id: 'call_abc', name: 'get_weather', input: { location: 'SF' } },
    ]);
  });
});

describe('Anthropic-to-OpenAI End-to-End Routing', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RELAY_API_KEY', 'relay-test-key');
    vi.stubEnv('OPENAI_KEYS', 'openai-upstream-key');
    vi.stubEnv('RELAY_DAILY_LIMIT', '0');
    vi.stubEnv('RELAY_MONTHLY_LIMIT', '0');
    await savePriorityRules([
      { id: 'rule1', name: 'Claude to OpenAI', enabled: true, modelPattern: 'claude-*', providerOrder: ['openai'] }
    ]);
  });

  function req(body: unknown, key = 'relay-test-key') {
    return new NextRequest('http://localhost/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  it('should translate non-stream Anthropic requests and route to OpenAI providers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'chatcmpl-mock',
      choices: [{
        message: { role: 'assistant', content: 'hello' },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 5, completion_tokens: 3 }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/v1/messages/route');
    const res = await POST(req({
      model: 'claude-sonnet',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }]
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Relay-Provider')).toBe('openai');

    // Confirm that fetch was called with the OpenAI-compatible URL and translated request body
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Authorization': 'Bearer openai-upstream-key'
      })
    }));

    const fetchCallArgs = (fetchMock.mock.calls as any[])[0];
    const bodySent = JSON.parse(fetchCallArgs[1].body as string);
    expect(bodySent.model).toBe('gpt-5.4');
    expect(bodySent.messages).toEqual([{ role: 'user', content: 'hi' }]);

    // Confirm the returned response is translated back to Anthropic format
    const responseJson = await res.json();
    expect(responseJson.id).toBe('chatcmpl-mock');
    expect(responseJson.type).toBe('message');
    expect(responseJson.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(responseJson.stop_reason).toBe('end_turn');
  });

  it('should translate streaming Anthropic requests and route to OpenAI providers', async () => {
    const sseChunks = [
      'data: {"id":"chatcmpl-stream","choices":[{"index":0,"delta":{"role":"assistant","content":"hel"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-stream","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-stream","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });

    const fetchMock = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/v1/messages/route');
    const res = await POST(req({
      model: 'claude-sonnet',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
      stream: true
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let resultText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resultText += decoder.decode(value);
    }

    // Split resultText by \n\n to inspect SSE events
    const events = resultText.split('\n\n').filter(Boolean);
    const eventTypes = events.map((e) => {
      const m = e.match(/^event: (.+)$/m);
      return m ? m[1] : '';
    });

    // Anthropic streaming contract: message_start → ping →
    // content_block_start → content_block_delta* → content_block_stop →
    // message_delta → message_stop.
    expect(eventTypes).toEqual([
      'message_start',
      'ping',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);

    expect(events[0]).toContain('"model":"claude-sonnet"');
    expect(events.find((e) => e.includes('"text":"hel"'))).toBeTruthy();
    expect(events.find((e) => e.includes('"text":"lo"'))).toBeTruthy();

    const deltaEvent = events.find((e) => e.includes('event: message_delta'))!;
    expect(deltaEvent).toContain('"stop_reason":"end_turn"');
    expect(deltaEvent).toContain('"output_tokens":2');
  });

  it('should translate streaming OpenAI tool_calls into Anthropic tool_use blocks', async () => {
    const sseChunks = [
      'data: {"id":"chatcmpl-tool","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-tool","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-tool","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Paris\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-tool","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":7,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n'
    ];

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of sseChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      }
    });

    const fetchMock = vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/v1/messages/route');
    const res = await POST(req({
      model: 'claude-sonnet',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'weather in Paris?' }],
      tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
      stream: true
    }));

    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let resultText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resultText += decoder.decode(value);
    }

    const events = resultText.split('\n\n').filter(Boolean);
    const eventTypes = events.map((e) => {
      const m = e.match(/^event: (.+)$/m);
      return m ? m[1] : '';
    });

    expect(eventTypes).toEqual([
      'message_start',
      'ping',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);

    // tool_use block opened with id + name
    const blockStart = events.find((e) => e.includes('event: content_block_start'))!;
    expect(blockStart).toContain('"type":"tool_use"');
    expect(blockStart).toContain('"id":"call_abc"');
    expect(blockStart).toContain('"name":"get_weather"');

    // arguments streamed as input_json_delta, reassembling to valid JSON
    const partials = events
      .filter((e) => e.includes('input_json_delta'))
      .map((e) => JSON.parse(e.match(/^data: (.+)$/m)![1]).delta.partial_json)
      .join('');
    expect(JSON.parse(partials)).toEqual({ city: 'Paris' });

    // tool_calls finish_reason → tool_use stop reason
    const deltaEvent = events.find((e) => e.includes('event: message_delta'))!;
    expect(deltaEvent).toContain('"stop_reason":"tool_use"');
  });
});

describe('count_tokens endpoint', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RELAY_API_KEY', 'relay-test-key');
    vi.stubEnv('OPENAI_KEYS', 'openai-upstream-key');
    vi.stubEnv('CLAUDE_KEYS', 'anthropic-upstream-key');
    vi.stubEnv('RELAY_DAILY_LIMIT', '0');
    vi.stubEnv('RELAY_MONTHLY_LIMIT', '0');
  });

  function countReq(body: unknown, key = 'relay-test-key') {
    return new NextRequest('http://localhost/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects unauthenticated requests', async () => {
    const { POST } = await import('../app/v1/messages/count_tokens/route');
    const res = await POST(countReq({ model: 'claude-sonnet', messages: [{ role: 'user', content: 'hi' }] }, 'wrong-key'));
    expect(res.status).toBe(401);
  });

  it('forwards to an Anthropic upstream when the model resolves to Anthropic', async () => {
    await savePriorityRules([
      { id: 'rule-a', name: 'Claude native', enabled: true, modelPattern: 'claude-*', providerOrder: ['anthropic'] }
    ]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ input_tokens: 42 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/v1/messages/count_tokens/route');
    const res = await POST(countReq({
      model: 'claude-sonnet',
      messages: [{ role: 'user', content: 'hello there' }]
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.input_tokens).toBe(42);

    // Forwarded to the Anthropic count_tokens endpoint
    const url = (fetchMock.mock.calls as any[])[0]?.[0];
    expect(url).toContain('/messages/count_tokens');
  });

  it('falls back to a local estimate for non-Anthropic upstreams', async () => {
    await savePriorityRules([
      { id: 'rule-o', name: 'Claude to OpenAI', enabled: true, modelPattern: 'claude-*', providerOrder: ['openai'] }
    ]);
    const fetchMock = vi.fn(async () => {
      throw new Error('upstream should not be called for local estimate');
    });
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/v1/messages/count_tokens/route');
    const res = await POST(countReq({
      model: 'claude-sonnet',
      messages: [{ role: 'user', content: 'hello there, this is a longer message' }]
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.input_tokens).toBe('number');
    expect(json.input_tokens).toBeGreaterThan(0);
  });
});
