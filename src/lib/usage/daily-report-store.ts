// ============================================================
// AI Relay — Daily Usage Report KV Store
// ============================================================

import { withTimeout } from '@/lib/utils/timeout';
import { getAllProviders } from '@/lib/providers';
import type { TrendPoint } from '@/lib/usage';
import { getCFEnvSync, getCFEnv, isCloudflareSync } from '@/lib/cf-env';
import { getKV as getSharedKV } from '@/lib/admin/admin-config';

export interface UsageDailyReport {
  date: string;
  summary: {
    totalRequests: number;
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    errorRate: number;
    p95LatencyMs: number | null;
  };
  byProvider: Record<string, {
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
  }>;
  topModels: Array<{ model: string; requests: number; tokens: number }>;
}

let _kv: any = null;

export const usageReportKeys = {
  daily: (date: string) => `relay:report:daily:${date}`,
  usageDaily: (date: string) => `usage:daily:${date}`,
  usageProviderDaily: (provider: string, date: string) => `usage:provider:${provider}:daily:${date}`,
};

async function getKV() {
  if (_kv) return _kv;
  return getSharedKV();
}

function canUseSelfHostedPostgresReports(): boolean {
  if (isCloudflareSync()) return false;
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  if (process.env.VERCEL || process.env.CF_PAGES) return false;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return false;
  if (process.env.RELAY_STORAGE_PATH?.trim() || process.env.RELAY_DATA_DIR?.trim()) return false;
  if (process.env.VITEST && process.env.RELAY_ENABLE_POSTGRES_IN_TEST !== '1') return false;
  const url = process.env.DATABASE_URL?.trim() || '';
  return /^postgres(ql)?:\/\//i.test(url);
}

function parseReport(raw: unknown): UsageDailyReport | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as UsageDailyReport; } catch { return null; }
  }
  if (typeof raw === 'object') return raw as UsageDailyReport;
  return null;
}

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function previousUtcDateKey(now = new Date()): string {
  return toDateKey(new Date(now.getTime() - 86_400_000));
}

export function enumerateDateKeys(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const result: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    result.push(toDateKey(new Date(t)));
  }
  return result.slice(0, 366);
}

export async function aggregateUsageDailyReport(date: string): Promise<UsageDailyReport | null> {
  // On Cloudflare Pages/Workers, usage data is stored in D1 (`daily_usage` + `error_stats`),
  // while KVUsageStorage is intentionally disabled. Aggregate from D1 first when bound.
  const cfEnv = getCFEnvSync() || await getCFEnv();
  if (cfEnv?.DB) {
    try {
      const [usageRows, errorRows] = await cfEnv.DB.batch([
        cfEnv.DB.prepare(
          `SELECT provider, requests, tokens, prompt_tokens, completion_tokens
           FROM daily_usage WHERE date = ?`
        ).bind(date),
        cfEnv.DB.prepare(
          `SELECT SUM(count) as total_errors FROM error_stats WHERE date = ?`
        ).bind(date),
      ]);

      const rows = (usageRows.results || []) as Array<Record<string, unknown>>;
      if (rows.length === 0) return null;

      let totalRequests = 0;
      let totalTokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      const byProvider: UsageDailyReport['byProvider'] = {};

      for (const row of rows) {
        const provider = String(row.provider ?? '');
        if (provider === '') {
          totalRequests = Number(row.requests ?? 0);
          totalTokens = Number(row.tokens ?? 0);
          promptTokens = Number(row.prompt_tokens ?? 0);
          completionTokens = Number(row.completion_tokens ?? 0);
        } else {
          byProvider[provider] = {
            requests: Number(row.requests ?? 0),
            tokens: Number(row.tokens ?? 0),
            promptTokens: Number(row.prompt_tokens ?? 0),
            completionTokens: Number(row.completion_tokens ?? 0),
          };
        }
      }

      if (totalRequests === 0 && Object.keys(byProvider).length === 0) {
        return null;
      }

      const totalErrors = Number(((errorRows.results?.[0] as Record<string, unknown> | undefined)?.total_errors) ?? 0);
      const denominator = totalRequests + totalErrors;
      const errorRate = denominator > 0 ? Math.round((totalErrors / denominator) * 10000) / 10000 : 0;

      return {
        date,
        summary: {
          totalRequests,
          totalTokens,
          promptTokens,
          completionTokens,
          errorRate,
          p95LatencyMs: null,
        },
        byProvider,
        topModels: [],
      };
    } catch {
      // Fall through to KV if D1 query fails
    }
  }

  // Self-hosted PostgreSQL: usage is stored in relational `daily_usage` + `error_stats`
  if (canUseSelfHostedPostgresReports()) {
    try {
      const [{ getPostgresSql }, { ensureSelfHostedPostgresSchema }] = await Promise.all([
        import('@/lib/db/client'),
        import('@/lib/db/self-hosted-schema'),
      ]);
      const sql = getPostgresSql();
      await ensureSelfHostedPostgresSchema(sql);

      const [usageRows, errorRows] = await Promise.all([
        sql<Array<Record<string, unknown>>>`
          SELECT provider, requests, tokens, prompt_tokens, completion_tokens
          FROM daily_usage
          WHERE date = ${date}
        `,
        sql<Array<{ total_errors: string | number | null }>>`
          SELECT COALESCE(SUM(count), 0) AS total_errors
          FROM error_stats
          WHERE date = ${date}
        `,
      ]);

      if (usageRows.length === 0) return null;

      let totalRequests = 0;
      let totalTokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      const byProvider: UsageDailyReport['byProvider'] = {};

      for (const row of usageRows) {
        const provider = String(row.provider ?? '');
        if (provider === '') {
          totalRequests = Number(row.requests ?? 0);
          totalTokens = Number(row.tokens ?? 0);
          promptTokens = Number(row.prompt_tokens ?? 0);
          completionTokens = Number(row.completion_tokens ?? 0);
        } else {
          byProvider[provider] = {
            requests: Number(row.requests ?? 0),
            tokens: Number(row.tokens ?? 0),
            promptTokens: Number(row.prompt_tokens ?? 0),
            completionTokens: Number(row.completion_tokens ?? 0),
          };
        }
      }

      if (totalRequests === 0 && Object.keys(byProvider).length === 0) {
        return null;
      }

      const totalErrors = Number(errorRows[0]?.total_errors ?? 0);
      const denominator = totalRequests + totalErrors;
      const errorRate = denominator > 0 ? Math.round((totalErrors / denominator) * 10000) / 10000 : 0;

      return {
        date,
        summary: {
          totalRequests,
          totalTokens,
          promptTokens,
          completionTokens,
          errorRate,
          p95LatencyMs: null,
        },
        byProvider,
        topModels: [],
      };
    } catch {
      // Fall through to KV if Postgres query fails
    }
  }

  const kv = await getKV();
  if (!kv) return null;

  const providers = await getAllProviders();
  const providerIds = Object.keys(providers);
  const pipeline = kv.pipeline?.();
  let rawResults: unknown[];
  if (pipeline) {
    pipeline.hgetall(usageReportKeys.usageDaily(date));
    for (const id of providerIds) pipeline.hgetall(usageReportKeys.usageProviderDaily(id, date));
    rawResults = await withTimeout(pipeline.exec(), 2000, [], 'usage-report:aggregate:pipeline');
  } else {
    rawResults = await Promise.all([
      kv.hgetall(usageReportKeys.usageDaily(date)),
      ...providerIds.map((id) => kv.hgetall(usageReportKeys.usageProviderDaily(id, date))),
    ]);
  }

  const globalRaw = rawResults[0] as Record<string, unknown> | null;
  if (!globalRaw || Object.keys(globalRaw).length === 0) return null;

  const byProvider: UsageDailyReport['byProvider'] = {};
  providerIds.forEach((id, idx) => {
    const raw = rawResults[idx + 1] as Record<string, unknown> | null;
    if (!raw || Object.keys(raw).length === 0) return;
    byProvider[id] = {
      requests: Number(raw.requests ?? 0),
      tokens: Number(raw.tokens ?? 0),
      promptTokens: Number(raw.promptTokens ?? 0),
      completionTokens: Number(raw.completionTokens ?? 0),
    };
  });

  return {
    date,
    summary: {
      totalRequests: Number(globalRaw.requests ?? 0),
      totalTokens: Number(globalRaw.tokens ?? 0),
      promptTokens: Number(globalRaw.promptTokens ?? 0),
      completionTokens: Number(globalRaw.completionTokens ?? 0),
      errorRate: Number(globalRaw.errorRate ?? 0),
      p95LatencyMs: globalRaw.p95LatencyMs == null ? null : Number(globalRaw.p95LatencyMs),
    },
    byProvider,
    topModels: [],
  };
}

export async function saveUsageDailyReport(report: UsageDailyReport): Promise<void> {
  const kv = await getKV();
  if (!kv) return;
  await withTimeout(Promise.all([
    kv.set(usageReportKeys.daily(report.date), report),
    kv.expire(usageReportKeys.daily(report.date), 30 * 24 * 60 * 60),
  ]), 2000, undefined, 'usage-report:save');
}

export async function getUsageDailyReports(from: string, to: string): Promise<UsageDailyReport[]> {
  const kv = await getKV();
  if (!kv) return [];
  const dates = enumerateDateKeys(from, to);
  const keys = dates.map(usageReportKeys.daily);
  const values: unknown[] = keys.length ? await withTimeout(kv.mget(keys), 2000, [], 'usage-report:mget') : [];
  return values.map(parseReport).filter((v): v is UsageDailyReport => Boolean(v));
}

const ZERO_REPORT_SUMMARY: UsageDailyReport['summary'] = {
  totalRequests: 0,
  totalTokens: 0,
  promptTokens: 0,
  completionTokens: 0,
  errorRate: 0,
  p95LatencyMs: null,
};

export function createEmptyUsageDailyReport(date: string): UsageDailyReport {
  return {
    date,
    summary: { ...ZERO_REPORT_SUMMARY },
    byProvider: {},
    topModels: [],
  };
}

export async function getUsageDailyReportsWithGaps(from: string, to: string): Promise<{ reports: UsageDailyReport[]; timeline: UsageDailyReport[] }> {
  const dates = enumerateDateKeys(from, to);
  const reports = await getUsageDailyReports(from, to);
  const byDate = new Map(reports.map((report) => [report.date, report]));
  return {
    reports,
    timeline: dates.map((date) => byDate.get(date) ?? createEmptyUsageDailyReport(date)),
  };
}

export function reportsToTrend(reports: UsageDailyReport[]): TrendPoint[] {
  return reports.map((r) => ({
    date: r.date,
    requests: r.summary.totalRequests,
    promptTokens: r.summary.promptTokens,
    completionTokens: r.summary.completionTokens,
    totalTokens: r.summary.totalTokens,
  }));
}

export const __usageReportStoreForTests = {
  reset(): void { _kv = null; },
};
