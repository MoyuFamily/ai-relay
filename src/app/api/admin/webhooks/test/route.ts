// ============================================================
// AI API Relay — Admin: Webhook Test API
// POST /api/admin/webhooks/test — Send a test message to a webhook
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getWebhookSettings } from '@/lib/admin/admin-config';
import { sendTestMessage } from '@/lib/webhooks';

export const runtime = 'nodejs';

/**
 * POST /api/admin/webhooks/test
 * Send a test message to a specific webhook.
 * Body: { webhookId: string }
 */
export async function POST(request: NextRequest) {
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

  const { webhookId } = body;
  if (!webhookId || typeof webhookId !== 'string') {
    return Response.json(
      { error: { message: 'webhookId is required', code: 400 } },
      { status: 400 }
    );
  }

  try {
    const settings = await getWebhookSettings();
    const webhook = settings.webhooks.find(w => w.id === webhookId);
    if (!webhook) {
      return Response.json(
        { error: { message: 'Webhook not found', code: 404 } },
        { status: 404 }
      );
    }

    const result = await sendTestMessage(webhook);
    return Response.json({ success: true, result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message, code: 500 } }, { status: 500 });
  }
}
