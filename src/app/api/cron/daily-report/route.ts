// ============================================================
// AI API Relay — Cron: Daily Usage Report
// GET /api/cron/daily-report
// Triggered by Vercel Cron at the configured time (default 21:00).
// Collects yesterday's usage data and sends it to all webhooks.
// ============================================================

import { NextRequest } from 'next/server';
import { sendDailyReport } from '@/lib/webhooks';
import { getWebhookSettings } from '@/lib/admin/admin-config';
import { requireCronOrAdminAuth } from '@/lib/admin/auth';
import { createUsageStorage } from '@/lib/usage/factory';

export const runtime = 'nodejs';

/**
 * GET /api/cron/daily-report
 * Protected by CRON_SECRET, Vercel cron (on Vercel without CRON_SECRET), or admin auth.
 */
export async function GET(request: NextRequest) {
  const authErr = requireCronOrAdminAuth(request);
  if (authErr) return authErr;

  const usageStorage = await createUsageStorage();

  try {
    // Check for webhooks
    const settings = await getWebhookSettings();
    if (settings.webhooks.length === 0) {
      return Response.json({ success: true, message: 'No webhooks configured', sent: 0 });
    }

    // Report covers yesterday's complete data
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const dateStr = yesterday.toISOString().slice(0, 10);

    const report = await usageStorage.getDailyReport(dateStr);
    if (!report) {
      return Response.json({
        success: true,
        message: `No usage data found for ${dateStr}`,
        sent: 0,
      });
    }

    const results = await sendDailyReport(report);
    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return Response.json({
      success: true,
      date: dateStr,
      sent,
      failed,
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: { message, code: 500 } }, { status: 500 });
  }
}
