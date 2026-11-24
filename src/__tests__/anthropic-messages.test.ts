import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

describe('Anthropic Messages API relay', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RELAY_API_KEY', 'relay-test-key');
    vi.stubEnv('CLAUDE_KEYS', 'claude-upstream-key');
    vi.stubEnv('RELAY_DAILY_LIMIT', '0');
    vi.stubEnv('RELAY_MONTHLY_LIMIT', '0');
  });

  it('accepts x-api-key relay auth and forwards native Claude messages to Anthropic providers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text: 'pong' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 2 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/v1/messages/route');
    const res = await POST(req({
      model: 'claude-sonnet',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'ping' }],
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Relay-Provider')).toBe('anthropic');
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-api-key': 'claude-upstream-key',
        'anthropic-version': '2023-06-01',
      }),
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 32,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    }));
  });

  it('rejects non-Anthropic models on the native Messages endpoint', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { POST } = await import('../app/v1/messages/route');
    const res = await POST(req({
      model: 'gpt-5.4',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'ping' }],
    }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error.message).toContain('requires a claude-* model');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
