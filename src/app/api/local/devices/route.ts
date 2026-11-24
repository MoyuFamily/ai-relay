// ============================================================
// AI Relay API — Device Management (Multi-Platform KV)
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, getKV } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OFFLINE_THRESHOLD_MS = 5 * 60_000;

async function scanDeviceKeys(kv: any): Promise<string[]> {
  const seen = new Set<string>();
  let cursor: number | string = 0;
  let guard = 0;

  do {
    const result: [number | string, unknown] = await kv.scan(cursor, { match: 'device:*', count: 100 });
    if (!Array.isArray(result) || result.length < 2) break;
    const [nextCursor, batch] = result;
    if (Array.isArray(batch)) {
      for (const item of batch) {
        if (typeof item === 'string' && item.startsWith('device:')) {
          seen.add(item);
        }
      }
    }
    cursor = nextCursor;
    guard++;
  } while (cursor !== 0 && cursor !== '0' && guard < 50);

  return Array.from(seen);
}

// GET /api/local/devices - List devices
export async function GET(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;

  const kv = await getKV();
  if (!kv) {
    return Response.json({ devices: [] });
  }

  const keys = await scanDeviceKeys(kv);
  const now = Date.now();
  const devices = (
    await Promise.all(
      keys.map(async (key) => {
        const data = await kv.hgetall(key);
        if (!data) return null;
        const lastHeartbeat = Number(data.last_heartbeat || 0);
        const isOnline = lastHeartbeat > 0 && now - lastHeartbeat <= OFFLINE_THRESHOLD_MS;
        // Strip sensitive token_hash from admin list response
        const { token_hash: _omitted, ...safeData } = data as Record<string, unknown>;
        return {
          id: key.replace('device:', ''),
          ...safeData,
          last_heartbeat: lastHeartbeat,
          status: isOnline ? 'online' : 'offline',
        };
      })
    )
  ).filter(Boolean);

  return Response.json(
    { devices },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
