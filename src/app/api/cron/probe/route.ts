// ============================================================
// AI Relay — Cron Provider Probe
// GET /api/cron/probe
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { probeAllProviders } from '@/lib/health/probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function cronOrAdminAuth(request: NextRequest): Response | null {
  if (request.headers.get('x-vercel-cron') === '1') return null;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('x-cron-secret') === cronSecret) return null;
  return requireAdminAuth(request);
}

export async function GET(request: NextRequest) {
  const auth = cronOrAdminAuth(request);
  if (auth) return auth;

  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const { timestamp, providers } = await probeAllProviders(refresh);

  return Response.json({ success: true, timestamp, providers }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
