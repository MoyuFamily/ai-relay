// ============================================================
// AI API Relay — GET /health
// Health check endpoint for monitoring and load balancers
// ============================================================

import { getAllProviders } from '@/lib/providers';
import { getKeyPoolStats, initAllKeyPools } from '@/lib/relay';
import pkg from '../../../package.json';

export const runtime = 'nodejs';

const startTime = Date.now();

export async function GET() {
  const allProviders = await getAllProviders();
  await initAllKeyPools(allProviders);
  const poolStats = getKeyPoolStats();

  // Count configured and healthy providers
  let configuredProviders = 0;
  let totalKeys = 0;
  let availableKeys = 0;

  for (const [name, config] of Object.entries(allProviders)) {
    const hasKeys = config.envKeyField ? (!!process.env[config.envKeyField] || (poolStats[name]?.total > 0)) : (poolStats[name]?.total > 0);
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

  return Response.json(
    {
      status: isHealthy ? 'healthy' : 'degraded',
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
      status: isHealthy ? 200 : 503,
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
