// ============================================================
// AI API Relay — Admin: Usage Overview
// GET /api/admin/usage
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getKeyPoolStats, initAllKeyPools } from '@/lib/relay';
import { createUsageStorage } from '@/lib/usage/factory';
import { getAllProviders } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;



/**
 * GET /api/admin/usage
 *
 * Returns usage stats per provider (today) with key pool info.
 */
export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const usageStorage = await createUsageStorage();
  const allProviders = await getAllProviders();
  // Eagerly init all provider pools
  await initAllKeyPools(allProviders);
  const poolStats = getKeyPoolStats();

  // Fetch global usage and per-provider usage in parallel
  const [globalUsage, monthlyUsage, quota, errorStats] = await Promise.all([
    usageStorage.getGlobalUsage(),
    usageStorage.getMonthlyUsage(),
    usageStorage.checkQuota(),
    usageStorage.getErrorStats(),
  ]);

  // Build per-provider summary
  const providers = Object.entries(allProviders).map(([name, config]) => {
    const usage = globalUsage?.providers?.[name] || { requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0 };
    const pool = poolStats[name] || { total: 0, available: 0, keyHashes: [] };
    const errors = errorStats[name] || {};

    return {
      name,
      displayName: config.displayName,
      usage: {
        requests: usage.requests,
        tokens: usage.tokens,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
      },
      keyPool: {
        total: pool.total,
        available: pool.available,
      },
      errors,
      hasFallback: !!(config.fallbackProviders?.length || config.fallbackProvider),
      fallbackProvider: config.fallbackProvider || (config.fallbackProviders && config.fallbackProviders[0]) || null,
      fallbackProviders: config.fallbackProviders || (config.fallbackProvider ? [config.fallbackProvider] : []),
    };
  });

  const usageRequests = globalUsage?.requests || 0;
  const dailyQuotaUsed = quota.dailyLimit > 0 ? quota.dailyUsed : usageRequests;
  const monthlyQuotaUsed = quota.monthlyLimit > 0 ? quota.monthlyUsed : (monthlyUsage?.requests || usageRequests);

  return Response.json({
    timestamp: new Date().toISOString(),
    global: {
      requests: globalUsage?.requests || 0,
      tokens: globalUsage?.tokens || 0,
      promptTokens: globalUsage?.promptTokens || 0,
      completionTokens: globalUsage?.completionTokens || 0,
    },
    quota: {
      daily: { used: dailyQuotaUsed, limit: quota.dailyLimit || 'unlimited' },
      monthly: { used: monthlyQuotaUsed, limit: quota.monthlyLimit || 'unlimited' },
      allowed: quota.allowed,
    },
    providers,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    }
  });
}
