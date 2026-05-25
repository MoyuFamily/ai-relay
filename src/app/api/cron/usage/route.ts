// ============================================================
// AI Relay — Cron Usage Daily Aggregation
// GET /api/cron/usage
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { aggregateUsageDailyReport, previousUtcDateKey, saveUsageDailyReport } from '@/lib/usage/daily-report-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function cronOrAdminAuth(request: NextRequest): Response | null {
  if (request.headers.get('x-vercel-cron') === '1') return null;
  return requireAdminAuth(request);
}

export async function GET(request: NextRequest) {
  const auth = cronOrAdminAuth(request);
  if (auth) return auth;

  const url = new URL(request.url);
  const date = url.searchParams.get('date') || previousUtcDateKey();

  try {
    const report = await aggregateUsageDailyReport(date);
    if (!report) {
      return Response.json({ success: true, date, message: 'No usage data found', report: null });
    }

    await saveUsageDailyReport(report);
    return Response.json({ success: true, date, report }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : String(error), code: 500 } },
      { status: 500 }
    );
  }
}
