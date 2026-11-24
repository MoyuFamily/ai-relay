// AI Relay — Admin setup diagnostics
import { NextRequest } from 'next/server';
import { detectStorageBackend, getKV, requireAdminAuth } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';
import { getKeyPoolStats, initAllKeyPools } from '@/lib/relay';
import { isCloudflare } from '@/lib/cf-env';
import { detectRuntime } from '@/lib/runtime/capabilities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;

  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const providers = await getAllProviders(forceRefresh);
  await initAllKeyPools(providers, forceRefresh);
  const stats = getKeyPoolStats();
  const configuredProviders = Object.entries(providers).map(([id, provider]) => ({
    id,
    name: provider.displayName,
    configured: Boolean(
      (provider.envKeyField && process.env[provider.envKeyField]) ||
      (stats[id]?.total || 0) > 0
    ),
    keyCount: stats[id]?.total || 0,
    availableKeys: stats[id]?.available || 0,
    envKeyField: provider.envKeyField,
    models: provider.models || [],
  }));

  const [kv, storageBackend, isCf] = await Promise.all([
    getKV(),
    detectStorageBackend(),
    isCloudflare(),
  ]);
  const runtimeInfo = detectRuntime();

  return Response.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    isCloudflare: isCf,
    runtime: runtimeInfo.runtime,
    storageBackend,
    checks: {
      adminKey: Boolean(process.env.RELAY_ADMIN_KEY || process.env.RELAY_API_KEY),
      relayKey: Boolean(process.env.RELAY_API_KEY),
      kv: Boolean(kv),
      providerKeys: configuredProviders.some((p) => p.configured || p.keyCount > 0),
    },
    providers: configuredProviders,
  }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
