// ============================================================
// AI API Relay — Admin: KV Statistics Backup & Restore API
// GET/POST /api/admin/backup/stats
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, exportStatsData, importStatsData } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/backup/stats
 *
 * Exports statistics data (daily reports, usage counts, errors) for a specified date range.
 * Query params: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  if (!startDate || !endDate) {
    return Response.json(
      { error: { message: 'Missing required query parameters: startDate and endDate (format: YYYY-MM-DD)', code: 400 } },
      { status: 400 }
    );
  }

  try {
    const backup = await exportStatsData(startDate, endDate);
    return Response.json(backup, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message || 'Failed to export statistics backup', code: 500 } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/backup/stats
 *
 * Imports statistics backup payload into KV.
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  try {
    await importStatsData(body);
    return Response.json({ success: true, message: 'Statistics data restored successfully' });
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message || 'Failed to import statistics data', code: 500 } },
      { status: 500 }
    );
  }
}
