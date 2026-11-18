// ============================================================
// AI API Relay — GET /health
// Health check endpoint for monitoring, load balancers & containers
// ============================================================
// Default (`GET /health`): readiness check — returns 200 when at least
//   one upstream provider key is available, or 503 (`degraded`) when 0 keys
//   are available.
// Container Liveness (`GET /health?liveness=1` or `?probe=liveness`):
//   always returns 200 while the Node.js HTTP server is responsive, even on
//   a freshly booted container before keys are added via `/admin`.

import { getAllProviders } from '@/lib/providers';
import { getKeyPoolStats, initAllKeyPools } from '@/lib/relay';
import { detectStorageBackend } from '@/lib/admin';
import { detectRuntime } from '@/lib/runtime/capabilities';
import pkg from '../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const startTime = Date.now();

export async function GET(request: Request) {
  let isLivenessProbe = false;
  if (request?.url) {
    try {
      const url = new URL(request.url);
      const livenessParam = url.searchParams.get('liveness');
      const probeParam = url.searchParams.get('probe');
      isLivenessProbe =
        livenessParam === '1' ||
        livenessParam === 'true' ||
        probeParam === 'liveness';
    } catch {
      // Ignore malformed relative URLs in synthetic test callers
    }
  }

  const [allProviders, storageBackend] = await Promise.all([
    getAllProviders(),
    detectStorageBackend(),
  ]);
  await initAllKeyPools(allProviders);
  const poolStats = getKeyPoolStats();

  // Count configured and healthy providers
  let configuredProviders = 0;
  let totalKeys = 0;
  let availableKeys = 0;

  for (const [name, config] of Object.entries(allProviders)) {
    const hasKeys = config.envKeyField
      ? (!!process.env[config.envKeyField] || (poolStats[name]?.total > 0))
      : (poolStats[name]?.total > 0);
    if (hasKeys) {
      configuredProviders++;
      const stats = poolStats[name];
      if (stats) {
        totalKeys += stats.total;
        availableKeys += stats.available;
      }
    }
  }

  // Healthy if at least one provider has available keys
  const isHealthy = availableKeys > 0;
  const uptimeMs = Date.now() - startTime;
  const runtimeInfo = detectRuntime();

  const statusLabel = isHealthy
    ? 'healthy'
    : isLivenessProbe
      ? 'unconfigured'
      : 'degraded';

  return Response.json(
    {
      status: statusLabel,
      relayReady: isHealthy,
      runtime: runtimeInfo.runtime,
      storage: storageBackend,
      timestamp: new Date().toISOString(),
      uptime: {
        ms: uptimeMs,
        human: formatUptime(uptimeMs),
      },
      version: pkg.version,
      providers: {
        configured: configuredProviders,
        total: Object.keys(allProviders).length,
      },
      keys: {
        total: totalKeys,
        available: availableKeys,
      },
      features: [
        'chat/completions',
        'messages',
        'responses',
        'models',
        'streaming',
        'multi-key-rotation',
        'auto-retry',
        'usage-tracking',
        'error-tracking',
      ],
    },
    {
      status: isHealthy || isLivenessProbe ? 200 : 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Relay-Version': pkg.version,
      },
    }
  );
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
