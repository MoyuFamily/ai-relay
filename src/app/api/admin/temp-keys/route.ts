// ============================================================
// AI API Relay — Admin Temp Keys API (/api/admin/temp-keys)
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { generateTempKey } from '@/lib/relay';

export const runtime = 'nodejs';

/**
 * POST /api/admin/temp-keys
 *
 * Generates a temporary access key with a specified duration.
 */
export async function POST(request: NextRequest) {
  // Auth check — require RELAY_ADMIN_KEY (falls back to RELAY_API_KEY)
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body.', code: 400 } },
      { status: 400 }
    );
  }

  const durationSeconds = Number(body.durationSeconds);
  if (isNaN(durationSeconds) || durationSeconds <= 0) {
    return Response.json(
      { error: { message: 'Invalid durationSeconds. Must be a positive number.', code: 400 } },
      { status: 400 }
    );
  }

  try {
    const tempKeyData = await generateTempKey(durationSeconds);
    return Response.json({
      status: 'ok',
      key: tempKeyData.key,
      expiresAt: tempKeyData.expiresAt,
    });
  } catch (error: any) {
    return Response.json(
      { error: { message: error.message || 'Failed to generate temporary key.', code: 500 } },
      { status: 500 }
    );
  }
}
