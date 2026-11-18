// ============================================================
// Cloudflare Pages Scheduled Handler
//
// CF Cron Triggers don't invoke HTTP routes — they call this
// scheduled() handler directly. We forward to the appropriate
// cron logic based on the schedule.
// ============================================================

import type {
  D1Database,
  ExecutionContext,
  KVNamespace,
  ScheduledEvent,
} from '@cloudflare/workers-types';

interface Env {
  KV: KVNamespace;
  DB: D1Database;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const cron = event.cron;

    // Map cron schedules to their handlers
    // "0 0 * * *" → daily quota & stale-error cleanup at midnight UTC
    // "5 0 * * *" → daily probe heartbeat at 00:05 UTC
    if (cron === '0 0 * * *') {
      ctx.waitUntil(handleDailyReset(env));
    } else if (cron === '5 0 * * *') {
      ctx.waitUntil(handleDailyProbe(env));
    } else {
      console.warn(`[Cron] Unknown schedule: ${cron}`);
    }
  },
};

/**
 * Daily reset: prune expired quota_counters and >31-day error rows in D1.
 * Note: D1UsageStorage keys quota_counters by `(period, period_type)` in UTC+8
 * (`period = 'YYYY-MM-DD'`, `period_type = 'daily'` and `period = 'YYYY-MM'`, `period_type = 'monthly'`).
 */
async function handleDailyReset(env: Env): Promise<void> {
  try {
    const nowBeijingMs = Date.now() + 8 * 60 * 60 * 1000;
    const cutoffDailyQuota = new Date(nowBeijingMs - 2 * 86_400_000).toISOString().slice(0, 10);
    const cutoffMonthlyDate = new Date(nowBeijingMs);
    cutoffMonthlyDate.setUTCDate(1);
    cutoffMonthlyDate.setUTCMonth(cutoffMonthlyDate.getUTCMonth() - 2);
    const cutoffMonthlyQuota = cutoffMonthlyDate.toISOString().slice(0, 7);
    const cutoffErrors = new Date(nowBeijingMs - 31 * 86_400_000).toISOString().slice(0, 10);

    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM quota_counters
         WHERE (period_type = 'daily' AND period < ?)
            OR (period_type = 'monthly' AND period < ?)`
      ).bind(cutoffDailyQuota, cutoffMonthlyQuota),
      env.DB.prepare('DELETE FROM error_stats WHERE date < ?').bind(cutoffErrors),
      env.DB.prepare('DELETE FROM error_key_stats WHERE date < ?').bind(cutoffErrors),
    ]);

    console.log(
      `[Cron] Daily cleanup completed: daily<${cutoffDailyQuota}, monthly<${cutoffMonthlyQuota}, errors<${cutoffErrors}`
    );
  } catch (error) {
    console.error('[Cron] Daily reset failed:', error);
    throw error;
  }
}

/**
 * Daily probe: health check to verify cron is working.
 */
async function handleDailyProbe(env: Env): Promise<void> {
  try {
    const timestamp = new Date().toISOString();

    // Write probe timestamp to KV
    await env.KV.put('cron:last_probe', timestamp, {
      expirationTtl: 86400 * 7, // 7 days
    });

    console.log(`[Cron] Daily probe completed at ${timestamp}`);
  } catch (error) {
    console.error('[Cron] Daily probe failed:', error);
    throw error;
  }
}
