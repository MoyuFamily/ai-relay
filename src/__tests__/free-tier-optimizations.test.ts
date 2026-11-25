import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDefaultUpstreamTimeoutMs,
  getDefaultMaxConcurrent,
  getDefaultMaxQueue,
  getDefaultMaxRequestBytes,
  relayRequest,
} from '@/lib/relay';
import { createByteCountingStream } from '@/lib/usage/stream-usage';
import { BatchUsageRecorder, createUsageEvent } from '@/lib/usage';
import { KVUsageStorage } from '@/lib/usage/storage/kv-storage';
import { KVRequestLogStore } from '@/lib/observability/request-log-store/kv-store';
import { D1RequestLogStore } from '@/lib/observability/request-log-store/d1-store';
import { __adminConfigCacheForTests, createMemoryMockKV } from '@/lib/admin/admin-config';
import { __resetKeyPoolsForTests, updateMemoryKeyPool } from '@/lib/relay/key-pool';
import { __resetD1SchemaCacheForTests } from '@/lib/db/d1-schema';
import { maxDuration as chatMaxDuration } from '@/app/v1/chat/completions/route';
import { maxDuration as messagesMaxDuration } from '@/app/v1/messages/route';
import { maxDuration as responsesMaxDuration } from '@/app/v1/responses/route';

/** Minimal in-memory fake D1 database for testing D1RequestLogStore & D1 latency storage. */
function createFakeD1() {
  const logs: Array<Record<string, any>> = [];
  const flags = new Map<string, { value: string; expires_at: string | null }>();
  let queryCount = 0;

  const execSql = (sql: string, params: any[]) => {
    queryCount++;
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (/^CREATE (TABLE|INDEX)/i.test(normalized)) {
      return { results: [], success: true };
    }
    if (/^INSERT INTO config_flags/i.test(normalized)) {
      const [key, expiresAtOrVal, maybeExpires] = params;
      if (normalized.includes("VALUES (?, '1', ?")) {
        flags.set(String(key), { value: '1', expires_at: expiresAtOrVal ? String(expiresAtOrVal) : null });
      } else {
        flags.set(String(key), { value: String(expiresAtOrVal), expires_at: maybeExpires ? String(maybeExpires) : null });
      }
      return { results: [], success: true };
    }
    if (/^SELECT value, expires_at FROM config_flags WHERE key = \?/i.test(normalized)) {
      const row = flags.get(String(params[0]));
      return { results: row ? [row] : [], success: true };
    }
    if (/^SELECT value FROM config_flags WHERE key = \?/i.test(normalized)) {
      const row = flags.get(String(params[0]));
      return { results: row ? [{ value: row.value }] : [], success: true };
    }
    if (/^DELETE FROM config_flags WHERE key = \?/i.test(normalized)) {
      flags.delete(String(params[0]));
      return { results: [], success: true };
    }
    if (/^INSERT INTO request_logs/i.test(normalized)) {
      logs.push({
        id: params[0],
        trace_id: params[1],
        timestamp: params[2],
        api_key_hash: params[3],
        model: params[4],
        provider: params[5],
        status: params[6],
        http_status: params[7],
        latency_ms: params[8],
        prompt_tokens: params[9],
        completion_tokens: params[10],
        total_tokens: params[11],
        is_stream: params[12],
        error_type: params[13],
        error_message: params[14],
        diagnostic: params[15],
      });
      return { results: [], success: true };
    }
    if (/^SELECT trace_id, timestamp/i.test(normalized)) {
      let filtered = [...logs];
      let idx = 0;
      if (normalized.includes('status = ?')) {
        const status = params[idx++];
        filtered = filtered.filter((r) => r.status === status);
      }
      if (normalized.includes('provider = ?')) {
        const provider = params[idx++];
        filtered = filtered.filter((r) => r.provider === provider);
      }
      const limit = Number(params[idx] ?? 100);
      filtered.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
      return { results: filtered.slice(0, limit), success: true };
    }
    if (/^DELETE FROM request_logs WHERE id IN/i.test(normalized)) {
      const keep = Number(params[0]);
      logs.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
      logs.splice(keep);
      return { results: [], success: true };
    }
    if (/^DELETE FROM request_logs$/i.test(normalized)) {
      logs.length = 0;
      return { results: [], success: true };
    }
    return { results: [], success: true };
  };

  const makeStmt = (sql: string, params: any[] = []) => ({
    sql,
    params,
    bind(...next: any[]) {
      return makeStmt(sql, next);
    },
    async run() {
      return execSql(sql, params);
    },
    async first<T = any>(): Promise<T | null> {
      const res = execSql(sql, params);
      return (res.results[0] as T) ?? null;
    },
    async all() {
      return execSql(sql, params);
    },
  });

  return {
    logs,
    flags,
    getQueryCount: () => queryCount,
    db: {
      prepare(sql: string) {
        return makeStmt(sql);
      },
      async batch(stmts: Array<{ run: () => Promise<any> }>) {
        const out = [];
        for (const s of stmts) {
          out.push(await s.run());
        }
        return out;
      },
    } as any,
  };
}

describe('Vercel & Cloudflare Free Tier optimizations', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.CF_PAGES;
    delete process.env.RELAY_UPSTREAM_TIMEOUT_MS;
    delete process.env.RELAY_FALLBACK_ON_TIMEOUT;
    delete process.env.RELAY_MAX_CONCURRENT;
    delete process.env.RELAY_MAX_QUEUE;
    delete process.env.RELAY_MAX_REQUEST_BYTES;
    __adminConfigCacheForTests.resetClients();
    __resetKeyPoolsForTests();
    __resetD1SchemaCacheForTests();
    const mock = createMemoryMockKV();
    (global as any)._mockKVInstance = mock;
    (global as any)._mockKVInstance._isMock = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
    delete (globalThis as any)[Symbol.for('__cloudflare-context__')];
    __resetKeyPoolsForTests();
    __resetD1SchemaCacheForTests();
  });

  describe('Platform-aware defaults (Vercel Fluid Compute, CF Workers, VPS)', () => {
    it('exports maxDuration = 300 on all /v1/* route handlers for Vercel Hobby Fluid Compute', () => {
      expect(chatMaxDuration).toBe(300);
      expect(messagesMaxDuration).toBe(300);
      expect(responsesMaxDuration).toBe(300);
    });

    it('uses 90s timeout on Cloudflare, 240s on Vercel, and 300s on self-hosted Node', () => {
      expect(getDefaultUpstreamTimeoutMs()).toBe(300_000);

      vi.stubEnv('VERCEL', '1');
      expect(getDefaultUpstreamTimeoutMs()).toBe(240_000);

      vi.unstubAllEnvs();
      vi.stubEnv('CF_PAGES', '1');
      expect(getDefaultUpstreamTimeoutMs()).toBe(90_000);
    });

    it('uses 5/10 concurrency defaults on Cloudflare and 20/50 on Vercel/Node', () => {
      expect(getDefaultMaxConcurrent()).toBe(20);
      expect(getDefaultMaxQueue()).toBe(50);

      vi.stubEnv('VERCEL', '1');
      expect(getDefaultMaxConcurrent()).toBe(20);
      expect(getDefaultMaxQueue()).toBe(50);

      vi.unstubAllEnvs();
      vi.stubEnv('CF_PAGES', '1');
      expect(getDefaultMaxConcurrent()).toBe(5);
      expect(getDefaultMaxQueue()).toBe(10);
    });

    it('aligns default request-body size cap to 4.5MB on Vercel and 10MB elsewhere', () => {
      expect(getDefaultMaxRequestBytes()).toBe(10 * 1024 * 1024);

      vi.stubEnv('VERCEL', '1');
      expect(getDefaultMaxRequestBytes()).toBe(Math.floor(4.5 * 1024 * 1024));
    });
  });

  describe('D1RequestLogStore (Cloudflare D1 instead of CF KV)', () => {
    it('stores, filters, prunes, clears logs in D1 and caches capture flag', async () => {
      const fake = createFakeD1();
      (globalThis as any)[Symbol.for('__cloudflare-context__')] = { env: { DB: fake.db } };
      vi.stubEnv('REQUEST_LOGS_MAX_ENTRIES', '2');

      const store = new D1RequestLogStore();

      // Initially capture is off; repeated checks hit the 15s cache
      expect(await store.isCaptureEnabled()).toBe(false);
      const countAfterFirst = fake.getQueryCount();
      expect(await store.isCaptureEnabled()).toBe(false);
      expect(fake.getQueryCount()).toBe(countAfterFirst);

      // Enable capture and append 3 logs (pruned to 2)
      await store.enableCapture(300);
      expect(await store.isCaptureEnabled()).toBe(true);

      for (let i = 1; i <= 3; i++) {
        await store.append({
          traceId: `trace_d1_${i}`,
          timestamp: `2026-11-25T00:00:0${i}.000Z`,
          apiKeyHash: 'abc123',
          model: 'claude-sonnet-5-5',
          provider: i === 2 ? 'anthropic' : 'openai',
          status: i === 2 ? 'error' : 'success',
          httpStatus: i === 2 ? 502 : 200,
          latencyMs: 120,
          isStream: true,
        });
      }

      const all = await store.list({ limit: 10 });
      expect(all).toHaveLength(2);
      expect(all[0].traceId).toBe('trace_d1_3');
      expect(all[1].traceId).toBe('trace_d1_2');

      const errors = await store.list({ status: 'error', provider: 'anthropic' });
      expect(errors).toHaveLength(1);
      expect(errors[0].traceId).toBe('trace_d1_2');

      await store.clear();
      expect(await store.list()).toHaveLength(0);
      expect(await store.isCaptureEnabled()).toBe(false);
    });

    it('persists smart-routing latency samples into D1 on Cloudflare without touching CF KV', async () => {
      const fake = createFakeD1();
      const kvPutSpy = vi.fn();
      const waitUntilPromises: Promise<unknown>[] = [];
      (globalThis as any)[Symbol.for('__cloudflare-context__')] = {
        env: {
          DB: fake.db,
          KV: { get: vi.fn(), put: kvPutSpy, delete: vi.fn(), list: vi.fn() },
        },
        ctx: {
          waitUntil(p: Promise<unknown>) {
            waitUntilPromises.push(p);
          },
        },
      };

      const { recordLatency, getLatencyStats } = await import('@/lib/smart-routing/latency-tracker');
      const providerKey = `cf_d1_lat_${Date.now()}`;
      recordLatency(providerKey, 180, true, 200);
      await Promise.all(waitUntilPromises);

      expect(kvPutSpy).not.toHaveBeenCalled();
      expect(fake.flags.has(`relay:route:latency:${providerKey}`)).toBe(true);

      const stats = await getLatencyStats(providerKey);
      expect(stats.avgLatencyMs).toBe(180);
      expect(stats.sampleCount).toBe(1);
    });
  });

  describe('KVRequestLogStore capture-flag TTL caching (Upstash command savings)', () => {
    it('caches isCaptureEnabled() across requests and invalidates on enableCapture/clear', async () => {
      const kv = (global as any)._mockKVInstance;
      const getSpy = vi.spyOn(kv, 'get');
      const store = new KVRequestLogStore();

      expect(await store.isCaptureEnabled()).toBe(false);
      expect(await store.isCaptureEnabled()).toBe(false);
      expect(getSpy).toHaveBeenCalledTimes(1);

      await store.enableCapture(300);
      expect(await store.isCaptureEnabled()).toBe(true);
      // Served from cache updated by enableCapture()
      expect(getSpy).toHaveBeenCalledTimes(1);

      await store.clear();
      expect(await store.isCaptureEnabled()).toBe(false);
    });
  });

  describe('Raw-body forwarding on non-CF platforms & client disconnect abort', () => {
    it('forwards rawBody verbatim on Vercel/Node when OpenAI streaming already sets stream_options.include_usage', async () => {
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('OPENAI_KEYS', 'sk-openai-raw');
      updateMemoryKeyPool('openai', ['sk-openai-raw'], 1);

      let sentBody: string | undefined;
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        sentBody = typeof init?.body === 'string' ? init.body : undefined;
        return new Response(JSON.stringify({ id: 'ok', choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      // Distinctive whitespace proves the raw string was forwarded without JSON.stringify
      const rawBody = '{  "model" : "gpt-6-luna" , "stream" : true , "stream_options" : { "include_usage" : true } , "messages" : [{"role":"user","content":"hi"}]  }';
      await relayRequest(JSON.parse(rawBody), 'chat', undefined, rawBody);

      expect(sentBody).toBe(rawBody);
    });

    it('propagates client AbortSignal to upstream fetch and returns 499 without retrying', async () => {
      vi.stubEnv('OPENAI_KEYS', 'sk-openai-1,sk-openai-2');
      updateMemoryKeyPool('openai', ['sk-openai-1', 'sk-openai-2'], 1);

      let upstreamAborted = false;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            upstreamAborted = true;
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
      );
      vi.stubGlobal('fetch', fetchMock);

      const clientController = new AbortController();
      const promise = relayRequest(
        { model: 'gpt-6-luna', messages: [{ role: 'user', content: 'hi' }] },
        'chat',
        undefined,
        undefined,
        undefined,
        clientController.signal
      );

      // Abort client request mid-flight
      await new Promise((r) => setTimeout(r, 10));
      clientController.abort();

      await expect(promise).rejects.toMatchObject({
        status: 499,
        type: 'client_closed_request',
      });
      expect(upstreamAborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('invokes onCancel callback when createByteCountingStream is cancelled', async () => {
      let upstreamCanceled = false;
      const onCancel = vi.fn();
      const source = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {
          upstreamCanceled = true;
        },
      });

      const wrapped = createByteCountingStream(source, () => {}, onCancel);
      const reader = wrapped.getReader();
      await reader.read();
      await reader.cancel();

      expect(upstreamCanceled).toBe(true);
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('falls back to secondary provider on timeout when RELAY_FALLBACK_ON_TIMEOUT=true', async () => {
      vi.useFakeTimers();
      try {
        vi.stubEnv('OPENAI_KEYS', 'sk-openai-1');
        vi.stubEnv('DEEPSEEK_KEYS', 'sk-deepseek-1');
        vi.stubEnv('RELAY_UPSTREAM_TIMEOUT_MS', '1000');
        vi.stubEnv('RELAY_FALLBACK_ON_TIMEOUT', 'true');
        updateMemoryKeyPool('openai', ['sk-openai-1'], 1);
        updateMemoryKeyPool('deepseek', ['sk-deepseek-1'], 1);

        const adminConfig = await import('@/lib/admin/admin-config');
        vi.spyOn(adminConfig, 'getFallbackChain').mockResolvedValue(['deepseek']);

        const fetchMock = vi
          .fn()
          .mockImplementationOnce(
            (_url: string, init?: RequestInit) =>
              new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                  const err = new Error('timeout');
                  err.name = 'AbortError';
                  reject(err);
                });
              })
          )
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ id: 'fb-ok', choices: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          );
        vi.stubGlobal('fetch', fetchMock);

        const promise = relayRequest({
          model: 'gpt-6-luna',
          messages: [{ role: 'user', content: 'hi' }],
        });

        await vi.advanceTimersByTimeAsync(1000);
        const result = await promise;
        expect(result.provider.name).toBe('deepseek');
        expect(result.response.status).toBe(200);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('BatchUsageRecorder.flushForServerlessAfter()', () => {
    it('batches small fresh counts and flushes when reaching 10 events or 15s age', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-11-25T00:00:00Z'));
        const storage = new KVUsageStorage();
        const recorder = new BatchUsageRecorder();
        recorder.setStorage(storage);
        const flushSpy = vi.spyOn(recorder, 'flush');

        const evt = () =>
          createUsageEvent({
            provider: 'openai',
            model: 'gpt-6-luna',
            apiKeyHash: 'h1',
            statusCode: 200,
            promptTokens: 5,
            completionTokens: 5,
            isStream: false,
          });

        // 1 fresh event -> stay buffered to save Upstash commands
        await recorder.record(evt());
        await recorder.flushForServerlessAfter();
        expect(flushSpy).toHaveBeenCalledTimes(0);

        // Advance 15s -> age threshold triggers flush inside after()
        vi.advanceTimersByTime(15_000);
        await recorder.flushForServerlessAfter();
        expect(flushSpy).toHaveBeenCalledTimes(1);

        // 10 rapid events -> batch size threshold triggers flush inside after()
        for (let i = 0; i < 10; i++) {
          await recorder.record(evt());
        }
        await recorder.flushForServerlessAfter();
        expect(flushSpy).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
