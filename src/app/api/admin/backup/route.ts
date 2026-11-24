// ============================================================
// AI API Relay — Admin: KV Configuration Backup & Restore API
// GET/POST /api/admin/backup
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, exportBackupData, importBackupData } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/backup
 *
 * Exports all configuration-related data from Vercel KV.
 */
export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const backup = await exportBackupData();
    return Response.json(backup, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message || 'Failed to export backup data', code: 500 } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/backup
 *
 * Imports configuration-related data back into Vercel KV from a backup payload.
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
    await importBackupData(body);
    return Response.json({ success: true, message: 'Configuration backup restored successfully' });
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message || 'Failed to import backup data', code: 500 } },
      { status: 500 }
    );
  }
}
