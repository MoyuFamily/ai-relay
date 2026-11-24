import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  getRedisRestConfig,
  hasKv,
  shouldUseSelfHostedPostgres,
} from '@/lib/config/env';
import {
  __adminConfigCacheForTests,
  createMemoryMockKV,
  detectStorageBackend,
  setManagedKeys,
} from '@/lib/admin/admin-config';
import { requireAdminAuth, requireCronOrAdminAuth } from '@/lib/admin/auth';
import { middleware } from '@/middleware';
import { D1UsageStorage } from '@/lib/usage/storage/d1-usage-storage';
import { __resetDefaultConfigStore } from '@/lib/config-store';
import { resolveConfigSource } from '../../cli/lib/config-resolver';
import { InlineConfigSource } from '../../cli/lib/config-source';
import { startLocalServer, type LocalServer } from '../../cli/local/server';

describe('Install & Usage Hardening Regressions', () => {
  let localServer: LocalServer | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __adminConfigCacheForTests.resetClients();
    __resetDefaultConfigStore();
    const mock = createMemoryMockKV();
    (global as any)._mockKVInstance = mock;
    (global as any)._mockKVInstance._isMock = true;
  });

  afterEach(async () => {
    if (localServer) {
      await localServer.stop();
      localServer = null;
    }
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __adminConfigCacheForTests.resetClients();
    __resetDefaultConfigStore();
  });

  describe('Storage Precedence & Upstash Redis Env Compatibility', () => {
    it('selects PostgreSQL in Docker Compose postgres mode even when RELAY_DATA_DIR=/app/data is set', async () => {
      delete process.env.VERCEL;
      delete process.env.CF_PAGES;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.RELAY_STORAGE_PATH;
      delete process.env.RELAY_STORAGE_BACKEND;
      vi.stubEnv('RELAY_DATA_DIR', '/app/data');
      vi.stubEnv('DATABASE_URL', 'postgresql://airelay:secret@postgres:5432/airelay');
      vi.stubEnv('RELAY_ENABLE_POSTGRES_IN_TEST', '1');

      expect(shouldUseSelfHostedPostgres()).toBe(true);
      expect(await detectStorageBackend()).toBe('postgres');

      // Explicit RELAY_STORAGE_BACKEND=file still overrides PostgreSQL
      vi.stubEnv('RELAY_STORAGE_BACKEND', 'file');
      expect(shouldUseSelfHostedPostgres()).toBe(false);
      expect(await detectStorageBackend()).toBe('file');
    });

    it('detects both UPSTASH_REDIS_REST_* and KV_REST_API_* credentials', async () => {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://demo.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'upstash-token-123');

      expect(hasKv()).toBe(true);
      expect(getRedisRestConfig()).toEqual({
        url: 'https://demo.upstash.io',
        token: 'upstash-token-123',
        source: 'upstash-redis',
      });
      expect(await detectStorageBackend()).toBe('vercel-kv');
    });
  });

  describe('CORS, Admin Auth & Cron Auth Hardening', () => {
    it('honors RELAY_ALLOWED_ORIGINS in middleware in addition to CORS_ORIGINS', () => {
      delete process.env.CORS_ORIGINS;
      vi.stubEnv('RELAY_ALLOWED_ORIGINS', 'https://app.example.com');

      const allowedReq = new NextRequest('https://relay.example.com/v1/models', {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example.com' },
      });
      const allowedRes = middleware(allowedReq);
      expect(allowedRes.status).toBe(204);
      expect(allowedRes.headers.get('access-control-allow-origin')).toBe('https://app.example.com');

      const blockedReq = new NextRequest('https://relay.example.com/v1/models', {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example.com' },
      });
      const blockedRes = middleware(blockedReq);
      expect(blockedRes.status).toBe(403);
    });

    it('returns 503 server_not_configured when no admin or relay keys exist', async () => {
      delete process.env.RELAY_ADMIN_KEY;
      delete process.env.RELAY_API_KEY;

      const res = requireAdminAuth(new Request('http://localhost/api/admin'));
      expect(res?.status).toBe(503);
      const body = await res!.json();
      expect(body.error.type).toBe('server_not_configured');
    });

    it('blocks forged x-vercel-cron off-Vercel and accepts Authorization Bearer CRON_SECRET', () => {
      delete process.env.VERCEL;
      delete process.env.CRON_SECRET;
      vi.stubEnv('RELAY_ADMIN_KEY', 'admin-secret');

      // Forged x-vercel-cron off Vercel must be rejected
      const spoofed = requireCronOrAdminAuth(
        new Request('http://localhost/api/cron/probe', {
          headers: { 'x-vercel-cron': '1' },
        })
      );
      expect(spoofed?.status).toBe(401);

      // With CRON_SECRET set, Bearer <CRON_SECRET> and x-cron-secret both pass, while bare x-vercel-cron fails
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('CRON_SECRET', 'cron-secret-xyz');

      expect(
        requireCronOrAdminAuth(
          new Request('http://localhost/api/cron/probe', {
            headers: { 'x-vercel-cron': '1' },
          })
        )?.status
      ).toBe(401);

      expect(
        requireCronOrAdminAuth(
          new Request('http://localhost/api/cron/probe', {
            headers: { Authorization: 'Bearer cron-secret-xyz' },
          })
        )
      ).toBeNull();

      expect(
        requireCronOrAdminAuth(
          new Request('http://localhost/api/cron/probe', {
            headers: { 'x-cron-secret': 'cron-secret-xyz' },
          })
        )
      ).toBeNull();
    });
  });

  describe('Vercel KV-less Admin Key Error & Cloudflare D1 Cleanup', () => {
    it('returns 503 storage_not_configured instead of 500 when adding keys on Vercel without Redis', async () => {
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('RELAY_ADMIN_KEY', 'admin-secret');
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      __adminConfigCacheForTests.resetClients();

      const { POST } = await import('@/app/api/admin/providers/[provider]/keys/route');
      const res = await POST(
        new NextRequest('http://localhost/api/admin/providers/openai/keys', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer admin-secret',
          },
          body: JSON.stringify({ key: 'sk-test-key-12345678901234567890' }),
        }),
        { params: Promise.resolve({ provider: 'openai' }) }
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.type).toBe('storage_not_configured');
    });

    it('prunes expired D1 rows via D1UsageStorage.cleanupExpired()', async () => {
      const statements: string[] = [];
      const mockDb = {
        prepare(sql: string) {
          return {
            bind(..._args: unknown[]) {
              return { sql };
            },
          };
        },
        async batch(stmts: Array<{ sql: string }>) {
          for (const s of stmts) statements.push(s.sql);
          return stmts.map(() => ({ meta: { changes: 2 } }));
        },
      } as any;

      const d1 = new D1UsageStorage(mockDb);
      const res = await d1.cleanupExpired();
      expect(res.deletedRows).toBe(6);
      expect(statements.some((s) => s.includes('DELETE FROM quota_counters'))).toBe(true);
      expect(statements.some((s) => s.includes('DELETE FROM error_stats'))).toBe(true);
      expect(statements.some((s) => s.includes('DELETE FROM error_key_stats'))).toBe(true);
    });
  });

  describe('Local Relay Key Sync, Reverse Proxy Origin & CLI Runtime', () => {
    it('syncs providerKeys in /api/local/config/snapshot by default and respects ALLOW_LOCAL_KEY_SYNC=false', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('RELAY_API_KEY', 'relay-secret');
      await setManagedKeys('openai', ['sk-synced-openai-key-1234567890']);

      const { GET } = await import('@/app/api/local/config/snapshot/route');
      const res1 = await GET(
        new NextRequest('http://localhost/api/local/config/snapshot', {
          headers: { Authorization: 'Bearer relay-secret' },
        })
      );
      expect(res1.status).toBe(200);
      const snap1 = await res1.json();
      expect(snap1.providerKeys.openai).toEqual(['sk-synced-openai-key-1234567890']);

      vi.stubEnv('ALLOW_LOCAL_KEY_SYNC', 'false');
      const res2 = await GET(
        new NextRequest('http://localhost/api/local/config/snapshot', {
          headers: { Authorization: 'Bearer relay-secret' },
        })
      );
      const snap2 = await res2.json();
      expect(snap2.providerKeys).toEqual({});
    });

    it('uses X-Forwarded-Proto/Host and DEPLOY_URL for device verification_url behind reverse proxies', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      delete process.env.DEPLOY_URL;

      const { POST } = await import('@/app/api/local/devices/session/route');
      const res1 = await POST(
        new NextRequest('http://0.0.0.0:3000/api/local/devices/session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'relay.example.com',
          },
          body: JSON.stringify({ device_name: 'Dev Mac', platform: 'darwin' }),
        })
      );
      const json1 = await res1.json();
      expect(json1.verification_url).toMatch(/^https:\/\/relay\.example\.com\/admin\/local-relay\/verify\?code=/);

      vi.stubEnv('DEPLOY_URL', 'https://custom.relay.dev/');
      const res2 = await POST(
        new NextRequest('http://0.0.0.0:3000/api/local/devices/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_name: 'Dev Mac', platform: 'darwin' }),
        })
      );
      const json2 = await res2.json();
      expect(json2.verification_url).toMatch(/^https:\/\/custom\.relay\.dev\/admin\/local-relay\/verify\?code=/);
    });

    it('enforces RELAY_API_KEY auth on loopback and serves /v1/models/:model & /v1/messages/count_tokens', async () => {
      vi.stubEnv('RELAY_API_KEY', 'local-secret-123');
      const realFetch = globalThis.fetch;

      const configSource = new InlineConfigSource({
        version: 1,
        providers: {
          openai: {
            name: 'openai',
            displayName: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            headerFormat: 'openai',
            modelPrefixes: ['gpt-'],
            envKeyField: 'OPENAI_KEYS',
            apiKeys: ['sk-local-test-key'],
            models: [{ id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', contextWindow: 400000 }],
          },
        },
      });

      localServer = await startLocalServer({
        profile: {
          deviceName: 'test-mac',
          listenHost: '127.0.0.1',
          listenPort: 0,
          configVersion: 1,
        },
        configSource,
      });

      const base = `http://127.0.0.1:${localServer.port}`;

      // Unauthenticated request on loopback must now be rejected when RELAY_API_KEY is set
      const unauth = await realFetch(`${base}/v1/models`);
      expect(unauth.status).toBe(401);

      // Authenticated single-model lookup
      const modelRes = await realFetch(`${base}/v1/models/gpt-5.4-mini`, {
        headers: { Authorization: 'Bearer local-secret-123' },
      });
      expect(modelRes.status).toBe(200);
      expect(await modelRes.json()).toMatchObject({ id: 'gpt-5.4-mini', owned_by: 'openai' });

      // Authenticated count_tokens endpoint for Claude Code compatibility
      const countRes = await realFetch(`${base}/v1/messages/count_tokens`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'local-secret-123',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: 'Hello world from Claude Code!' }],
        }),
      });
      expect(countRes.status).toBe(200);
      const countJson = await countRes.json();
      expect(countJson.input_tokens).toBeGreaterThan(0);
    });

    it('prioritizes cloud profile over inline env vars and populates default models for inline env', async () => {
      const cloudSource = resolveConfigSource({
        profile: {
          cloudUrl: 'https://relay.example.com',
          deviceId: 'dev_1',
          deviceToken: 'dt_abc',
          deviceName: 'mac',
          listenHost: '127.0.0.1',
          listenPort: 3147,
          configVersion: 1,
        },
        env: { OPENAI_KEYS: 'sk-env-only' } as any,
      });
      expect(cloudSource?.describe()).toBe('Cloud API (https://relay.example.com)');

      const inlineSource = resolveConfigSource({
        env: { OPENAI_KEYS: 'sk-env-only' } as any,
      });
      const snap = await inlineSource!.load();
      expect(snap.providers.openai.modelPrefixes).toContain('gpt-');
      expect((snap.providers.openai.models || []).some((m) => m.id === 'gpt-6-luna')).toBe(true);
    });
  });

  describe('Mainstream Built-in Providers & Models Routing', () => {
    it('routes OpenAI GPT-6, Claude 5.5, Google Gemini 4, DeepSeek V4, Xiaomi MiMo v2.6, and OpenRouter out of the box', async () => {
      const { clearProvidersCache, resolveProvider, resolveFallbackModel } = await import('@/lib/providers/resolver');
      clearProvidersCache();

      expect((await resolveProvider('gpt-6-luna'))?.name).toBe('openai');
      expect((await resolveProvider('gpt-6.2-sol'))?.name).toBe('openai');
      expect((await resolveProvider('gpt-6.2-astra'))?.name).toBe('openai');
      expect((await resolveProvider('claude-sonnet-5-5'))?.name).toBe('anthropic');
      expect((await resolveProvider('claude-fable-5-2'))?.name).toBe('anthropic');
      expect((await resolveProvider('gemini-4-hydrogen'))?.name).toBe('google');
      expect((await resolveProvider('gemini-4-neon'))?.baseUrl).toBe(
        'https://generativelanguage.googleapis.com/v1beta/openai'
      );
      expect((await resolveProvider('deepseek-flash'))?.name).toBe('deepseek');
      expect((await resolveProvider('deepseek-v4-pro'))?.name).toBe('deepseek');
      expect((await resolveProvider('openrouter/auto'))?.name).toBe('openrouter');
      expect((await resolveProvider('openai/gpt-6.2-sol'))?.name).toBe('openrouter');
      expect((await resolveProvider('meta-llama/llama-4-maverick'))?.name).toBe('openrouter');
      expect((await resolveProvider('mimo-v2.6-flash'))?.name).toBe('xiaomi');

      expect(await resolveFallbackModel('gpt-6-luna', 'deepseek')).toBe('deepseek-flash');
      expect(await resolveFallbackModel('gpt-6.2-astra', 'deepseek')).toBe('deepseek-v4-pro');
      expect(await resolveFallbackModel('gpt-6-luna', 'google')).toBe('gemini-4-hydrogen');
      expect(await resolveFallbackModel('gpt-6.2-astra', 'google')).toBe('gemini-4-neon');
    });
  });
});
