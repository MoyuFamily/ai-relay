// ============================================================
// AI API Relay — Admin: Webhook CRUD API
// GET    /api/admin/webhooks     — List all webhook settings
// POST   /api/admin/webhooks     — Add a new webhook
// PUT    /api/admin/webhooks     — Update a webhook (by id in body)
// DELETE /api/admin/webhooks     — Delete a webhook (by id in body)
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getWebhookSettings, saveWebhookSettings, addWebhook, updateWebhook, deleteWebhook } from '@/lib/admin/admin-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_PLATFORMS = ['wecom', 'feishu', 'dingtalk', 'slack', 'generic'];

/**
 * GET /api/admin/webhooks
 * Returns the full webhook settings (webhooks list + alert thresholds + report config).
 */
export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const settings = await getWebhookSettings();
    return Response.json({ success: true, settings }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message, code: 500 } }, { status: 500 });
  }
}

/**
 * POST /api/admin/webhooks
 * Add a new webhook. Body: { name, url, platform, enabled?, template? }
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

  const { name, url, platform, enabled, template } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return Response.json(
      { error: { message: 'Webhook name is required', code: 400 } },
      { status: 400 }
    );
  }
  if (!url || typeof url !== 'string' || !url.startsWith('https://')) {
    return Response.json(
      { error: { message: 'Webhook URL is required and must start with https://', code: 400 } },
      { status: 400 }
    );
  }
  if (!platform || !VALID_PLATFORMS.includes(platform as string)) {
    return Response.json(
      { error: { message: `Platform must be one of: ${VALID_PLATFORMS.join(', ')}`, code: 400 } },
      { status: 400 }
    );
  }

  try {
    const webhook = await addWebhook({
      name: (name as string).trim(),
      url: url as string,
      platform: platform as 'wecom' | 'feishu' | 'dingtalk' | 'slack' | 'generic',
      enabled: enabled !== false,
      template: template as string | undefined,
    });
    return Response.json({ success: true, webhook });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message, code: 500 } }, { status: 500 });
  }
}

/**
 * PUT /api/admin/webhooks
 * Update a webhook. Body: { id, name?, url?, platform?, enabled?, template? }
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

  const { id, ...updates } = body;
  if (!id || typeof id !== 'string') {
    return Response.json(
      { error: { message: 'Webhook id is required', code: 400 } },
      { status: 400 }
    );
  }

  // Validate platform if provided
  if (updates.platform && !VALID_PLATFORMS.includes(updates.platform as string)) {
    return Response.json(
      { error: { message: `Platform must be one of: ${VALID_PLATFORMS.join(', ')}`, code: 400 } },
      { status: 400 }
    );
  }
  // Validate URL if provided
  if (updates.url && typeof updates.url === 'string' && !updates.url.startsWith('https://')) {
    return Response.json(
      { error: { message: 'URL must start with https://', code: 400 } },
      { status: 400 }
    );
  }

  // Cast updates to the right type
  const typedUpdates: Record<string, unknown> = {};
  if (updates.name !== undefined) typedUpdates.name = updates.name;
  if (updates.url !== undefined) typedUpdates.url = updates.url;
  if (updates.platform !== undefined) typedUpdates.platform = updates.platform;
  if (updates.enabled !== undefined) typedUpdates.enabled = updates.enabled;
  if (updates.template !== undefined) typedUpdates.template = updates.template;

  try {
    const webhook = await updateWebhook(id as string, typedUpdates as Partial<import('@/lib/webhooks/types').WebhookConfig>);
    if (!webhook) {
      return Response.json(
        { error: { message: 'Webhook not found', code: 404 } },
        { status: 404 }
      );
    }
    return Response.json({ success: true, webhook });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message, code: 500 } }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/webhooks
 * Delete a webhook. Body: { id }
 */
export async function DELETE(request: NextRequest) {
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

  const { id } = body;
  if (!id || typeof id !== 'string') {
    return Response.json(
      { error: { message: 'Webhook id is required', code: 400 } },
      { status: 400 }
    );
  }

  try {
    const deleted = await deleteWebhook(id as string);
    if (!deleted) {
      return Response.json(
        { error: { message: 'Webhook not found', code: 404 } },
        { status: 404 }
      );
    }
    return Response.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message, code: 500 } }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/webhooks
 * Update report settings (reportTime, reportTimezone).
 * Body: { reportTime?: string, reportTimezone?: string }
 */
export async function PATCH(request: NextRequest) {
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

  const { reportTime, reportTimezone } = body;

  try {
    const settings = await getWebhookSettings();
    if (reportTime && typeof reportTime === 'string') {
      settings.reportTime = reportTime;
    }
    if (reportTimezone && typeof reportTimezone === 'string') {
      settings.reportTimezone = reportTimezone;
    }
    await saveWebhookSettings(settings);
    return Response.json({ success: true, settings });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message, code: 500 } }, { status: 500 });
  }
}
