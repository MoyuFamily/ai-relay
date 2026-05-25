// AI Relay v2.1 — Provider health diagnostics
import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';
import { getKeyPoolStats, initAllKeyPools, getRateLimiterStats } from '@/lib/relay';
import { KVUsageStorage } from '@/lib/usage';
import { getProviderHealthSnapshot } from '@/lib/health/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const usageStorage = new KVUsageStorage();

type LegacyHealthStatus = 'available' | 'degraded' | 'unavailable';

function legacyStatus(status?: string, fallback: LegacyHealthStatus = 'available'): LegacyHealthStatus {
  if (status === 'healthy') return 'available';
  if (status === 'down') return 'unavailable';
  if (status === 'degraded' || status === 'unknown') return 'degraded';
  return fallback;
}

export async function GET(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;

  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const providers = await getAllProviders(forceRefresh);
  await initAllKeyPools(providers, forceRefresh);
  const keyStats = getKeyPoolStats();
  const limiterStats = getRateLimiterStats();
  const providerIds = Object.keys(providers);
  const [errorStats, keyErrors, persistedHealth] = await Promise.all([
    usageStorage.getErrorStats(),
    usageStorage.getKeyErrors(),
    getProviderHealthSnapshot(providerIds),
  ]);
  const persistedById = new Map(persistedHealth.providers.map((item) => [item.id, item]));

  const items = Object.entries(providers).map(([id, provider]) => {
    const keys = keyStats[id];
    const errors = errorStats[id] || {};
    const errorCount = Object.values(errors).reduce((sum, count) => sum + Number(count || 0), 0);
    const circuit = limiterStats[id]?.circuit;
    let realtimeStatus: LegacyHealthStatus = 'available';
    if (!keys?.total && !(provider.envKeyField && process.env[provider.envKeyField])) realtimeStatus = 'unavailable';
    else if ((keys?.available || 0) === 0 || circuit?.state === 'open') realtimeStatus = 'unavailable';
    else if (errorCount > 0 || circuit?.state === 'half-open' || (keys?.available || 0) < (keys?.total || 0)) realtimeStatus = 'degraded';

    const persisted = persistedById.get(id);
    return {
      id,
      name: provider.displayName,
      status: persisted?.status ?? realtimeStatus,
      legacyStatus: legacyStatus(persisted?.status, realtimeStatus),
      keyCount: keys?.total || 0,
      availableKeys: keys?.available || 0,
      errors,
      keyErrors: keyErrors.filter((ke) => (keys as any)?.keyHashes?.includes(ke.keyHash)),
      rateLimiter: limiterStats[id] || null,
      responseTimeMs: persisted?.responseTimeMs ?? null,
      statusCode: persisted?.statusCode ?? null,
      consecutiveFailures: persisted?.consecutiveFailures ?? 0,
      lastCheckedAt: persisted?.lastCheckedAt ?? new Date().toISOString(),
      history: persisted?.history ?? [],
      ...(persisted?.error ? { error: persisted.error } : {}),
    };
  });

  return Response.json({ status: 'ok', timestamp: persistedHealth.timestamp, providers: items }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
