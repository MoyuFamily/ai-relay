// ============================================================
// AI Relay API — Local Config Snapshot
// ============================================================

import { NextRequest } from 'next/server';
import type { ConfigSnapshot } from '@/lib/config-store/types';
import { requireLocalSyncAuth } from '@/lib/local/device-auth';
import { PROVIDERS } from '@/lib/providers/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authErr = await requireLocalSyncAuth(request);
  if (authErr) return authErr;

  try {
    const { getDefaultConfigStore } = await import('@/lib/config-store');
    const store = getDefaultConfigStore();

    const [version, customProviders, modelAliases, priorityRules] = await Promise.all([
      store.getConfigVersion(),
      store.getProviders(),
      store.getModelAliases(),
      store.getPriorityRules(),
    ]);

    const allProviderDefs = { ...PROVIDERS, ...customProviders };
    const fallbackChains: Record<string, string[]> = {};
    await Promise.all(
      Object.entries(allProviderDefs).map(async ([providerName, cfg]) => {
        const chain = await store.getFallbackChain(
          providerName,
          cfg.fallbackProviders || cfg.fallbackProvider
        );
        if (chain.length > 0) {
          fallbackChains[providerName] = chain;
        }
      })
    );

    const snapshot: ConfigSnapshot = {
      version,
      generatedAt: new Date().toISOString(),
      providers: customProviders,
      providerKeys: {},
      modelAliases,
      priorityRules,
      fallbackChains,
    };

    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: any) {
    // Don't leak internal error details to client
    console.error('[config/snapshot] Error:', error);
    return Response.json(
      { error: { message: 'Failed to retrieve config snapshot', type: 'internal_error' } },
      { status: 500 }
    );
  }
}
