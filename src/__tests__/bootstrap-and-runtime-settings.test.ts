import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { __adminConfigCacheForTests } from '@/lib/admin/admin-config';
import { __resetBootstrapAuthCacheForTests } from '@/lib/admin/bootstrap-auth';
import { __resetRuntimeSettingsCacheForTests } from '@/lib/admin/runtime-settings';
import { requireAdminAuth, requireCronOrAdminAuth } from '@/lib/admin/auth';
import { generateTempKey, validateAuth, validateTempKey } from '@/lib/relay/auth';
import { getConcurrencyStats } from '@/lib/relay/concurrency';
import { resolveUpstreamUserAgent } from '@/lib/relay/transform';
import { ensureD1Schema } from '@/lib/db/d1-schema';

describe('Zero-Env First-Time Bootstrap Auth & Admin Runtime Settings', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.RELAY_API_KEY;
    delete process.env.RELAY_ADMIN_KEY;
    delete process.env.RELAY_SIGNING_SECRET;
    delete process.env.CRON_SECRET;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.CF_PAGES;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.ENABLE_REQUEST_LOGS;
    delete process.env.RELAY_MAX_CONCURRENT;
    delete process.env.RELAY_MAX_QUEUE;
    delete process.env.RELAY_DEFAULT_USER_AGENT;
    delete (global as any)._mockKVInstance;
    __adminConfigCacheForTests.resetClients();
    __resetBootstrapAuthCacheForTests();
    __resetRuntimeSettingsCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.env = { ...originalEnv };
    delete (global as any)._mockKVInstance;
    __adminConfigCacheForTests.resetClients();
    __resetBootstrapAuthCacheForTests();
    __resetRuntimeSettingsCacheForTests();
  });

  describe('/api/admin/bootstrap (Scheme A)', () => {
    it('stays locked before bootstrap, auto-generates key once, unlocks auth, and locks permanently (409)', async () => {
      const { GET, POST } = await import('@/app/api/admin/bootstrap/route');

      // 1. Before initialization: status shows canBootstrap=true, admin/v1 stay locked
      const statusBefore = await (await GET()).json();
      expect(statusBefore).toMatchObject({
        initialized: false,
        canBootstrap: true,
        source: 'none',
      });
      expect(statusBefore.apiKey).toBeUndefined();

      const preAdminRes = await requireAdminAuth(new Request('http://localhost/api/admin'));
      expect(preAdminRes?.status).toBe(503);

      // 2. First-time bootstrap auto-generates a strong sk-relay-... key
      const initRes = await POST(
        new NextRequest('http://localhost/api/admin/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      );
      expect(initRes.status).toBe(201);
      const initBody = await initRes.json();
      expect(initBody.initialized).toBe(true);
      expect(initBody.apiKey).toMatch(/^sk-relay-[a-f0-9]{48}$/);

      // 3. Status now reports initialized=true and never exposes the key
      const statusAfter = await (await GET()).json();
      expect(statusAfter).toMatchObject({
        initialized: true,
        canBootstrap: false,
        source: 'storage',
      });
      expect(statusAfter.apiKey).toBeUndefined();

      // 4. Bootstrapped key unlocks Admin, /v1/* auth, and Temp Key signing
      expect(
        await requireAdminAuth(
          new Request('http://localhost/api/admin', {
            headers: { Authorization: `Bearer ${initBody.apiKey}` },
          })
        )
      ).toBeNull();

      expect(
        await validateAuth(
          new Request('http://localhost/v1/models', {
            headers: { Authorization: `Bearer ${initBody.apiKey}` },
          })
        )
      ).toBe(true);

      expect(
        await validateAuth(
          new Request('http://localhost/v1/models', {
            headers: { Authorization: 'Bearer wrong-key' },
          })
        )
      ).toBe(false);

      const temp = await generateTempKey(300);
      expect(await validateTempKey(temp.key)).toBe(true);

      // 5. Second bootstrap call is permanently rejected with 409
      const secondRes = await POST(
        new NextRequest('http://localhost/api/admin/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: 'sk-relay-attacker-overwrite-attempt' }),
        })
      );
      expect(secondRes.status).toBe(409);
      const secondBody = await secondRes.json();
      expect(secondBody.error.type).toBe('already_initialized');
    });

    it('rejects bootstrap with 409 when RELAY_API_KEY env var is already set', async () => {
      vi.stubEnv('RELAY_API_KEY', 'env-secret-key-12345');
      const { GET, POST } = await import('@/app/api/admin/bootstrap/route');

      const status = await (await GET()).json();
      expect(status).toMatchObject({
        initialized: true,
        canBootstrap: false,
        source: 'env',
      });

      const res = await POST(
        new NextRequest('http://localhost/api/admin/bootstrap', { method: 'POST' })
      );
      expect(res.status).toBe(409);
    });

    it('rejects weak or malformed custom keys with 400 and returns 503 when no storage is configured', async () => {
      const { POST } = await import('@/app/api/admin/bootstrap/route');

      const shortRes = await POST(
        new NextRequest('http://localhost/api/admin/bootstrap', {
          method: 'POST',
          body: JSON.stringify({ apiKey: 'short' }),
        })
      );
      expect(shortRes.status).toBe(400);

      const commaRes = await POST(
        new NextRequest('http://localhost/api/admin/bootstrap', {
          method: 'POST',
          body: JSON.stringify({ apiKey: 'valid-length,with-comma' }),
        })
      );
      expect(commaRes.status).toBe(400);

      // Simulate Vercel production without Upstash Redis
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('NODE_ENV', 'production');
      const noStorageRes = await POST(
        new NextRequest('http://localhost/api/admin/bootstrap', { method: 'POST' })
      );
      expect(noStorageRes.status).toBe(503);
      const noStorageBody = await noStorageRes.json();
      expect(noStorageBody.error.type).toBe('storage_not_configured');
    });
  });

  describe('/api/admin/settings (Runtime Settings without Env Vars)', () => {
    it('persists extraClientKeys, cronSecret, concurrency, UA, and request log settings immediately', async () => {
      vi.stubEnv('RELAY_ADMIN_KEY', 'admin-master-secret');
      const { GET, PUT } = await import('@/app/api/admin/settings/route');

      // Unauthorized request rejected
      const unauth = await GET(new NextRequest('http://localhost/api/admin/settings'));
      expect(unauth.status).toBe(401);

      // Save runtime settings via Admin API
      const putRes = await PUT(
        new NextRequest('http://localhost/api/admin/settings', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer admin-master-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            extraClientKeys: ['sk-client-alpha-12345'],
            cronSecret: 'cron-managed-secret-999',
            upstreamTimeoutMs: 90000,
            maxConcurrent: 12,
            maxQueue: 40,
            enableRequestLogs: true,
            allowLocalKeySync: false,
            defaultUserAgent: 'CustomAgent/2.0',
            deployUrl: 'https://relay.example.com/',
          }),
        })
      );
      expect(putRes.status).toBe(200);
      const putJson = await putRes.json();
      expect(putJson.settings.deployUrl).toBe('https://relay.example.com');

      // 1. Managed client key works on /v1/* immediately
      expect(
        await validateAuth(
          new Request('http://localhost/v1/models', {
            headers: { Authorization: 'Bearer sk-client-alpha-12345' },
          })
        )
      ).toBe(true);

      // 2. Managed cronSecret works on /api/cron/* immediately
      expect(
        await requireCronOrAdminAuth(
          new Request('http://localhost/api/cron/probe', {
            headers: { Authorization: 'Bearer cron-managed-secret-999' },
          })
        )
      ).toBeNull();

      // 3. Concurrency and default User-Agent update immediately
      expect(getConcurrencyStats()).toMatchObject({
        maxConcurrent: 12,
        maxQueue: 40,
      });
      expect(resolveUpstreamUserAgent('python-requests/2.31', 'openai')).toBe('CustomAgent/2.0');

      // 4. GET returns persisted values
      const getRes = await GET(
        new NextRequest('http://localhost/api/admin/settings', {
          headers: { Authorization: 'Bearer admin-master-secret' },
        })
      );
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.settings).toMatchObject({
        extraClientKeys: ['sk-client-alpha-12345'],
        upstreamTimeoutMs: 90000,
        maxConcurrent: 12,
        maxQueue: 40,
        enableRequestLogs: true,
        allowLocalKeySync: false,
        defaultUserAgent: 'CustomAgent/2.0',
        deployUrl: 'https://relay.example.com',
      });

      // 5. Validation rejects invalid deployUrl
      const badRes = await PUT(
        new NextRequest('http://localhost/api/admin/settings', {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer admin-master-secret',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ deployUrl: 'not-a-url' }),
        })
      );
      expect(badRes.status).toBe(400);
    });
  });

  describe('Cloudflare D1 Idempotent Schema Bootstrap', () => {
    it('runs CREATE TABLE/INDEX IF NOT EXISTS once per D1 instance and caches subsequent calls', async () => {
      const executedSql: string[] = [];
      const fakeDb = {
        prepare: vi.fn((sql: string) => ({ sql })),
        batch: vi.fn(async (stmts: Array<{ sql: string }>) => {
          executedSql.push(...stmts.map((s) => s.sql));
          return stmts.map(() => ({ success: true }));
        }),
      };

      await ensureD1Schema(fakeDb as any);
      await ensureD1Schema(fakeDb as any);

      expect(fakeDb.batch).toHaveBeenCalledTimes(1);
      expect(executedSql.some((s) => s.includes('CREATE TABLE IF NOT EXISTS daily_usage'))).toBe(true);
      expect(executedSql.some((s) => s.includes('CREATE TABLE IF NOT EXISTS config_flags'))).toBe(true);
      expect(executedSql.some((s) => s.includes('CREATE TABLE IF NOT EXISTS request_logs'))).toBe(true);
    });
  });
});
