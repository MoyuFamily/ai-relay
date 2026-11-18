import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileKVAdapter,
  __resetFileKVAdaptersForTests,
} from '@/lib/storage/file-kv-adapter';
import { PostgresKVAdapter } from '@/lib/storage/postgres-kv-adapter';
import { PostgresUsageStorage } from '@/lib/usage/storage/postgres-usage-storage';
import { ensureSelfHostedPostgresSchema } from '@/lib/db/self-hosted-schema';
import {
  __adminConfigCacheForTests,
  detectStorageBackend,
  getGlobalConfigVersion,
  getKV,
  getManagedKeys,
  saveWebhookSettings,
  setManagedKeys,
} from '@/lib/admin/admin-config';
import { createUsageStorage } from '@/lib/usage/factory';
import { createUsageEvent } from '@/lib/usage/sdk';
import { __resetKeyPoolsForTests } from '@/lib/relay/key-pool';
import {
  __selfHostedSchedulerForTests,
  getLocalDateTimeInTimezone,
  isWithinReportWindow,
  runSelfHostedScheduledTick,
  shouldEnableSelfHostedScheduler,
} from '@/lib/runtime/self-hosted-scheduler';

/**
 * Lightweight in-memory mock of `postgres.Sql` tagged template client
 * that simulates `kv_store`, `daily_usage`, `key_usage`, `quota_counters`,
 * `error_stats`, and `error_key_stats` for unit testing without a live Postgres daemon.
 */
function createMockPostgresSql() {
  const ddlCalls: string[] = [];
  const kvStore = new Map<string, { value: any; expiresAt: Date | null }>();
  const dailyUsage = new Map<
    string,
    { date: string; provider: string; requests: number; tokens: number; prompt_tokens: number; completion_tokens: number }
  >();
  const keyUsage = new Map<string, { key_hash: string; period: string; requests: number; tokens: number }>();
  const quotaCounters = new Map<string, { period: string; period_type: string; requests: number }>();
  const errorStats = new Map<string, { date: string; provider: string; status_code: string; count: number; reason: string }>();
  const errorKeyStats = new Map<string, { date: string; key_hash: string; provider: string; status_code: string; count: number; reason: string }>();

  const unwrapParam = (p: any) =>
    p && typeof p === 'object' && '__jsonValue' in p ? p.__jsonValue : p;

  const sqlTag: any = async (strings: TemplateStringsArray, ...rawValues: any[]) => {
    const query = strings.join('$?').replace(/\s+/g, ' ').trim();
    const values = rawValues.map(unwrapParam);

    // kv_store operations
    if (query.startsWith('SELECT value FROM kv_store WHERE key =')) {
      const key = String(values[0]);
      const entry = kvStore.get(key);
      if (!entry) return [];
      if (entry.expiresAt && entry.expiresAt.getTime() <= Date.now()) return [];
      return [{ value: entry.value }];
    }

    if (query.startsWith('SELECT key, value FROM kv_store WHERE key = ANY(')) {
      const keys = values[0] as string[];
      const rows: Array<{ key: string; value: any }> = [];
      for (const k of keys) {
        const entry = kvStore.get(k);
        if (entry && (!entry.expiresAt || entry.expiresAt.getTime() > Date.now())) {
          rows.push({ key: k, value: entry.value });
        }
      }
      return rows;
    }

    if (query.startsWith('SELECT key FROM kv_store')) {
      const likePattern = String(values[0]);
      const limit = Number(values[1] || 100);
      const regex = new RegExp(
        '^' +
          likePattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/%/g, '.*')
            .replace(/_/g, '.') +
          '$'
      );
      const rows: Array<{ key: string }> = [];
      for (const [k, entry] of kvStore.entries()) {
        if (entry.expiresAt && entry.expiresAt.getTime() <= Date.now()) continue;
        if (regex.test(k)) rows.push({ key: k });
      }
      rows.sort((a, b) => a.key.localeCompare(b.key));
      return rows.slice(0, limit);
    }

    if (query.startsWith('INSERT INTO kv_store (key, value, expires_at, updated_at)')) {
      if (query.includes('jsonb_set(')) {
        // hincrby: values = [key, initialObj, field, field, increment, field]
        const [key, , field, , inc] = values;
        const existing = kvStore.get(key);
        const obj =
          existing && typeof existing.value === 'object' && existing.value !== null && !Array.isArray(existing.value)
            ? { ...existing.value }
            : {};
        const next = Number(obj[field] || 0) + Number(inc);
        obj[field] = next;
        kvStore.set(key, { value: obj, expiresAt: existing?.expiresAt ?? null });
        return [{ next_val: next }];
      }
      if (query.includes("RETURNING (value #>> '{}')::numeric AS next_val")) {
        // incrby: values = [key, initialJson, increment]
        const [key, inc] = values;
        const existing = kvStore.get(key);
        const prev = existing ? Number(existing.value || 0) : 0;
        const next = (Number.isFinite(prev) ? prev : 0) + Number(inc);
        kvStore.set(key, { value: next, expiresAt: existing?.expiresAt ?? null });
        return [{ next_val: next }];
      }
      if (query.includes('jsonb_array_elements_text')) {
        // sadd: values = [key, jsonArr]
        const [key, members] = values;
        const existing = kvStore.get(key);
        const curArr = existing && Array.isArray(existing.value) ? [...existing.value] : [];
        for (const m of members as string[]) {
          if (!curArr.includes(m)) curArr.push(m);
        }
        kvStore.set(key, { value: curArr, expiresAt: existing?.expiresAt ?? null });
        return [];
      }
      if (query.includes("jsonb_typeof(kv_store.value) = 'object'")) {
        // hset: values = [key, patchJson]
        const [key, patch] = values;
        const existing = kvStore.get(key);
        const base =
          existing && typeof existing.value === 'object' && existing.value !== null && !Array.isArray(existing.value)
            ? { ...existing.value }
            : {};
        Object.assign(base, patch);
        kvStore.set(key, { value: base, expiresAt: existing?.expiresAt ?? null });
        return [];
      }
      // regular set: values = [key, jsonPayload, expiresAt]
      const [key, val, expiresAt] = values;
      kvStore.set(key, { value: val, expiresAt: expiresAt ?? null });
      return [];
    }

    if (query.startsWith('UPDATE kv_store SET value = COALESCE')) {
      // srem: values = [removeList, key]
      const [members, key] = values;
      const existing = kvStore.get(key);
      if (!existing || !Array.isArray(existing.value)) return Object.assign([], { count: 0 });
      const removeSet = new Set(members as string[]);
      existing.value = existing.value.filter((x: string) => !removeSet.has(x));
      return Object.assign([], { count: 1 });
    }

    if (query.startsWith('UPDATE kv_store SET expires_at =')) {
      const [expiresAt, key] = values;
      const existing = kvStore.get(key);
      if (!existing) return Object.assign([], { count: 0 });
      existing.expiresAt = expiresAt;
      return Object.assign([], { count: 1 });
    }

    if (query.startsWith('DELETE FROM kv_store WHERE key = ANY(')) {
      const keys = values[0] as string[];
      let deleted = 0;
      for (const k of keys) {
        if (kvStore.delete(k)) deleted++;
      }
      return Object.assign([], { count: deleted });
    }

    // daily_usage operations
    if (query.startsWith('INSERT INTO daily_usage')) {
      const [date, provider, requests, tokens, prompt_tokens, completion_tokens] = values;
      const k = `${date}|${provider}`;
      const existing = dailyUsage.get(k) || {
        date,
        provider,
        requests: 0,
        tokens: 0,
        prompt_tokens: 0,
        completion_tokens: 0,
      };
      existing.requests += Number(requests);
      existing.tokens += Number(tokens);
      existing.prompt_tokens += Number(prompt_tokens);
      existing.completion_tokens += Number(completion_tokens);
      dailyUsage.set(k, existing);
      return [];
    }

    if (query.startsWith('SELECT provider, requests, tokens, prompt_tokens, completion_tokens FROM daily_usage WHERE date =')) {
      const [date] = values;
      return Array.from(dailyUsage.values()).filter((r) => r.date === date);
    }

    // key_usage operations:
    // INSERT INTO key_usage (key_hash, period, requests, tokens)
    // VALUES (${apiKeyHash}, ${date}, 1, ${totalTokens}), (${apiKeyHash}, 'total', 1, ${totalTokens})
    if (query.startsWith('INSERT INTO key_usage')) {
      const [keyHash1, datePeriod, tokens1, keyHash2, tokens2] = values;
      for (const [kh, per, tok] of [
        [keyHash1, datePeriod, tokens1],
        [keyHash2, 'total', tokens2],
      ]) {
        const k = `${kh}|${per}`;
        const existing = keyUsage.get(k) || { key_hash: String(kh), period: String(per), requests: 0, tokens: 0 };
        existing.requests += 1;
        existing.tokens += Number(tok);
        keyUsage.set(k, existing);
      }
      return [];
    }

    if (query.startsWith('SELECT period, requests, tokens FROM key_usage')) {
      const [keyHash, d] = values;
      return Array.from(keyUsage.values()).filter(
        (r) => r.key_hash === keyHash && (r.period === d || r.period === 'total')
      );
    }

    // quota_counters operations
    if (query.startsWith('INSERT INTO quota_counters')) {
      const period = values[0];
      const period_type = query.includes("'daily'") ? 'daily' : 'monthly';
      const k = `${period}|${period_type}`;
      const existing = quotaCounters.get(k) || { period, period_type, requests: 0 };
      existing.requests += 1;
      quotaCounters.set(k, existing);
      return [{ requests: existing.requests }];
    }

    if (query.startsWith('SELECT period, period_type, requests FROM quota_counters')) {
      const [d, m] = values;
      return Array.from(quotaCounters.values()).filter(
        (r) =>
          (r.period === d && r.period_type === 'daily') ||
          (r.period === m && r.period_type === 'monthly')
      );
    }

    // error_stats & error_key_stats
    if (query.startsWith('INSERT INTO error_stats')) {
      const [date, provider, status_code, reason] = values;
      const k = `${date}|${provider}|${status_code}`;
      const existing = errorStats.get(k) || { date, provider, status_code, count: 0, reason };
      existing.count += 1;
      existing.reason = reason;
      errorStats.set(k, existing);
      return [];
    }

    if (query.startsWith('INSERT INTO error_key_stats')) {
      const [date, key_hash, provider, status_code, reason] = values;
      const k = `${date}|${key_hash}|${status_code}`;
      const existing = errorKeyStats.get(k) || { date, key_hash, provider, status_code, count: 0, reason };
      existing.count += 1;
      existing.reason = reason;
      errorKeyStats.set(k, existing);
      return [];
    }

    if (query.startsWith('DELETE FROM error_key_stats')) {
      const [date, keyHash] = values;
      for (const [k, v] of errorKeyStats.entries()) {
        if (v.date === date && v.key_hash === keyHash) errorKeyStats.delete(k);
      }
      return Object.assign([], { count: 1 });
    }

    if (query.startsWith('DELETE FROM ')) {
      return Object.assign([], { count: 2 });
    }

    return [];
  };

  sqlTag.json = (val: any) => ({ __jsonValue: val });
  sqlTag.unsafe = async (ddl: string) => {
    ddlCalls.push(ddl);
    return [];
  };

  return { sql: sqlTag, ddlCalls, kvStore, dailyUsage, errorKeyStats };
}

describe('Self-Hosted Service Optimization', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-relay-self-hosted-'));
    __adminConfigCacheForTests.resetClients();
    __resetKeyPoolsForTests();
    __selfHostedSchedulerForTests.reset();
    await __resetFileKVAdaptersForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __adminConfigCacheForTests.resetClients();
    __resetKeyPoolsForTests();
    __selfHostedSchedulerForTests.reset();
    await __resetFileKVAdaptersForTests();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('FileKVAdapter (Zero-Dependency Persistent Disk Mode)', () => {
    it('supports full KV operations, TTL expiry, and survives restarts on disk', async () => {
      const storePath = path.join(tmpDir, 'kv-store.json');
      const kv1 = new FileKVAdapter(storePath, 5);

      await kv1.set('admin:keys:openai', ['sk-openai-persisted-key-1234567890']);
      await kv1.hset('usage:daily:2026-11-18', { requests: 5, tokens: 1200 });
      expect(await kv1.hincrby('usage:daily:2026-11-18', 'requests', 3)).toBe(8);
      expect(await kv1.incr('admin:config:version')).toBe(1);
      expect(await kv1.incrby('admin:config:version', 4)).toBe(5);
      await kv1.sadd('error:keys:2026-11-18', 'hash_a', 'hash_b', 'hash_a');
      expect((await kv1.smembers('error:keys:2026-11-18')).sort()).toEqual(['hash_a', 'hash_b']);
      await kv1.srem('error:keys:2026-11-18', 'hash_a');

      // Pipeline + scan + mget
      const pipe = kv1.pipeline();
      pipe.set('temp:ephemeral', 'gone-soon', { ex: 1 });
      pipe.set('probe:provider:openai', { ok: true });
      await pipe.exec();

      const [, scannedKeys] = await kv1.scan(0, { match: 'admin:*' });
      expect((scannedKeys as string[]).sort()).toEqual(['admin:config:version', 'admin:keys:openai']);
      expect(await kv1.mget(['admin:config:version', 'nonexistent'])).toEqual([5, null]);

      await kv1.flush();

      // Simulate container restart with a brand-new FileKVAdapter reading the same file
      const kv2 = new FileKVAdapter(storePath, 5);
      expect(await kv2.get('admin:keys:openai')).toEqual(['sk-openai-persisted-key-1234567890']);
      expect(await kv2.hgetall('usage:daily:2026-11-18')).toEqual({ requests: 8, tokens: 1200 });
      expect(await kv2.get('admin:config:version')).toBe(5);
      expect(await kv2.smembers('error:keys:2026-11-18')).toEqual(['hash_b']);
    });

    it('wires getKV(), admin-config, and KVUsageStorage to FileKVAdapter when RELAY_STORAGE_PATH is set', async () => {
      const storePath = path.join(tmpDir, 'relay-state.json');
      vi.stubEnv('RELAY_STORAGE_PATH', storePath);
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.VERCEL;
      delete process.env.CF_PAGES;

      expect(await detectStorageBackend()).toBe('file');
      const kv = await getKV();
      expect(kv?._isFileKV).toBe(true);

      await setManagedKeys('openai', ['sk-file-managed-key-123456789012345']);
      expect(await getManagedKeys('openai', true)).toEqual(['sk-file-managed-key-123456789012345']);
      expect(await getGlobalConfigVersion(true)).toBe(1);

      const usage = await createUsageStorage();
      await usage.record(
        createUsageEvent({
          provider: 'openai',
          model: 'gpt-5.4',
          apiKeyHash: 'kh_file_1',
          statusCode: 200,
          promptTokens: 100,
          completionTokens: 50,
          latencyMs: 120,
          isStream: false,
        })
      );
      const summary = await usage.getGlobalUsage();
      expect(summary?.requests).toBe(1);
      expect(summary?.tokens).toBe(150);
      const fileKeyStats = await usage.getKeyUsage('kh_file_1');
      expect(fileKeyStats?.daily.requests).toBe(1);
      expect(fileKeyStats?.total.tokens).toBe(150);
    });
  });

  describe('PostgreSQL Self-Hosted Adapters (Multi-Node Mode)', () => {
    it('auto-bootstraps DDL once and executes atomic KV + relational usage operations', async () => {
      const mockPg = createMockPostgresSql();

      // Concurrent schema bootstrap calls only execute DDL once per client
      await Promise.all([
        ensureSelfHostedPostgresSchema(mockPg.sql),
        ensureSelfHostedPostgresSchema(mockPg.sql),
      ]);
      expect(mockPg.ddlCalls).toHaveLength(1);
      expect(mockPg.ddlCalls[0]).toContain('CREATE TABLE IF NOT EXISTS kv_store');
      expect(mockPg.ddlCalls[0]).toContain('CREATE TABLE IF NOT EXISTS daily_usage');

      // PostgresKVAdapter contract
      const pgKv = new PostgresKVAdapter(mockPg.sql);
      await pgKv.set('admin:keys:claude', ['sk-ant-12345678901234567890']);
      expect(await pgKv.get('admin:keys:claude')).toEqual(['sk-ant-12345678901234567890']);
      expect(await pgKv.incr('admin:config:version')).toBe(1);
      expect(await pgKv.incrby('admin:config:version', 2)).toBe(3);
      await pgKv.hset('admin:quota', { dailyLimit: '50', monthlyLimit: '500' });
      expect(await pgKv.hincrby('usage:test', 'requests', 4)).toBe(4);
      expect(await pgKv.hincrby('usage:test', 'requests', 6)).toBe(10);
      await pgKv.sadd('set:test', 'a', 'b', 'a');
      expect(await pgKv.smembers('set:test')).toEqual(['a', 'b']);
      await pgKv.srem('set:test', 'a');
      expect(await pgKv.smembers('set:test')).toEqual(['b']);

      const [, keys] = await pgKv.scan(0, { match: 'admin:*' });
      expect(keys).toEqual(['admin:config:version', 'admin:keys:claude', 'admin:quota']);

      // PostgresUsageStorage contract
      const pgUsage = new PostgresUsageStorage(mockPg.sql);
      expect(pgUsage.shouldRecordDirect).toBe(true);

      await pgUsage.record(
        createUsageEvent({
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          apiKeyHash: 'kh_pg_1',
          statusCode: 200,
          promptTokens: 200,
          completionTokens: 80,
          latencyMs: 95,
          isStream: true,
        })
      );

      const summary = await pgUsage.getGlobalUsage();
      expect(summary?.requests).toBe(1);
      expect(summary?.tokens).toBe(280);
      expect(summary?.providers.claude).toEqual({
        requests: 1,
        tokens: 280,
        promptTokens: 200,
        completionTokens: 80,
      });

      const keyStats = await pgUsage.getKeyUsage('kh_pg_1');
      expect(keyStats?.daily.requests).toBe(1);
      expect(keyStats?.total.tokens).toBe(280);

      // Quota reservation & denial on limit exceeded
      vi.stubEnv('RELAY_DAILY_LIMIT', '2');
      const q1 = await pgUsage.checkQuota(true);
      const q2 = await pgUsage.checkQuota(true);
      const q3 = await pgUsage.checkQuota(true);
      expect(q1.allowed).toBe(true);
      expect(q2.allowed).toBe(true);
      expect(q3.allowed).toBe(false);
      expect(q3.retryAfter).toBeGreaterThan(0);

      await pgUsage.recordError({
        provider: 'claude',
        keyHash: 'kh_pg_1',
        statusCode: 429,
        reason: 'rate_limited',
      });
      await pgUsage.clearKeyErrors('kh_pg_1');
      const cleanup = await pgUsage.cleanupExpired();
      expect(cleanup.deletedRows).toBeGreaterThan(0);
    });
  });

  describe('Container Liveness (/health?liveness=1) & Setup Diagnostics (/api/admin/setup)', () => {
    it('returns 503 for readiness /health when 0 keys exist, but 200 for /health?liveness=1', async () => {
      const storePath = path.join(tmpDir, 'health-kv.json');
      vi.stubEnv('RELAY_STORAGE_PATH', storePath);
      vi.stubEnv('RELAY_API_KEY', 'test-relay-secret');
      vi.stubEnv('OPENAI_KEYS', '');
      vi.stubEnv('CLAUDE_KEYS', '');
      vi.stubEnv('DEEPSEEK_KEYS', '');
      vi.stubEnv('XIAOMI_KEYS', '');
      delete process.env.VERCEL;
      delete process.env.CF_PAGES;

      const { GET: getHealth } = await import('@/app/health/route');

      const readinessRes = await getHealth(new Request('http://localhost:3000/health'));
      expect(readinessRes.status).toBe(503);
      const readinessBody = await readinessRes.json();
      expect(readinessBody.status).toBe('degraded');
      expect(readinessBody.relayReady).toBe(false);
      expect(readinessBody.storage).toBe('file');

      const livenessRes = await getHealth(new Request('http://localhost:3000/health?liveness=1'));
      expect(livenessRes.status).toBe(200);
      const livenessBody = await livenessRes.json();
      expect(livenessBody.status).toBe('unconfigured');
      expect(livenessBody.relayReady).toBe(false);
      expect(livenessBody.runtime).toBe('server');
      expect(livenessBody.storage).toBe('file');

      const { GET: getSetup } = await import('@/app/api/admin/setup/route');
      const setupReq = new NextRequest('http://localhost:3000/api/admin/setup', {
        headers: { authorization: 'Bearer test-relay-secret' },
      });
      const setupRes = await getSetup(setupReq);
      expect(setupRes.status).toBe(200);
      const setupBody = await setupRes.json();
      expect(setupBody.checks.kv).toBe(true);
      expect(setupBody.runtime).toBe('server');
      expect(setupBody.storageBackend).toBe('file');
    });
  });

  describe('Self-Hosted Background Scheduler', () => {
    it('activates only on standalone Node servers and deduplicates daily tasks', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VITEST', '');
      delete process.env.VERCEL;
      delete process.env.CF_PAGES;
      expect(shouldEnableSelfHostedScheduler()).toBe(true);

      vi.stubEnv('VERCEL', '1');
      expect(shouldEnableSelfHostedScheduler()).toBe(false);

      vi.stubEnv('VERCEL', '');
      vi.stubEnv('ENABLE_SELF_HOSTED_CRON', 'false');
      expect(shouldEnableSelfHostedScheduler()).toBe(false);

      // Timezone & report window helpers
      const shanghai = getLocalDateTimeInTimezone(
        new Date('2026-11-18T13:04:00.000Z'),
        'Asia/Shanghai'
      );
      expect(shanghai).toEqual({ date: '2026-11-18', time: '21:04' });
      expect(isWithinReportWindow('21:04', '21:00', 15)).toBe(true);
      expect(isWithinReportWindow('20:59', '21:00', 15)).toBe(false);
      expect(isWithinReportWindow('21:20', '21:00', 15)).toBe(false);

      // Tick execution & KV deduplication
      const storePath = path.join(tmpDir, 'scheduler-kv.json');
      vi.stubEnv('RELAY_STORAGE_PATH', storePath);
      vi.stubEnv('SELF_HOSTED_PROBE_INTERVAL_MINUTES', '60');
      vi.stubEnv('OPENAI_KEYS', '');
      vi.stubEnv('CLAUDE_KEYS', '');
      vi.stubEnv('DEEPSEEK_KEYS', '');
      vi.stubEnv('XIAOMI_KEYS', '');

      // Seed yesterday's usage and an enabled webhook
      const kv = await getKV();
      await kv!.hset('usage:daily:2026-11-17', {
        requests: 12,
        tokens: 3400,
        promptTokens: 2000,
        completionTokens: 1400,
      });
      await saveWebhookSettings({
        webhooks: [
          {
            id: 'wh-1',
            name: 'Ops Slack',
            url: 'https://hooks.slack.example/services/test',
            platform: 'slack',
            enabled: true,
            createdAt: '2026-11-18T00:00:00.000Z',
            updatedAt: '2026-11-18T00:00:00.000Z',
          },
        ],
        alertThresholds: [],
        reportTime: '21:00',
        reportTimezone: 'Asia/Shanghai',
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 })
      );

      // At 13:05 UTC (21:05 Asia/Shanghai): probes, aggregates 2026-11-17, and sends webhook once
      const tick1 = await runSelfHostedScheduledTick(new Date('2026-11-18T13:05:00.000Z'));
      expect(tick1.probed).toBe(true);
      expect(tick1.aggregatedDate).toBe('2026-11-17');
      expect(tick1.webhookReportSent).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // One minute later (21:06 Asia/Shanghai): all three tasks are deduplicated!
      const tick2 = await runSelfHostedScheduledTick(new Date('2026-11-18T13:06:00.000Z'));
      expect(tick2.probed).toBe(false);
      expect(tick2.aggregatedDate).toBeNull();
      expect(tick2.webhookReportSent).toBe(false);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
