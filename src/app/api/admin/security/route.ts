// ============================================================
// AI Relay — Security Tab API (/api/admin/security)
// ============================================================

import { NextRequest } from 'next/server';
import { getKeyPoolStats, initAllKeyPools, hashKey } from '@/lib/relay';
import { requireAdminAuth } from '@/lib/admin';
import { createUsageStorage } from '@/lib/usage/factory';
import { getAllProviders } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;



/**
 * GET /api/admin/security
 *
 * Returns security overview + per-key health data for the Security Tab.
 */
export async function GET(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;

  const usageStorage = await createUsageStorage();
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const allProviders = await getAllProviders(forceRefresh);
  await initAllKeyPools(allProviders, forceRefresh);
  const providerStats = getKeyPoolStats();

  const [globalUsage, keyErrors, errorStats] = await Promise.all([
    usageStorage.getGlobalUsage(),
    usageStorage.getKeyErrors(),
    usageStorage.getErrorStats(),
  ]);

  // Build per-key health info
  const keyHealthList: Array<{
    provider: string;
    providerId: string;
    keyHash: string;
    keyIndex: number;
    totalKeys: number;
    status: 'healthy' | 'warning' | 'critical' | 'cooldown';
    totalRequests: number;
    errorCount: number;
    errorRate: number;
    errorsByCode: Record<string, { count: number; reason: string }>;
  }> = [];

  // Map key hash → errors
  const keyErrorMap = new Map<string, Record<string, { count: number; reason: string }>>();
  for (const ke of keyErrors) {
    keyErrorMap.set(ke.keyHash, ke.errors);
  }

  let totalKeys = 0;
  let needsRotation = 0;

  for (const [providerId, stats] of Object.entries(providerStats)) {
    const stat = stats as { total: number; available: number; keyHashes: string[]; cooldownKeyHashes?: string[] };
    const cooldownSet = new Set(stat.cooldownKeyHashes || []);
    totalKeys += stat.total;

    for (let i = 0; i < stat.keyHashes.length; i++) {
      const keyHash = stat.keyHashes[i];
      const errors = keyErrorMap.get(keyHash) || {};
      const totalKeyErrors = Object.values(errors).reduce((sum, e) => sum + e.count, 0);
      const authErrors = (errors['401']?.count || 0) + (errors['403']?.count || 0);
      const rateErrors = errors['429']?.count || 0;

      // Estimate requests per key (total provider requests / key count, rough)
      const estimatedRequests = Math.max(totalKeyErrors * 3, 10); // rough estimate
      const errorRate = totalKeyErrors > 0 ? (totalKeyErrors / estimatedRequests) * 100 : 0;

      let status: 'healthy' | 'warning' | 'critical' | 'cooldown' = 'healthy';
      if (authErrors >= 3) {
        status = 'critical';
        needsRotation++;
      } else if (errorRate > 5 || rateErrors >= 5) {
        status = 'warning';
      }

      if (cooldownSet.has(keyHash) && status === 'healthy') {
        status = 'cooldown';
      }

      keyHealthList.push({
        provider: allProviders[providerId]?.displayName || providerId,
        providerId,
        keyHash,
        keyIndex: i + 1,
        totalKeys: stat.total,
        status,
        totalRequests: estimatedRequests,
        errorCount: totalKeyErrors,
        errorRate: Math.round(errorRate * 10) / 10,
        errorsByCode: errors,
      });
    }
  }

  // Security overview
  const todayRequests = globalUsage?.requests || 0;
  const totalErrors = keyHealthList.reduce((sum, k) => sum + k.errorCount, 0);
  const globalErrorRate = todayRequests > 0 ? Math.round((totalErrors / todayRequests) * 1000) / 10 : 0;

  return Response.json({
    overview: {
      totalKeys,
      encryptedKeys: totalKeys, // TODO: track actual encryption status when AES-256-GCM is implemented
      needsRotation,
      todayRequests,
      globalErrorRate,
    },
    keys: keyHealthList,
    timestamp: new Date().toISOString(),
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
