import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createMemoryMockKV } from '../lib/admin/admin-config';
import { recordHealthProbeResult, getProviderHealthSnapshot, __healthStoreForTests } from '../lib/health/storage';

function installMockKV() {
  const mock = createMemoryMockKV();
  (global as any)._mockKVInstance = mock;
  (global as any)._mockKVInstance._isMock = true;
  return mock;
}

describe('iteration 4 health probe and usage report', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('RELAY_ADMIN_KEY', 'admin-test-key');
    __healthStoreForTests.clearCache();
    installMockKV();
  });

  it('records four-state provider health with consecutive failure state machine and 7-day history', async () => {
    const first = await recordHealthProbeResult({
      providerId: 'openai',
      providerName: 'OpenAI',
      ok: false,
      statusCode: 500,
      responseTimeMs: 1200,
      checkedAt: '2026-05-26T10:00:00.000Z',
      error: 'upstream 500',
    });
    expect(first.status).toBe('degraded');
    expect(first.consecutiveFailures).toBe(1);

    const second = await recordHealthProbeResult({
      providerId: 'openai',
      providerName: 'OpenAI',
      ok: false,
      statusCode: 504,
      responseTimeMs: 10000,
      checkedAt: '2026-05-26T10:30:00.000Z',
      error: 'timeout',
    });
    expect(second.status).toBe('down');
    expect(second.consecutiveFailures).toBe(2);

    const recovered = await recordHealthProbeResult({
      providerId: 'openai',
      providerName: 'OpenAI',
      ok: true,
      statusCode: 200,
      responseTimeMs: 300,
      checkedAt: '2026-05-26T11:00:00.000Z',
    });
    expect(recovered.status).toBe('healthy');
    expect(recovered.consecutiveFailures).toBe(0);

    const snapshot = await getProviderHealthSnapshot(['openai']);
    expect(snapshot.providers[0]).toMatchObject({ id: 'openai', status: 'healthy', consecutiveFailures: 0 });
    expect(snapshot.providers[0].history.map((item) => item.status)).toEqual(['healthy', 'down', 'degraded']);
  });

  it('allows Vercel cron probe requests without admin auth and persists unknown providers without keys', async () => {
    vi.resetModules();
    vi.doMock('../lib/providers', () => ({
      getAllProviders: vi.fn(async () => ({
        openai: {
          name: 'openai',
          displayName: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          modelPrefixes: ['gpt-'],
          headerFormat: 'openai',
          envKeyField: 'OPENAI_KEYS',
        },
      })),
    }));
    vi.doMock('../lib/relay/key-pool', () => ({
      getKeyPool: vi.fn(async () => ({ provider: 'openai', keys: [], counter: 0 })),
    }));

    const { GET } = await import('../app/api/cron/probe/route');
    const res = await GET(new NextRequest('http://localhost/api/cron/probe', {
      headers: { 'x-vercel-cron': '1' },
    }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      providers: [{ id: 'openai', status: 'unknown', consecutiveFailures: 0 }],
    });
  });

  it('aggregates daily usage via cron and exposes admin usage reports for a date range', async () => {
    const kv = installMockKV();
    await kv.hset('usage:daily:2026-05-25', {
      requests: 10,
      tokens: 300,
      promptTokens: 120,
      completionTokens: 180,
    });
    await kv.hset('usage:provider:openai:daily:2026-05-25', {
      requests: 6,
      tokens: 200,
      promptTokens: 80,
      completionTokens: 120,
    });

    vi.resetModules();
    vi.doMock('../lib/providers', () => ({ getAllProviders: vi.fn(async () => ({ openai: { name: 'openai' } })) }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T00:05:00.000Z'));
    const usageCron = await import('../app/api/cron/usage/route');
    const cronRes = await usageCron.GET(new NextRequest('http://localhost/api/cron/usage', {
      headers: { 'x-vercel-cron': '1' },
    }));
    expect(cronRes.status).toBe(200);
    await expect(cronRes.json()).resolves.toMatchObject({ success: true, date: '2026-05-25' });
    vi.useRealTimers();

    const usageReport = await import('../app/api/admin/usage-report/route');
    const reportRes = await usageReport.GET(new NextRequest('http://localhost/api/admin/usage-report?from=2026-05-25&to=2026-05-25', {
      headers: { Authorization: 'Bearer admin-test-key' },
    }));
    expect(reportRes.status).toBe(200);
    await expect(reportRes.json()).resolves.toMatchObject({
      range: { from: '2026-05-25', to: '2026-05-25' },
      reports: [{ date: '2026-05-25', summary: { totalRequests: 10, totalTokens: 300 } }],
      trend: [{ date: '2026-05-25', requests: 10, totalTokens: 300 }],
    });
  });

  it('exposes persisted four-state provider health snapshot with recent probe history via admin API', async () => {
    await recordHealthProbeResult({
      providerId: 'openai',
      providerName: 'OpenAI',
      ok: true,
      statusCode: 200,
      responseTimeMs: 280,
      checkedAt: '2026-05-26T10:00:00.000Z',
    });
    await recordHealthProbeResult({
      providerId: 'deepseek',
      providerName: 'DeepSeek',
      ok: false,
      skipped: true,
      checkedAt: '2026-05-26T10:00:00.000Z',
      error: 'no_available_key',
    });

    vi.resetModules();
    vi.doMock('../lib/providers', () => ({
      getAllProviders: vi.fn(async () => ({
        openai: { name: 'openai', displayName: 'OpenAI', envKeyField: 'OPENAI_KEYS' },
        deepseek: { name: 'deepseek', displayName: 'DeepSeek', envKeyField: 'DEEPSEEK_KEYS' },
      })),
    }));
    vi.doMock('../lib/relay', () => ({
      initAllKeyPools: vi.fn(async () => undefined),
      getKeyPoolStats: vi.fn(() => ({
        openai: { total: 1, available: 1, keyHashes: ['openai-hash'] },
        deepseek: { total: 0, available: 0, keyHashes: [] },
      })),
      getRateLimiterStats: vi.fn(() => ({})),
    }));

    const { GET } = await import('../app/api/admin/provider-health/route');
    const res = await GET(new NextRequest('http://localhost/api/admin/provider-health', {
      headers: { Authorization: 'Bearer admin-test-key' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai', status: 'healthy', responseTimeMs: 280 }),
      expect.objectContaining({ id: 'deepseek', status: 'unknown', error: 'no_available_key' }),
    ]));
    expect(body.providers.find((p: { id: string }) => p.id === 'openai').history[0]).toMatchObject({
      status: 'healthy',
      checkedAt: '2026-05-26T10:00:00.000Z',
    });
  });

  it('fills missing usage-report dates with zero trend points and preserves saved daily reports', async () => {
    const kv = installMockKV();
    await kv.set('relay:report:daily:2026-05-25', {
      date: '2026-05-25',
      summary: {
        totalRequests: 10,
        totalTokens: 300,
        promptTokens: 120,
        completionTokens: 180,
        errorRate: 0,
        p95LatencyMs: null,
      },
      byProvider: { openai: { requests: 10, tokens: 300, promptTokens: 120, completionTokens: 180 } },
      topModels: [],
    });

    vi.resetModules();
    const usageReport = await import('../app/api/admin/usage-report/route');
    const res = await usageReport.GET(new NextRequest('http://localhost/api/admin/usage-report?from=2026-05-24&to=2026-05-26', {
      headers: { Authorization: 'Bearer admin-test-key' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trend).toEqual([
      expect.objectContaining({ date: '2026-05-24', requests: 0, totalTokens: 0 }),
      expect.objectContaining({ date: '2026-05-25', requests: 10, totalTokens: 300 }),
      expect.objectContaining({ date: '2026-05-26', requests: 0, totalTokens: 0 }),
    ]);
    expect(body.reports).toHaveLength(1);
  });

  it('configures Vercel Cron schedules for 30-minute probes and daily usage aggregation', async () => {
    const vercel = await import('../../vercel.json');
    expect(vercel.default.crons).toEqual(expect.arrayContaining([
      { path: '/api/cron/probe', schedule: '*/30 * * * *' },
      { path: '/api/cron/usage', schedule: '5 0 * * *' },
    ]));
  });
});
