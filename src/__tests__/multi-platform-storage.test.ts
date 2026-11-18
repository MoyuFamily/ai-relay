import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CFKVAdapter } from '@/lib/admin/cf-kv-adapter';
import {
  __adminConfigCacheForTests,
  createMemoryMockKV,
  getGlobalConfigVersion,
  saveCustomProvider,
  saveModelAliasConfig,
  setFallbackChain,
  setManagedKeys,
} from '@/lib/admin/admin-config';
import { KVRequestLogStore } from '@/lib/observability/request-log-store/kv-store';
import { __healthStoreForTests, getProviderHealthSnapshot, recordHealthProbeResult } from '@/lib/health/storage';
import { __usageReportStoreForTests, aggregateUsageDailyReport } from '@/lib/usage/daily-report-store';
import { __resetDefaultConfigStore, getDefaultConfigStore } from '@/lib/config-store';
import { PostgresConfigStore } from '@/lib/config-store/postgres-store';
import { detectRuntime } from '@/lib/runtime/capabilities';
import worker from '../../worker';

function createFakeCFKVNamespace(delayMs = 0) {
  const map = new Map<string, { value: string; expirationTtl?: number }>();
  const wait = () => (delayMs > 0 ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());

  return {
    map,
    namespace: {
      async get(key: string) {
        await wait();
        return map.get(key)?.value ?? null;
      },
      async put(key: string, value: string, options?: { expirationTtl?: number }) {
        await wait();
        map.set(key, { value, expirationTtl: options?.expirationTtl });
      },
      async delete(key: string) {
        await wait();
        map.delete(key);
      },
      async list(options?: { prefix?: string }) {
        await wait();
        const prefix = options?.prefix || '';
        const keys = Array.from(map.keys())
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name }));
        return { keys, list_complete: true, cacheStatus: null };
      },
    } as any,
  };
}

describe('Multi-platform storage & Cloudflare compatibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __adminConfigCacheForTests.clear();
    __healthStoreForTests.clearCache();
    __usageReportStoreForTests.reset();
    __resetDefaultConfigStore();
    const mock = createMemoryMockKV();
    (global as any)._mockKVInstance = mock;
    (global as any)._mockKVInstance._isMock = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetDefaultConfigStore();
  });

  describe('CFKVAdapter correctness and concurrency safety', () => {
    it('supports variadic sadd and srem without dropping members', async () => {
      const { namespace } = createFakeCFKVNamespace();
      const adapter = new CFKVAdapter(namespace);

      const added = await adapter.sadd('error:keys:2026-11-18', 'hash1', 'hash2', 'hash3', 'hash2');
      expect(added).toBe(3);
      expect(await adapter.smembers('error:keys:2026-11-18')).toEqual(['hash1', 'hash2', 'hash3']);

      const removed = await adapter.srem('error:keys:2026-11-18', 'hash1', 'hash3');
      expect(removed).toBe(2);
      expect(await adapter.smembers('error:keys:2026-11-18')).toEqual(['hash2']);
    });

    it('serializes same-key mutations in pipeline() to prevent read-modify-write lost updates', async () => {
      // Simulate 5ms network latency on every CF KV get/put so unserialized
      // Promise.all calls would race and overwrite each other.
      const { namespace } = createFakeCFKVNamespace(5);
      const adapter = new CFKVAdapter(namespace);

      const p = adapter.pipeline();
      p.hincrby('usage:daily:2026-11-18', 'requests', 1);
      p.hincrby('usage:daily:2026-11-18', 'tokens', 120);
      p.hincrby('usage:daily:2026-11-18', 'promptTokens', 50);
      p.hincrby('usage:daily:2026-11-18', 'completionTokens', 70);
      p.del('error:keys:2026-11-18');
      p.sadd('error:keys:2026-11-18', 'k1', 'k2');
      await p.exec();

      expect(await adapter.hgetall('usage:daily:2026-11-18')).toEqual({
        requests: 1,
        tokens: 120,
        promptTokens: 50,
        completionTokens: 70,
      });
      expect(await adapter.smembers('error:keys:2026-11-18')).toEqual(['k1', 'k2']);
    });

    it('clamps TTLs shorter than 60s up to CF KV minimum 60s instead of dropping expiry', async () => {
      const { map, namespace } = createFakeCFKVNamespace();
      const adapter = new CFKVAdapter(namespace);

      await adapter.set('short_flag', '1', { ex: 15 });
      expect(map.get('short_flag')?.expirationTtl).toBe(60);

      await adapter.set('long_flag', '1', { ex: 300 });
      expect(map.get('long_flag')?.expirationTtl).toBe(300);
    });
  });

  describe('KVRequestLogStore on CFKVAdapter (Vercel KV & CF KV parity)', () => {
    it('enables capture even when KV auto-deserializes "1" to number 1, and scans/filters/prunes logs', async () => {
      vi.stubEnv('REQUEST_LOGS_MAX_ENTRIES', '3');
      const { namespace } = createFakeCFKVNamespace();
      const cfAdapter = new CFKVAdapter(namespace);

      const adminConfig = await import('@/lib/admin/admin-config');
      vi.spyOn(adminConfig, 'getKV').mockResolvedValue(cfAdapter as any);

      const store = new KVRequestLogStore();
      expect(await store.isCaptureEnabled()).toBe(false);

      await store.enableCapture(300);
      // CFKVAdapter.get('request_log_capture_enabled') JSON.parses '1' -> number 1
      expect(await cfAdapter.get('request_log_capture_enabled')).toBe(1);
      expect(await store.isCaptureEnabled()).toBe(true);

      for (let i = 0; i < 5; i++) {
        await store.append({
          traceId: `trace_${i}`,
          timestamp: `2026-11-18T00:0${i}:00.000Z`,
          apiKeyHash: 'abcd1234',
          model: 'gpt-5.4',
          provider: i % 2 === 0 ? 'openai' : 'anthropic',
          status: i === 4 ? 'error' : 'success',
          httpStatus: i === 4 ? 502 : 200,
          latencyMs: 100 + i,
        });
      }

      const all = await store.list();
      expect(all).toHaveLength(3);
      expect(all.map((l) => l.traceId)).toEqual(['trace_4', 'trace_3', 'trace_2']);

      const errorsOnly = await store.list({ status: 'error' });
      expect(errorsOnly).toHaveLength(1);
      expect(errorsOnly[0].traceId).toBe('trace_4');

      await store.clear();
      expect(await store.list()).toHaveLength(0);
      expect(await store.isCaptureEnabled()).toBe(false);
    });
  });

  describe('Cloudflare D1 daily report aggregation, health storage & scheduled worker', () => {
    it('aggregates daily usage report from D1 when Cloudflare DB binding is active', async () => {
      const fakeDb = {
        prepare(sql: string) {
          return {
            bind(date: string) {
              return { sql, date };
            },
          };
        },
        async batch(stmts: Array<{ sql: string; date: string }>) {
          return stmts.map((s) => {
            if (s.sql.includes('FROM daily_usage')) {
              return {
                results: [
                  { provider: '', requests: 20, tokens: 3000, prompt_tokens: 1000, completion_tokens: 2000 },
                  { provider: 'openai', requests: 15, tokens: 2200, prompt_tokens: 700, completion_tokens: 1500 },
                  { provider: 'anthropic', requests: 5, tokens: 800, prompt_tokens: 300, completion_tokens: 500 },
                ],
              };
            }
            return { results: [{ total_errors: 5 }] };
          });
        },
      };

      const cfEnvMod = await import('@/lib/cf-env');
      vi.spyOn(cfEnvMod, 'getCFEnvSync').mockReturnValue({ DB: fakeDb as any, KV: {} as any });

      const report = await aggregateUsageDailyReport('2026-11-17');
      expect(report).not.toBeNull();
      expect(report?.summary).toMatchObject({
        totalRequests: 20,
        totalTokens: 3000,
        promptTokens: 1000,
        completionTokens: 2000,
        errorRate: 0.2, // 5 / (20 + 5)
      });
      expect(report?.byProvider.openai.requests).toBe(15);
      expect(report?.byProvider.anthropic.requests).toBe(5);
    });

    it('stores provider health probe records via shared KV adapter on Cloudflare', async () => {
      const { namespace } = createFakeCFKVNamespace();
      const cfAdapter = new CFKVAdapter(namespace);
      const adminConfig = await import('@/lib/admin/admin-config');
      vi.spyOn(adminConfig, 'getKV').mockResolvedValue(cfAdapter as any);

      await recordHealthProbeResult({
        providerId: 'openai',
        providerName: 'OpenAI',
        ok: true,
        statusCode: 200,
        responseTimeMs: 145,
        checkedAt: '2026-11-18T00:00:00.000Z',
      });

      const snapshot = await getProviderHealthSnapshot(['openai']);
      expect(snapshot.providers).toHaveLength(1);
      expect(snapshot.providers[0]).toMatchObject({
        id: 'openai',
        status: 'healthy',
        responseTimeMs: 145,
      });
      expect(snapshot.providers[0].history).toHaveLength(1);
    });

    it('cleans quota_counters using period + period_type in worker.ts scheduled handler', async () => {
      const executed: Array<{ sql: string; args: unknown[] }> = [];
      const fakeDb = {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              return { sql, args };
            },
          };
        },
        async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
          executed.push(...stmts);
          return [];
        },
      };
      const tasks: Promise<unknown>[] = [];

      await worker.scheduled(
        { cron: '0 0 * * *', scheduledTime: Date.now(), noRetry: () => {} } as any,
        { DB: fakeDb as any, KV: {} as any },
        { waitUntil: (p: Promise<unknown>) => tasks.push(p), passThroughOnException: () => {} } as any
      );
      await Promise.all(tasks);

      expect(executed).toHaveLength(3);
      expect(executed[0].sql).toContain("period_type = 'daily'");
      expect(executed[0].sql).toContain("period_type = 'monthly'");
      expect(String(executed[0].args[0])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(String(executed[0].args[1])).toMatch(/^\d{4}-\d{2}$/);
    });
  });

  describe('Runtime detection & ConfigStore resilience', () => {
    it('detects Cloudflare runtime via request-scoped context even without CF_PAGES env var', async () => {
      delete process.env.VERCEL;
      delete process.env.CF_PAGES;
      const cfEnvMod = await import('@/lib/cf-env');
      vi.spyOn(cfEnvMod, 'isCloudflareSync').mockReturnValue(true);

      expect(detectRuntime()).toEqual({
        runtime: 'cloudflare',
        persistentProcess: false,
        publicEndpoint: true,
        localAgentSetup: false,
        storage: 'd1',
      });
    });

    it('does not crash when PostgresConfigStore is selected in server mode', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', 'postgresql://localhost:5432/relay');
      delete process.env.VERCEL;
      delete process.env.CF_PAGES;
      delete process.env.KV_REST_API_URL;

      const store = getDefaultConfigStore();
      expect(store).toBeInstanceOf(PostgresConfigStore);
      await expect(store.getProviders()).resolves.toEqual({});
      await expect(store.getConfigVersion()).resolves.toBe(0);
    });

    it('increments monotonic global config version only when config actually changes', async () => {
      const v0 = await getGlobalConfigVersion(true);
      expect(v0).toBe(0);

      await setManagedKeys('openai', ['sk-test-12345678901234567890']);
      const v1 = await getGlobalConfigVersion(true);
      expect(v1).toBe(1);

      // Reading again without mutations returns the exact same version (not Date.now())
      expect(await getGlobalConfigVersion(true)).toBe(1);

      await saveModelAliasConfig({ aliases: { 'fast-gpt': 'gpt-5.4-mini' }, hidden: [] });
      const v2 = await getGlobalConfigVersion(true);
      expect(v2).toBe(2);

      await saveCustomProvider({
        name: 'custom_gw',
        displayName: 'Custom Gateway',
        baseUrl: 'https://gw.example.com/v1',
        headerFormat: 'openai',
        envKeyField: 'CUSTOM_GW_KEYS',
        modelPrefixes: ['cgw-'],
        models: [],
        isCustom: true,
      });
      await setFallbackChain('openai', ['custom_gw']);
      expect(await getGlobalConfigVersion(true)).toBe(4);
    });
  });
});
