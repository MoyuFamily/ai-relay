// ============================================================
// AI Relay — Self-Hosted Background Scheduler
// ============================================================
// Provides built-in cron execution for standalone Node.js / Docker / VPS
// deployments where Vercel Cron and Cloudflare Workers `scheduled()` are
// absent:
//   1. Periodic upstream provider health probes (`SELF_HOSTED_PROBE_INTERVAL_MINUTES`)
//   2. Daily UTC usage report rollup & expired relational row cleanup (`00:05 UTC`)
//   3. Daily Webhook report delivery at `WebhookSettings.reportTime` / `reportTimezone`
//
// Never runs on Vercel, Cloudflare Pages/Workers, Next.js build phase, or Vitest.
// ============================================================

import { isCloudflareSync } from '@/lib/cf-env';
import { getKV, getWebhookSettings } from '@/lib/admin/admin-config';
import { getRuntimeSettings } from '@/lib/admin/runtime-settings';
import { probeAllProviders } from '@/lib/health/probe';
import {
  aggregateUsageDailyReport,
  previousUtcDateKey,
  saveUsageDailyReport,
} from '@/lib/usage/daily-report-store';
import { createUsageStorage } from '@/lib/usage/factory';
import { sendDailyReport } from '@/lib/webhooks';

const LAST_PROBE_KEY = 'cron:self_hosted:last_probe_at';
const LAST_MAINTENANCE_KEY = 'cron:self_hosted:last_daily_maintenance_date';
const LAST_WEBHOOK_REPORT_KEY = 'cron:self_hosted:last_webhook_report_date';

interface SchedulerState {
  started: boolean;
  runningTick: boolean;
  interval: ReturnType<typeof setInterval> | null;
  bootTimeout: ReturnType<typeof setTimeout> | null;
  lastProbeAtMs: number;
  lastMaintenanceDate: string | null;
  lastWebhookReportDate: string | null;
}

const g = globalThis as unknown as {
  __aiRelaySelfHostedScheduler?: SchedulerState;
};

function getState(): SchedulerState {
  if (!g.__aiRelaySelfHostedScheduler) {
    g.__aiRelaySelfHostedScheduler = {
      started: false,
      runningTick: false,
      interval: null,
      bootTimeout: null,
      lastProbeAtMs: 0,
      lastMaintenanceDate: null,
      lastWebhookReportDate: null,
    };
  }
  return g.__aiRelaySelfHostedScheduler;
}

export function shouldEnableSelfHostedScheduler(): boolean {
  if (process.env.ENABLE_SELF_HOSTED_CRON === 'false' || process.env.ENABLE_SELF_HOSTED_CRON === '0') {
    return false;
  }
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.CF_PAGES) return false;
  if (isCloudflareSync()) return false;
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return false;
  // Enable by default in production self-hosted servers, or when explicitly opted in during dev
  return process.env.NODE_ENV === 'production' || process.env.ENABLE_SELF_HOSTED_CRON === 'true' || process.env.ENABLE_SELF_HOSTED_CRON === '1';
}

export function getLocalDateTimeInTimezone(
  now: Date,
  timeZone: string
): { date: string; time: string } {
  const formatWithZone = (tz: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return {
      date: `${lookup.year}-${lookup.month}-${lookup.day}`,
      time: `${lookup.hour}:${lookup.minute}`,
    };
  };

  try {
    return formatWithZone(timeZone || 'Asia/Shanghai');
  } catch {
    return formatWithZone('UTC');
  }
}

function parseMinutesOfDay(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function isWithinReportWindow(
  currentHHMM: string,
  targetHHMM: string,
  windowMinutes = 15
): boolean {
  const cur = parseMinutesOfDay(currentHHMM);
  const target = parseMinutesOfDay(targetHHMM);
  if (cur === null || target === null) return false;
  const diff = cur - target;
  return diff >= 0 && diff <= windowMinutes;
}

export interface ScheduledTickResult {
  probed: boolean;
  aggregatedDate: string | null;
  cleanedUp: boolean;
  webhookReportSent: boolean;
}

export async function runSelfHostedScheduledTick(
  now = new Date(),
  options?: { forceInitialProbe?: boolean }
): Promise<ScheduledTickResult> {
  const state = getState();
  const result: ScheduledTickResult = {
    probed: false,
    aggregatedDate: null,
    cleanedUp: false,
    webhookReportSent: false,
  };

  if (state.runningTick) {
    return result;
  }
  state.runningTick = true;

  try {
    const kv = await getKV();
    const nowMs = now.getTime();

    // 1. Periodic Upstream Provider Health Probe
    const runtimeSettings = await getRuntimeSettings().catch(() => ({} as { selfHostedProbeIntervalMinutes?: number | null }));
    const rawIntervalMin =
      typeof runtimeSettings.selfHostedProbeIntervalMinutes === 'number' &&
      Number.isFinite(runtimeSettings.selfHostedProbeIntervalMinutes)
        ? runtimeSettings.selfHostedProbeIntervalMinutes
        : Number(process.env.SELF_HOSTED_PROBE_INTERVAL_MINUTES ?? '60');
    if (Number.isFinite(rawIntervalMin) && rawIntervalMin > 0) {
      const intervalMs = Math.max(60_000, rawIntervalMin * 60_000);
      let lastProbeAt = state.lastProbeAtMs;
      if (kv) {
        const storedProbeAt = Number((await kv.get(LAST_PROBE_KEY)) || 0);
        if (storedProbeAt > lastProbeAt) lastProbeAt = storedProbeAt;
      }

      if (options?.forceInitialProbe ? lastProbeAt === 0 : nowMs - lastProbeAt >= intervalMs) {
        state.lastProbeAtMs = nowMs;
        if (kv) {
          await kv.set(LAST_PROBE_KEY, nowMs, { ex: 7 * 86_400 });
        }
        await probeAllProviders(false, now.toISOString());
        result.probed = true;
      }
    }

    // 2. Daily UTC Rollup & Relational Cleanup (after 00:05 UTC once per UTC date)
    const utcDate = now.toISOString().slice(0, 10);
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (utcMinutes >= 5) {
      let lastMaint = state.lastMaintenanceDate;
      if (kv) {
        const storedMaint = await kv.get(LAST_MAINTENANCE_KEY);
        if (typeof storedMaint === 'string' && storedMaint) lastMaint = storedMaint;
      }

      if (lastMaint !== utcDate) {
        state.lastMaintenanceDate = utcDate;
        if (kv) {
          await kv.set(LAST_MAINTENANCE_KEY, utcDate, { ex: 7 * 86_400 });
        }

        const yesterdayUtc = previousUtcDateKey(now);
        const aggregated = await aggregateUsageDailyReport(yesterdayUtc);
        if (aggregated) {
          await saveUsageDailyReport(aggregated);
          result.aggregatedDate = yesterdayUtc;
        }

        const usageStorage = await createUsageStorage();
        const maybeCleanable = usageStorage as unknown as {
          cleanupExpired?: () => Promise<unknown>;
        };
        if (typeof maybeCleanable.cleanupExpired === 'function') {
          await maybeCleanable.cleanupExpired();
          result.cleanedUp = true;
        }
      }
    }

    // 3. Daily Webhook Report Delivery (in configured reportTimezone at reportTime)
    const webhookSettings = await getWebhookSettings();
    const enabledWebhooks = webhookSettings.webhooks.filter((w) => w.enabled);
    if (enabledWebhooks.length > 0) {
      const { date: localDate, time: localTime } = getLocalDateTimeInTimezone(
        now,
        webhookSettings.reportTimezone || 'Asia/Shanghai'
      );

      if (isWithinReportWindow(localTime, webhookSettings.reportTime || '21:00', 15)) {
        let lastSentDate = state.lastWebhookReportDate;
        if (kv) {
          const storedSent = await kv.get(LAST_WEBHOOK_REPORT_KEY);
          if (typeof storedSent === 'string' && storedSent) lastSentDate = storedSent;
        }

        if (lastSentDate !== localDate) {
          state.lastWebhookReportDate = localDate;
          if (kv) {
            await kv.set(LAST_WEBHOOK_REPORT_KEY, localDate, { ex: 7 * 86_400 });
          }

          const yesterdayStr = previousUtcDateKey(now);
          const usageStorage = await createUsageStorage();
          const report = await usageStorage.getDailyReport(yesterdayStr);
          if (report) {
            await sendDailyReport(report);
            result.webhookReportSent = true;
          }
        }
      }
    }
  } catch (err) {
    console.warn(
      '[self-hosted-scheduler] tick error:',
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    state.runningTick = false;
  }

  return result;
}

export function startSelfHostedScheduler(): boolean {
  if (!shouldEnableSelfHostedScheduler()) {
    return false;
  }

  const state = getState();
  if (state.started) {
    return false;
  }
  state.started = true;

  // Gentle initial warm-up probe 15s after server boot
  state.bootTimeout = setTimeout(() => {
    void runSelfHostedScheduledTick(new Date(), { forceInitialProbe: true });
  }, 15_000);
  state.bootTimeout.unref?.();

  // Minute-resolution scheduler loop
  state.interval = setInterval(() => {
    void runSelfHostedScheduledTick(new Date());
  }, 60_000);
  state.interval.unref?.();

  return true;
}

export function stopSelfHostedScheduler(): void {
  const state = getState();
  if (state.bootTimeout) {
    clearTimeout(state.bootTimeout);
    state.bootTimeout = null;
  }
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
  state.started = false;
}

export const __selfHostedSchedulerForTests = {
  reset(): void {
    stopSelfHostedScheduler();
    const state = getState();
    state.runningTick = false;
    state.lastProbeAtMs = 0;
    state.lastMaintenanceDate = null;
    state.lastWebhookReportDate = null;
  },
};
