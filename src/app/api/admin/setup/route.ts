// AI Relay v2.1 — Admin setup diagnostics
import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';
import { getKeyPoolStats, initAllKeyPools } from '@/lib/relay';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;

  const providers = await getAllProviders(true);
  await initAllKeyPools(providers, true);
  const stats = getKeyPoolStats();
  const configuredProviders = Object.entries(providers).map(([id, provider]) => ({
    id,
    name: provider.displayName,
    configured: Boolean(provider.envKeyField ? process.env[provider.envKeyField] : stats[id]?.total),
    keyCount: stats[id]?.total || 0,
    availableKeys: stats[id]?.available || 0,
    models: provider.models || [],
  }));

  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {
      adminKey: Boolean(process.env.RELAY_ADMIN_KEY || process.env.RELAY_API_KEY),
      relayKey: Boolean(process.env.RELAY_API_KEY),
      kv: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
      providerKeys: configuredProviders.some((p) => p.configured || p.keyCount > 0),
    },
    providers: configuredProviders,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
