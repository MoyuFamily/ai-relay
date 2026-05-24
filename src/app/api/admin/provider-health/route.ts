// AI Relay v2.1 — Provider health diagnostics
import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';
import { getKeyPoolStats, initAllKeyPools, getRateLimiterStats } from '@/lib/relay';
import { KVUsageStorage } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const usageStorage = new KVUsageStorage();

type HealthStatus = 'available' | 'degraded' | 'unavailable';

export async function GET(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;

  const providers = await getAllProviders(true);
  await initAllKeyPools(providers, true);
  const keyStats = getKeyPoolStats();
  const limiterStats = getRateLimiterStats();
  const [errorStats, keyErrors] = await Promise.all([
    usageStorage.getErrorStats(),
    usageStorage.getKeyErrors(),
  ]);

  const items = Object.entries(providers).map(([id, provider]) => {
    const keys = keyStats[id];
    const errors = errorStats[id] || {};
    const errorCount = Object.values(errors).reduce((sum, count) => sum + Number(count || 0), 0);
    const circuit = limiterStats[id]?.circuit;
    let status: HealthStatus = 'available';
    if (!keys?.total && !(provider.envKeyField && process.env[provider.envKeyField])) status = 'unavailable';
    else if ((keys?.available || 0) === 0 || circuit?.state === 'open') status = 'unavailable';
    else if (errorCount > 0 || circuit?.state === 'half-open' || (keys?.available || 0) < (keys?.total || 0)) status = 'degraded';

    return {
      id,
      name: provider.displayName,
      status,
      keyCount: keys?.total || 0,
      availableKeys: keys?.available || 0,
      errors,
      keyErrors: keyErrors.filter((ke) => (keys as any)?.keyHashes?.includes(ke.keyHash)),
      rateLimiter: limiterStats[id] || null,
      lastCheckedAt: new Date().toISOString(),
    };
  });

  return Response.json({ status: 'ok', timestamp: new Date().toISOString(), providers: items }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
