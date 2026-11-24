// ============================================================
// AI Relay API — Device Verification (Admin UI)
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, getKV } from '@/lib/admin';
import { hashDeviceToken } from '@/lib/local/device-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseSession(raw: unknown): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, any>;
  }
  return null;
}

// POST /api/local/devices/verify - Approve device from Admin UI
export async function POST(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;

  const kv = await getKV();
  if (!kv) {
    return Response.json({ error: 'KV storage is not configured' }, { status: 503 });
  }

  let body: { device_code?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const device_code = typeof body.device_code === 'string' ? body.device_code.trim() : '';
  if (!device_code) {
    return Response.json({ error: 'Missing device_code' }, { status: 400 });
  }

  const raw = (await kv.get(`device_session:${device_code}`)) ?? (await kv.hgetall(`device_session:${device_code}`));
  const session = parseSession(raw);
  if (!session) {
    return Response.json({ error: 'Session not found or expired' }, { status: 404 });
  }

  if (session.expires_at && Date.now() > Number(session.expires_at)) {
    await kv.del(`device_session:${device_code}`);
    return Response.json({ error: 'Session expired' }, { status: 410 });
  }

  if (session.status === 'completed') {
    return Response.json({ error: 'Already verified' }, { status: 400 });
  }

  // Create device record with secure HMAC-SHA256 token hash
  const tokenHash = await hashDeviceToken(String(session.device_token));

  await kv.hset(`device:${session.device_id}`, {
    name: session.device_name || 'Unknown Device',
    platform: session.platform || 'unknown',
    token_hash: tokenHash,
    status: 'online',
    config_version: 0,
    last_heartbeat: Date.now(),
    created_at: Date.now(),
  });

  // Create reverse index for O(1) token lookup
  await kv.set(`device_token:${tokenHash}`, String(session.device_id));

  // Mark session as completed with a short 2-minute pickup TTL
  const completedSession = { ...session, status: 'completed' };
  await kv.set(`device_session:${device_code}`, JSON.stringify(completedSession), { ex: 120 });

  return Response.json({ success: true, device_id: session.device_id });
}
