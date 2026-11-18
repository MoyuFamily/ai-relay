// ============================================================
// AI Relay API — Usage Batch Upload (Multi-Platform KV + D1)
// ============================================================

import { NextRequest } from 'next/server';
import { getKV } from '@/lib/admin';
import { verifyDeviceToken } from '@/lib/local/device-auth';
import { createUsageEvent } from '@/lib/usage';
import { createUsageStorage } from '@/lib/usage/factory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BATCH_EVENTS = 500;

// POST /api/local/usage/batch - Receive usage & heartbeat from local relay
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim() || '';

  if (!token) {
    return Response.json({ error: 'Missing token' }, { status: 401 });
  }

  // Verify device token using O(1) reverse index across CF KV / Vercel KV / dev mock
  const deviceId = await verifyDeviceToken(token);
  if (!deviceId) {
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }

  let body: { events?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rawEvents = Array.isArray(body.events) ? body.events : [];
  if (rawEvents.length > MAX_BATCH_EVENTS) {
    return Response.json(
      { error: `Batch exceeds maximum of ${MAX_BATCH_EVENTS} events` },
      { status: 400 }
    );
  }

  if (rawEvents.length > 0) {
    const usageStorage = await createUsageStorage();
    for (const item of rawEvents) {
      if (!item || typeof item !== 'object') continue;
      const ev = item as Record<string, unknown>;
      const promptTokens = Math.max(0, Number(ev.promptTokens ?? ev.prompt_tokens ?? 0) || 0);
      const completionTokens = Math.max(0, Number(ev.completionTokens ?? ev.completion_tokens ?? 0) || 0);
      const usageEvent = createUsageEvent({
        provider: typeof ev.provider === 'string' ? ev.provider : 'local',
        model: typeof ev.model === 'string' ? ev.model : 'unknown',
        apiKeyHash: typeof ev.apiKeyHash === 'string' ? ev.apiKeyHash : `device:${deviceId}`,
        statusCode: Number(ev.statusCode ?? ev.status_code ?? 200) || 200,
        promptTokens,
        completionTokens,
        latencyMs: Math.max(0, Number(ev.latencyMs ?? ev.latency_ms ?? 0) || 0),
        isStream: Boolean(ev.isStream ?? ev.is_stream),
      });
      await usageStorage.record(usageEvent);
    }
  }

  // Update last heartbeat
  const kv = await getKV();
  if (kv) {
    await kv.hset(`device:${deviceId}`, {
      last_heartbeat: Date.now(),
      status: 'online',
    });
  }

  return Response.json({ success: true, received: rawEvents.length });
}
