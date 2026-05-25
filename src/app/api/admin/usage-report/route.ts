// ============================================================
// AI Relay — Admin Usage Report API
// GET /api/admin/usage-report?from=YYYY-MM-DD&to=YYYY-MM-DD
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getUsageDailyReportsWithGaps, reportsToTrend } from '@/lib/usage/daily-report-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const auth = requireAdminAuth(request);
  if (auth) return auth;

  const url = new URL(request.url);
  const to = url.searchParams.get('to') || todayUtc();
  const from = url.searchParams.get('from') || to;

  try {
    const { reports, timeline } = await getUsageDailyReportsWithGaps(from, to);
    return Response.json({
      range: { from, to },
      reports,
      trend: reportsToTrend(timeline),
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : String(error), code: 500 } },
      { status: 500 }
    );
  }
}
