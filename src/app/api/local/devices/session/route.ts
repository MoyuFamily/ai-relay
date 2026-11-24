// ============================================================
// AI Relay API — Local Device Session (Device Code Flow)
// ============================================================

import { NextRequest } from 'next/server';
import { getKV } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DeviceSessionRecord {
  device_id: string;
  device_name: string;
  platform: string;
  device_token: string;
  status: 'pending' | 'completed';
  expires_at: number;
  created_at: number;
}

function parseSession(raw: unknown): DeviceSessionRecord | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as DeviceSessionRecord;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as DeviceSessionRecord;
  }
  return null;
}

function resolvePublicOrigin(request: NextRequest): string {
  const configuredDeployUrl = process.env.DEPLOY_URL?.trim();
  if (configuredDeployUrl && /^https?:\/\//i.test(configuredDeployUrl)) {
    return configuredDeployUrl.replace(/\/+$/, '');
  }

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const hostHeader = forwardedHost || request.headers.get('host')?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();

  if (hostHeader && !hostHeader.startsWith('0.0.0.0')) {
    const fallbackProto = new URL(request.url).protocol.replace(':', '') || 'https';
    const proto = forwardedProto || fallbackProto;
    return `${proto}://${hostHeader}`;
  }

  return new URL(request.url).origin;
}

// POST /api/local/devices/session - Create device code
export async function POST(request: NextRequest) {
  const kv = await getKV();
  if (!kv) {
    return Response.json(
      { error: 'KV storage is not configured on this relay instance' },
      { status: 503 }
    );
  }

  let body: { device_name?: unknown; platform?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const deviceName =
    typeof body.device_name === 'string' && body.device_name.trim()
      ? body.device_name.trim().slice(0, 100)
      : 'Unknown Device';
  const platform =
    typeof body.platform === 'string' && body.platform.trim()
      ? body.platform.trim().slice(0, 50)
      : 'unknown';

  const deviceCode = `DC_${crypto.randomUUID()}`;
  const deviceId = `device_${crypto.randomUUID()}`;
  const deviceToken = `dt_${crypto.randomUUID().replace(/-/g, '')}`;
  const expiresAt = Date.now() + 600_000; // 10 min

  const record: DeviceSessionRecord = {
    device_id: deviceId,
    device_name: deviceName,
    platform,
    device_token: deviceToken,
    status: 'pending',
    expires_at: expiresAt,
    created_at: Date.now(),
  };

  // Store with native TTL (supported on both Vercel KV and CFKVAdapter)
  await kv.set(`device_session:${deviceCode}`, JSON.stringify(record), { ex: 600 });

  const verificationUrl = `${resolvePublicOrigin(request)}/admin/local-relay/verify?code=${encodeURIComponent(deviceCode)}`;

  return Response.json({
    device_code: deviceCode,
    device_id: deviceId,
    verification_url: verificationUrl,
    expires_in: 600,
  });
}

// GET /api/local/devices/session?code=xxx - Poll for completion
export async function GET(request: NextRequest) {
  const deviceCode = request.nextUrl.searchParams.get('code');
  if (!deviceCode) {
    return Response.json({ error: 'Missing device_code' }, { status: 400 });
  }

  const kv = await getKV();
  if (!kv) {
    return Response.json({ error: 'KV storage is not configured' }, { status: 503 });
  }

  const raw = (await kv.get(`device_session:${deviceCode}`)) ?? (await kv.hgetall(`device_session:${deviceCode}`));
  const session = parseSession(raw);
  if (!session) {
    return Response.json({ error: 'Session not found or expired' }, { status: 404 });
  }

  if (Date.now() > Number(session.expires_at)) {
    await kv.del(`device_session:${deviceCode}`);
    return Response.json({ error: 'Session expired' }, { status: 410 });
  }

  if (session.status === 'completed') {
    // One-time retrieval: delete session immediately so the plaintext device_token
    // cannot be replayed from browser history or logs.
    await kv.del(`device_session:${deviceCode}`);
    return Response.json(
      {
        status: 'completed',
        device_id: session.device_id,
        device_token: session.device_token,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  }

  return Response.json(
    { status: 'pending' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
