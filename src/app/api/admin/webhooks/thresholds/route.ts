// ============================================================
// AI API Relay — Admin: Webhook Alert Thresholds API
// PUT /api/admin/webhooks/thresholds — Update alert thresholds
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { saveAlertThresholds } from '@/lib/admin/admin-config';

export const runtime = 'nodejs';

/**
 * PUT /api/admin/webhooks/thresholds
 * Update alert thresholds. Body: { thresholds: WebhookAlertThreshold[] }
 */
export async function PUT(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  const { thresholds } = body;
  if (!Array.isArray(thresholds)) {
    return Response.json(
      { error: { message: 'thresholds must be an array', code: 400 } },
      { status: 400 }
    );
  }

  // Validate each threshold
  for (const t of thresholds) {
    if (!t.provider || typeof t.provider !== 'string') {
      return Response.json(
        { error: { message: 'Each threshold must have a provider string', code: 400 } },
        { status: 400 }
      );
    }
    if (t.dailyRequestLimit !== undefined && typeof t.dailyRequestLimit !== 'number') {
      return Response.json(
        { error: { message: 'dailyRequestLimit must be a number', code: 400 } },
        { status: 400 }
      );
    }
    if (t.dailyTokenLimit !== undefined && typeof t.dailyTokenLimit !== 'number') {
      return Response.json(
        { error: { message: 'dailyTokenLimit must be a number', code: 400 } },
        { status: 400 }
      );
    }
  }

  try {
    await saveAlertThresholds(thresholds);
    return Response.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message, code: 500 } }, { status: 500 });
  }
}
