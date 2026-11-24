// ============================================================
// AI API Relay — Admin API (/api/admin)
// ============================================================

import { NextRequest } from 'next/server';
import { getKeyPoolStats, initAllKeyPools } from '@/lib/relay';
import { requireAdminAuth } from '@/lib/admin';
import { createUsageStorage } from '@/lib/usage/factory';
import { getUsageSamplingInfo } from '@/lib/usage/storage/kv-storage';
import { getAllProviders } from '@/lib/providers';
import { getApiKeyMinLength } from '@/lib/config/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;



/**
 * GET /api/admin
 *
 * Returns comprehensive admin data:
 * - Provider key pool status
 * - Global usage stats
 * - Quota status
 * - Model aliases
 */
export async function GET(request: NextRequest) {
  // Auth check — require RELAY_ADMIN_KEY (falls back to RELAY_API_KEY)
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;

  const usageStorage = await createUsageStorage();
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const allProviders = await getAllProviders(forceRefresh);
  // Eagerly init all provider pools so stats reflect all configured providers
  await initAllKeyPools(allProviders, forceRefresh);
  const providerStats = getKeyPoolStats();

  // Fire all 4 KV queries in parallel instead of sequential awaits
  const [globalUsage, monthlyUsage, quota, errorStats, keyErrors] = await Promise.all([
    usageStorage.getGlobalUsage(),
    usageStorage.getMonthlyUsage(),
    usageStorage.checkQuota(),
    usageStorage.getErrorStats(),
    usageStorage.getKeyErrors(),
  ]);

  const providers = Object.entries(allProviders).map(([name, config]) => {
    const stats = providerStats[name];
    return {
      name: config.displayName,
      id: name,
      keyCount: stats?.total || 0,
      availableKeys: stats?.available || 0,
      configured: config.envKeyField ? (!!process.env[config.envKeyField] || (stats?.total ? stats.total > 0 : false)) : (stats?.total ? stats.total > 0 : false),
      isCustom: config.isCustom || false,
      modelPrefixes: config.modelPrefixes,
      models: config.models || [],
      envKeyField: config.envKeyField,
      baseUrl: config.baseUrl,
      headerFormat: config.headerFormat,
      userAgent: config.userAgent,
    };
  });

  // Build keyHash → provider mapping from key pool stats
  const keyHashToProvider: Record<string, string> = {};
  for (const [provider, stat] of Object.entries(providerStats)) {
    for (const hash of (stat as any).keyHashes || []) {
      keyHashToProvider[hash] = provider;
    }
  }

  // Attach per-key errors to providers
  const providersWithErrors = providers.map((p) => {
    const providerErrors = errorStats[p.id] || {};
    const providerKeyErrors: Array<{ keyHash: string; errors: Record<string, { count: number; reason: string }> }> = [];
    for (const ke of keyErrors) {
      if (keyHashToProvider[ke.keyHash] === p.id) {
        providerKeyErrors.push({ keyHash: ke.keyHash, errors: ke.errors });
      }
    }
    return {
      ...p,
      errors: providerErrors,
      keyErrors: providerKeyErrors,
    };
  });

  const usageRequests = globalUsage?.requests || 0;
  const dailyQuotaUsed = quota.dailyLimit > 0 ? quota.dailyUsed : usageRequests;
  const monthlyQuotaUsed = quota.monthlyLimit > 0 ? quota.monthlyUsed : (monthlyUsage?.requests || usageRequests);
  const usageSampling = getUsageSamplingInfo();

  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: providersWithErrors,
    usage: {
      ...(globalUsage || { requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0, providers: {} }),
      sampling: usageSampling,
    },
    quota: {
      daily: { used: dailyQuotaUsed, limit: quota.dailyLimit || 'unlimited' },
      monthly: { used: monthlyQuotaUsed, limit: quota.monthlyLimit || 'unlimited' },
      allowed: quota.allowed,
      isOverride: quota.isOverride || false,
    },
    config: {
      dailyLimit: parseInt(process.env.RELAY_DAILY_LIMIT || '0', 10) || null,
      monthlyLimit: parseInt(process.env.RELAY_MONTHLY_LIMIT || '0', 10) || null,
      customDailyLimit: quota.isOverride ? quota.dailyLimit : null,
      customMonthlyLimit: quota.isOverride ? quota.monthlyLimit : null,
      apiKeyMinLength: getApiKeyMinLength(),
    },
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    }
  });
}
