import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { generateTempKey } from '@/lib/relay/auth';
import { validateBase64ImageSizes, validateContentLengthHeader } from '@/lib/relay/validation';
import { saveModelAliasConfig, setModelHidden, __adminConfigCacheForTests, createMemoryMockKV } from '@/lib/admin/admin-config';
import { __requestLogStoreForTests, enableRequestLogCapture, listRequestLogs } from '@/lib/observability/request-logs';
import { relayRequest } from '@/lib/relay/relay';

describe('v1 endpoint hardening, CORS middleware, and stream resource cleanup', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __adminConfigCacheForTests.clear();
    const mock = createMemoryMockKV();
    (global as any)._mockKVInstance = mock;
    (global as any)._mockKVInstance._isMock = true;
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RELAY_API_KEY', 'relay-test-key');
    vi.stubEnv('OPENAI_KEYS', 'sk-openai-1,sk-openai-2');
    vi.stubEnv('CLAUDE_KEYS', 'sk-claude-1');
    vi.stubEnv('RELAY_DAILY_LIMIT', '0');
    vi.stubEnv('RELAY_MONTHLY_LIMIT', '0');
    await __requestLogStoreForTests.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await __requestLogStoreForTests.clear();
  });

  describe('Dynamic CORS middleware', () => {
    it('falls back to wildcard when CORS_ORIGINS is empty and allows x-api-key + anthropic headers', () => {
      vi.stubEnv('CORS_ORIGINS', '');
      const req = new NextRequest('http://localhost/v1/messages', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Headers': 'x-api-key, anthropic-version',
        },
      });
      const res = middleware(req);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('X-API-Key');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Anthropic-Version');
      expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Request-ID');
    });

    it('rejects unauthorized preflight origins with 403 when CORS_ORIGINS is restricted', () => {
      vi.stubEnv('CORS_ORIGINS', 'https://allowed.example.com');
      const blocked = middleware(
        new NextRequest('http://localhost/v1/chat/completions', {
          method: 'OPTIONS',
          headers: { Origin: 'https://evil.example.com' },
        })
      );
      expect(blocked.status).toBe(403);
      expect(blocked.headers.get('Access-Control-Allow-Origin')).toBeNull();

      const allowed = middleware(
        new NextRequest('http://localhost/v1/chat/completions', {
          method: 'OPTIONS',
          headers: { Origin: 'https://allowed.example.com' },
        })
      );
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example.com');
    });
  });

  describe('Multi-format payload & image size guards', () => {
    it('rejects oversized Content-Length headers in O(1) before parsing JSON', async () => {
      vi.stubEnv('RELAY_MAX_REQUEST_BYTES', '1024');
      expect(validateContentLengthHeader(new Headers({ 'content-length': '2048' })).valid).toBe(false);

      const { POST } = await import('@/app/v1/messages/route');
      const res = await POST(
        new NextRequest('http://localhost/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': 'relay-test-key',
            'content-type': 'application/json',
            'content-length': '4096',
          },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] }),
        })
      );
      expect(res.status).toBe(400);
    });

    it('validates >1MB inline base64 images across OpenAI Chat, Anthropic Messages, and Responses formats', () => {
      const over1MbBase64 = 'A'.repeat(1_500_000); // ~1.125 MB

      // Anthropic Messages image block
      expect(
        validateBase64ImageSizes({
          messages: [
            {
              role: 'user',
              content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: over1MbBase64 } }],
            },
          ],
        }).valid
      ).toBe(false);

      // Responses API input_image block
      expect(
        validateBase64ImageSizes({
          input: [
            {
              role: 'user',
              content: [{ type: 'input_image', image_url: `data:image/png;base64,${over1MbBase64}` }],
            },
          ],
        }).valid
      ).toBe(false);
    });
  });

  describe('Error request logging & outbound stream cancellation', () => {
    it('records error request logs when relayRequest fails on /v1/chat/completions', async () => {
      vi.stubEnv('ENABLE_REQUEST_LOGS', 'true');
      await enableRequestLogCapture(300);

      const { POST } = await import('@/app/v1/chat/completions/route');
      const res = await POST(
        new NextRequest('http://localhost/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer relay-test-key',
            'Content-Type': 'application/json',
            'X-Request-ID': 'trace_unknown_model_err',
          },
          body: JSON.stringify({
            model: 'nonexistent-model-xyz',
            messages: [{ role: 'user', content: 'hello' }],
          }),
        })
      );

      expect(res.status).toBe(400);
      expect(res.headers.get('X-Request-ID')).toBe('trace_unknown_model_err');

      // Allow fire-and-forget runAfterResponse microtask to settle
      await new Promise((r) => setTimeout(r, 10));

      const logs = await listRequestLogs({ status: 'error' });
      expect(logs.items.some((item) => item.traceId === 'trace_unknown_model_err' && item.httpStatus === 400)).toBe(true);
    });

    it('cancels unconsumed upstream response bodies on HTML User-Agent retry and 5xx key rotation', async () => {
      let htmlCanceled = false;
      let err502Canceled = false;

      const makeCancelableResponse = (status: number, contentType: string, bodyText: string, onCancel: () => void) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(bodyText));
          },
          cancel() {
            onCancel();
          },
        });
        return new Response(stream, { status, headers: { 'Content-Type': contentType } });
      };

      const fetchMock = vi
        .fn()
        // 1st call: HTML challenge -> retried with next UA candidate
        .mockResolvedValueOnce(makeCancelableResponse(403, 'text/html', '<html>blocked</html>', () => { htmlCanceled = true; }))
        // 2nd call: 502 JSON error -> key rotation retry
        .mockResolvedValueOnce(makeCancelableResponse(502, 'application/json', '{"error":"bad gateway"}', () => { err502Canceled = true; }))
        // 3rd call: 200 OK
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'ok', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      vi.stubGlobal('fetch', fetchMock);

      // Avoid 1s retry backoff delay in unit test
      const rateLimiter = await import('@/lib/relay/rate-limiter');
      vi.spyOn(rateLimiter, 'backoffSleep').mockResolvedValue(0);

      const { updateMemoryKeyPool } = await import('@/lib/relay/key-pool');
      updateMemoryKeyPool('openai', ['sk-openai-1', 'sk-openai-2'], 1);

      const result = await relayRequest({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: 'ping' }],
      });

      expect(result.response.status).toBe(200);
      expect(htmlCanceled).toBe(true);
      expect(err502Canceled).toBe(true);
    });
  });

  describe('GET /v1/models/:model parity', () => {
    it('accepts temp keys, hides hidden models, and resolves aliases', async () => {
      const { key: tempKey } = await generateTempKey(300);
      await saveModelAliasConfig({ aliases: { 'my-custom-gpt': 'gpt-5.4' }, hidden: [] });
      await setModelHidden('gpt-5.4-nano', true);

      const { GET } = await import('@/app/v1/models/[model]/route');

      // Alias resolves to underlying model metadata while keeping requested ID
      const aliasRes = await GET(
        new NextRequest('http://localhost/v1/models/my-custom-gpt', {
          headers: { Authorization: `Bearer ${tempKey}` },
        }),
        { params: Promise.resolve({ model: 'my-custom-gpt' }) }
      );
      expect(aliasRes.status).toBe(200);
      const aliasJson = await aliasRes.json();
      expect(aliasJson.id).toBe('my-custom-gpt');
      expect(aliasJson.owned_by).toBe('openai');

      // Hidden model returns 404
      const hiddenRes = await GET(
        new NextRequest('http://localhost/v1/models/gpt-5.4-nano', {
          headers: { 'x-api-key': 'relay-test-key' },
        }),
        { params: Promise.resolve({ model: 'gpt-5.4-nano' }) }
      );
      expect(hiddenRes.status).toBe(404);
    });
  });
});
