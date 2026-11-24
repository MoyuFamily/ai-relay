// ============================================================
// AI API Relay — Admin: Global Quota Limit Override Management
// PUT/DELETE /api/admin/quota
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, setCustomQuota, clearCustomQuota } from '@/lib/admin';

export const runtime = 'nodejs';

/**
 * PUT /api/admin/quota
 *
 * Saves custom daily/monthly request limits to KV.
 * Body: { dailyLimit: number | null, monthlyLimit: number | null }
 */
export async function PUT(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: { dailyLimit?: unknown; monthlyLimit?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  // Validate fields — must be either null, undefined, or a non-negative integer
  const validateLimit = (val: unknown, name: string) => {
    if (val === null || val === undefined || val === '') return null;
    const parsed = Number(val);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a non-negative integer or null`);
    }
    return parsed;
  };

  let dailyLimit: number | null = null;
  let monthlyLimit: number | null = null;

  try {
    dailyLimit = validateLimit(body.dailyLimit, 'dailyLimit');
    monthlyLimit = validateLimit(body.monthlyLimit, 'monthlyLimit');
  } catch (e) {
    return Response.json(
      { error: { message: e instanceof Error ? e.message : 'Invalid parameters', code: 400 } },
      { status: 400 }
    );
  }

  await setCustomQuota({ dailyLimit, monthlyLimit });

  return Response.json({
    status: 'success',
    dailyLimit,
    monthlyLimit,
    message: 'Global quota limits updated successfully',
  });
}

/**
 * DELETE /api/admin/quota
 *
 * Clears custom limits from KV and reverts to env variables.
 */
export async function DELETE(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  await clearCustomQuota();

  return Response.json({
    status: 'success',
    message: 'Global quota limits reset to environment variable defaults',
  });
}
