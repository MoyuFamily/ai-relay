// ============================================================
// AI Relay — Cron Provider Probe
// GET /api/cron/probe
// ============================================================

import { NextRequest } from 'next/server';
import { requireCronOrAdminAuth } from '@/lib/admin';
import { probeAllProviders } from '@/lib/health/probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireCronOrAdminAuth(request);
  if (auth) return auth;

  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const { timestamp, providers } = await probeAllProviders(refresh);

  return Response.json({ success: true, timestamp, providers }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
