// ============================================================
// AI Relay — Cron Usage Daily Aggregation
// GET /api/cron/usage
// ============================================================

import { NextRequest } from 'next/server';
import { getKV, getWebhookSettings, requireCronOrAdminAuth } from '@/lib/admin';
import { aggregateUsageDailyReport, previousUtcDateKey, saveUsageDailyReport } from '@/lib/usage/daily-report-store';
import { createUsageStorage } from '@/lib/usage/factory';
import { sendDailyReport } from '@/lib/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const LAST_CRON_WEBHOOK_REPORT_KEY = 'cron:usage:last_webhook_report_date';

export async function GET(request: NextRequest) {
  const auth = requireCronOrAdminAuth(request);
  if (auth) return auth;

  const url = new URL(request.url);
  const date = url.searchParams.get('date') || previousUtcDateKey();

  try {
    const report = await aggregateUsageDailyReport(date);
    if (report) {
      await saveUsageDailyReport(report);
    }

    // Run relational cleanup when supported (Cloudflare D1 / Self-Hosted Postgres)
    let cleanedUp = false;
    let webhookReportSent = false;
    try {
      const usageStorage = await createUsageStorage();
      const maybeCleanable = usageStorage as unknown as {
        cleanupExpired?: () => Promise<unknown>;
      };
      if (typeof maybeCleanable.cleanupExpired === 'function') {
        await maybeCleanable.cleanupExpired();
        cleanedUp = true;
      }

      // Also dispatch daily webhook report once per report date when webhooks are enabled,
      // ensuring Vercel Hobby (2-cron cap) & Cloudflare Pages users receive daily reports.
      const webhookSettings = await getWebhookSettings();
      const hasEnabledWebhooks = webhookSettings.webhooks.some((w) => w.enabled);
      if (hasEnabledWebhooks) {
        const kv = await getKV();
        const lastSentDate = kv ? await kv.get(LAST_CRON_WEBHOOK_REPORT_KEY) : null;
        if (lastSentDate !== date) {
          const dailyReport = await usageStorage.getDailyReport(date);
          if (dailyReport) {
            await sendDailyReport(dailyReport);
            webhookReportSent = true;
            if (kv) {
              await kv.set(LAST_CRON_WEBHOOK_REPORT_KEY, date, { ex: 7 * 86_400 });
            }
          }
        }
      }
    } catch {
      // Non-critical housekeeping; aggregation result still succeeds
    }

    if (!report) {
      return Response.json(
        { success: true, date, message: 'No usage data found', report: null, cleanedUp, webhookReportSent },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    return Response.json(
      { success: true, date, report, cleanedUp, webhookReportSent },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : String(error), code: 500 } },
      { status: 500 }
    );
  }
}
