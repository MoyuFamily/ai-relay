// ============================================================
// AI Relay — Cron Provider Probe
// GET /api/cron/probe
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';
import type { ProviderConfig } from '@/lib/providers';
import { getKeyPool } from '@/lib/relay/key-pool';
import { buildHeaders } from '@/lib/relay/transform';
import { recordHealthProbeResult } from '@/lib/health/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function cronOrAdminAuth(request: NextRequest): Response | null {
  if (request.headers.get('x-vercel-cron') === '1') return null;
  return requireAdminAuth(request);
}

async function probeProvider(provider: ProviderConfig): Promise<{
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error?: string;
  skipped?: boolean;
}> {
  const pool = await getKeyPool(provider);
  const key = pool.keys[0];
  if (!key) {
    return { ok: false, statusCode: null, responseTimeMs: null, skipped: true, error: 'no_available_key' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const started = Date.now();
  try {
    const res = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: buildHeaders(provider.headerFormat, key.key, false),
      signal: controller.signal,
    });
    const responseTimeMs = Date.now() - started;
    return {
      ok: res.ok,
      statusCode: res.status,
      responseTimeMs,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      responseTimeMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const auth = cronOrAdminAuth(request);
  if (auth) return auth;

  const timestamp = new Date().toISOString();
  const providers = await getAllProviders(request.nextUrl.searchParams.get('refresh') === '1');
  const results = [];

  for (const [id, provider] of Object.entries(providers)) {
    const probe = await probeProvider(provider);
    const record = await recordHealthProbeResult({
      providerId: id,
      providerName: provider.displayName,
      ok: probe.ok,
      statusCode: probe.statusCode,
      responseTimeMs: probe.responseTimeMs,
      checkedAt: timestamp,
      error: probe.error,
      skipped: probe.skipped,
    });
    results.push(record);
  }

  return Response.json({ success: true, timestamp, providers: results }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
