import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  constantTimeEqual,
  constantTimeIncludes,
  generateTempKey,
  validateAuth,
  validateTempKey,
} from '@/lib/relay/auth';
import { markCooldown, updateMemoryKeyPool } from '@/lib/relay/key-pool';
import { __adminConfigCacheForTests, createMemoryMockKV } from '@/lib/admin/admin-config';
import { __resetDefaultConfigStore } from '@/lib/config-store';

describe('Security hardening & Local Relay sync flows', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __adminConfigCacheForTests.clear();
    __resetDefaultConfigStore();
    const mock = createMemoryMockKV();
    (global as any)._mockKVInstance = mock;
    (global as any)._mockKVInstance._isMock = true;
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetDefaultConfigStore();
  });

  describe('Constant-time auth & temp key hardening', () => {
    it('evaluates constantTimeEqual and constantTimeIncludes accurately', () => {
      expect(constantTimeEqual('sk-secret-123', 'sk-secret-123')).toBe(true);
      expect(constantTimeEqual('sk-secret-123', 'sk-secret-124')).toBe(false);
      expect(constantTimeEqual('sk-secret-123', 'sk-secret-12')).toBe(false);
      expect(constantTimeEqual('', '')).toBe(true);

      expect(constantTimeIncludes(['k1', 'k2', 'k3'], 'k2')).toBe(true);
      expect(constantTimeIncludes(['k1', 'k2', 'k3'], 'k4')).toBe(false);
    });

    it('refuses to generate or validate temp keys when no secret is configured', async () => {
      delete process.env.RELAY_SIGNING_SECRET;
      delete process.env.RELAY_ADMIN_KEY;
      delete process.env.RELAY_API_KEY;

      await expect(generateTempKey(300)).rejects.toThrow(/Signing secret is not configured/);

      // Craft a token signed with the legacy hardcoded fallback secret and prove it is rejected
      const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000, created: Date.now() })).toString('base64url');
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode('default-fallback-signing-secret-123456'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
      const sig = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const forgedToken = `sk-relay-temp-${payload}.${sig}`;

      expect(await validateTempKey(forgedToken)).toBe(false);
    });

    it('generates and validates temp keys when RELAY_API_KEY is configured', async () => {
      vi.stubEnv('RELAY_API_KEY', 'relay-prod-secret');
      const { key } = await generateTempKey(300);

      expect(await validateTempKey(key)).toBe(true);
      const req = new Request('http://localhost/v1/models/gpt-5.4', {
        headers: { Authorization: `Bearer ${key}` },
      });
      expect(await validateAuth(req)).toBe(true);
    });
  });

  describe('Local Relay device flow & authenticated config sync (/api/local/*)', () => {
    it('blocks unauthenticated access to /api/local/config/version and /api/local/config/snapshot', async () => {
      vi.stubEnv('RELAY_API_KEY', 'relay-secret');
      const { GET: getVersion } = await import('@/app/api/local/config/version/route');
      const { GET: getSnapshot } = await import('@/app/api/local/config/snapshot/route');

      const unauthVersionRes = await getVersion(new NextRequest('http://localhost/api/local/config/version'));
      expect(unauthVersionRes.status).toBe(401);

      const unauthSnapshotRes = await getSnapshot(new NextRequest('http://localhost/api/local/config/snapshot'));
      expect(unauthSnapshotRes.status).toBe(401);

      const authedSnapshotRes = await getSnapshot(
        new NextRequest('http://localhost/api/local/config/snapshot', {
          headers: { Authorization: 'Bearer relay-secret' },
        })
      );
      expect(authedSnapshotRes.status).toBe(200);
      const snap = await authedSnapshotRes.json();
      expect(snap).toHaveProperty('version');
      expect(snap).toHaveProperty('providers');
    });

    it('completes end-to-end device verification, enforces one-time token pickup, and syncs usage without @vercel/kv env vars', async () => {
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      vi.stubEnv('RELAY_ADMIN_KEY', 'admin-secret');
      vi.stubEnv('RELAY_API_KEY', 'relay-secret');

      const { POST: createSession, GET: pollSession } = await import('@/app/api/local/devices/session/route');
      const { POST: verifyDevice } = await import('@/app/api/local/devices/verify/route');
      const { GET: listDevices } = await import('@/app/api/local/devices/route');
      const { GET: getSnapshot } = await import('@/app/api/local/config/snapshot/route');
      const { POST: uploadBatch } = await import('@/app/api/local/usage/batch/route');

      // 1. CLI creates device session
      const createRes = await createSession(
        new NextRequest('http://localhost/api/local/devices/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_name: 'MacBook Pro', platform: 'darwin' }),
        })
      );
      expect(createRes.status).toBe(200);
      const { device_code, device_id } = await createRes.json();
      expect(device_code).toMatch(/^DC_/);

      // 2. Poll before approval -> pending
      const pendingRes = await pollSession(
        new NextRequest(`http://localhost/api/local/devices/session?code=${device_code}`)
      );
      expect(await pendingRes.json()).toEqual({ status: 'pending' });

      // 3. Admin approves device
      const verifyRes = await verifyDevice(
        new NextRequest('http://localhost/api/local/devices/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer admin-secret',
          },
          body: JSON.stringify({ device_code }),
        })
      );
      expect(verifyRes.status).toBe(200);

      // 4. CLI polls and claims device_token once
      const completedRes = await pollSession(
        new NextRequest(`http://localhost/api/local/devices/session?code=${device_code}`)
      );
      const completedJson = await completedRes.json();
      expect(completedJson.status).toBe('completed');
      expect(completedJson.device_id).toBe(device_id);
      expect(completedJson.device_token).toMatch(/^dt_/);

      // 5. Replay poll with same code must return 404 (one-time token consumption)
      const replayRes = await pollSession(
        new NextRequest(`http://localhost/api/local/devices/session?code=${device_code}`)
      );
      expect(replayRes.status).toBe(404);

      // 6. Device token authenticates config snapshot & usage batch upload
      const snapRes = await getSnapshot(
        new NextRequest('http://localhost/api/local/config/snapshot', {
          headers: { Authorization: `Bearer ${completedJson.device_token}` },
        })
      );
      expect(snapRes.status).toBe(200);

      const batchRes = await uploadBatch(
        new NextRequest('http://localhost/api/local/usage/batch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${completedJson.device_token}`,
          },
          body: JSON.stringify({
            events: [
              { provider: 'openai', model: 'gpt-5.4', promptTokens: 20, completionTokens: 30, latencyMs: 250 },
            ],
          }),
        })
      );
      expect(batchRes.status).toBe(200);
      expect(await batchRes.json()).toEqual({ success: true, received: 1 });

      // 7. Admin device list shows device online and omits sensitive token_hash
      const devicesRes = await listDevices(
        new NextRequest('http://localhost/api/local/devices', {
          headers: { Authorization: 'Bearer admin-secret' },
        })
      );
      expect(devicesRes.status).toBe(200);
      const { devices } = await devicesRes.json();
      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({
        id: device_id,
        name: 'MacBook Pro',
        platform: 'darwin',
        status: 'online',
      });
      expect(devices[0]).not.toHaveProperty('token_hash');
    });
  });

  describe('Security Tab per-key cooldown accuracy', () => {
    it('marks the exact cooled-down key as cooldown instead of the last key in the pool', async () => {
      vi.stubEnv('RELAY_ADMIN_KEY', 'admin-secret');
      updateMemoryKeyPool('openai', ['sk-openai-key-0', 'sk-openai-key-1', 'sk-openai-key-2'], 1);

      const { getKeyPool } = await import('@/lib/relay/key-pool');
      const pool = await getKeyPool({
        name: 'openai',
        displayName: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        headerFormat: 'openai',
        envKeyField: 'OPENAI_KEYS',
        modelPrefixes: ['gpt-'],
      });

      // Mark ONLY the first key (index 0) on cooldown
      markCooldown(pool.keys[0]);

      const { GET } = await import('@/app/api/admin/security/route');
      const res = await GET(
        new NextRequest('http://localhost/api/admin/security', {
          headers: { Authorization: 'Bearer admin-secret' },
        })
      );
      expect(res.status).toBe(200);
      const payload = await res.json();
      const openaiKeys = payload.keys.filter((k: any) => k.providerId === 'openai');

      expect(openaiKeys).toHaveLength(3);
      expect(openaiKeys[0].keyHash).toBe(pool.keys[0].hash);
      expect(openaiKeys[0].status).toBe('cooldown');
      expect(openaiKeys[1].status).toBe('healthy');
      expect(openaiKeys[2].status).toBe('healthy');
    });
  });
});
