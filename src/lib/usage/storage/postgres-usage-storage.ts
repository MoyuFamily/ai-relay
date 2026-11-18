// ============================================================
// AI API Relay — PostgreSQL Usage Storage (Self-Hosted Server)
// ============================================================
// Relational, multi-replica-safe UsageStorage backed by PostgreSQL.
// Auto-bootstraps tables via `ensureSelfHostedPostgresSchema` so
// `DATABASE_URL=postgres://...` works out of the box with zero manual DDL.

import type postgres from 'postgres';
import type {
  UsageStorage,
  UsageEvent,
  TrendPoint,
  ProviderTrendPoint,
  QuotaStatus,
} from '../sdk';
import type { DailyReportData } from '@/lib/webhooks/types';
import { ensureSelfHostedPostgresSchema } from '@/lib/db/self-hosted-schema';

function getBeijingDate(d: Date = new Date()): Date {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000);
}

function today(): string {
  return getBeijingDate().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return getBeijingDate().toISOString().slice(0, 7);
}

function dateRange(days: number): string[] {
  const dates: string[] = [];
  const nowBeijing = getBeijingDate();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(nowBeijing);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear =
    Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
  const weekNum = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonthLabel(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function aggregatePoints(points: TrendPoint[], labelFn: (date: string) => string): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>();
  for (const p of points) {
    const label = labelFn(p.date);
    const existing = buckets.get(label);
    if (existing) {
      existing.requests += p.requests;
      existing.promptTokens += p.promptTokens;
      existing.completionTokens += p.completionTokens;
      existing.totalTokens += p.totalTokens;
    } else {
      buckets.set(label, {
        date: label,
        requests: p.requests,
        promptTokens: p.promptTokens,
        completionTokens: p.completionTokens,
        totalTokens: p.totalTokens,
      });
    }
  }
  return Array.from(buckets.values());
}

function buildQuotaResult(
  dailyUsed: number,
  dailyLimit: number,
  monthlyUsed: number,
  monthlyLimit: number,
  isOverride: boolean
): QuotaStatus {
  if (dailyLimit > 0 && dailyUsed >= dailyLimit) {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(16, 0, 0, 0);
    if (now.getUTCHours() >= 16) midnight.setUTCDate(midnight.getUTCDate() + 1);
    const retryAfter = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
    return { allowed: false, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, retryAfter, isOverride };
  }
  if (monthlyLimit > 0 && monthlyUsed >= monthlyLimit) {
    const now = new Date();
    const nextMonth = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    nextMonth.setUTCHours(0, 0, 0, 0);
    nextMonth.setUTCDate(1);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const retryAfter = Math.ceil(
      (new Date(nextMonth.getTime() - 8 * 60 * 60 * 1000).getTime() - now.getTime()) / 1000
    );
    return { allowed: false, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, retryAfter, isOverride };
  }
  return { allowed: true, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride };
}

export class PostgresUsageStorage implements UsageStorage {
  // Write directly to Postgres so self-hosted users get real-time, exact metrics
  // without Upstash free-tier sampling tradeoffs.
  readonly shouldRecordDirect = true;

  constructor(private readonly sql: postgres.Sql) {}

  private async ready(): Promise<void> {
    await ensureSelfHostedPostgresSchema(this.sql);
  }

  private async upsertUsageRow(
    date: string,
    provider: string,
    requests: number,
    tokens: number,
    promptTokens: number,
    completionTokens: number
  ): Promise<void> {
    await this.sql`
      INSERT INTO daily_usage (date, provider, requests, tokens, prompt_tokens, completion_tokens)
      VALUES (${date}, ${provider}, ${requests}, ${tokens}, ${promptTokens}, ${completionTokens})
      ON CONFLICT (date, provider) DO UPDATE SET
        requests = daily_usage.requests + EXCLUDED.requests,
        tokens = daily_usage.tokens + EXCLUDED.tokens,
        prompt_tokens = daily_usage.prompt_tokens + EXCLUDED.prompt_tokens,
        completion_tokens = daily_usage.completion_tokens + EXCLUDED.completion_tokens
    `;
  }

  async record(event: UsageEvent): Promise<void> {
    try {
      await this.ready();
      const date = today();
      const tasks: Promise<unknown>[] = [
        this.upsertUsageRow(date, '', 1, event.totalTokens, event.promptTokens, event.completionTokens),
      ];
      if (event.provider) {
        tasks.push(
          this.upsertUsageRow(
            date,
            event.provider,
            1,
            event.totalTokens,
            event.promptTokens,
            event.completionTokens
          )
        );
      }
      if (event.apiKeyHash) {
        tasks.push(
          this.sql`
            INSERT INTO key_usage (key_hash, period, requests, tokens)
            VALUES (${event.apiKeyHash}, ${date}, 1, ${event.totalTokens}),
                   (${event.apiKeyHash}, 'total', 1, ${event.totalTokens})
            ON CONFLICT (key_hash, period) DO UPDATE SET
              requests = key_usage.requests + EXCLUDED.requests,
              tokens = key_usage.tokens + EXCLUDED.tokens
          `
        );
      }
      await Promise.all(tasks);
    } catch {
      // Non-critical — never break relay requests
    }
  }

  async recordDirect(
    event: UsageEvent,
    requestCount = 1,
    options: { includeGlobal?: boolean } = {}
  ): Promise<void> {
    try {
      await this.ready();
      const date = today();
      const includeGlobal = options.includeGlobal ?? true;
      const tasks: Promise<unknown>[] = [];
      if (includeGlobal) {
        tasks.push(
          this.upsertUsageRow(
            date,
            '',
            requestCount,
            event.totalTokens,
            event.promptTokens,
            event.completionTokens
          )
        );
      }
      if (event.provider) {
        tasks.push(
          this.upsertUsageRow(
            date,
            event.provider,
            requestCount,
            event.totalTokens,
            event.promptTokens,
            event.completionTokens
          )
        );
      }
      await Promise.all(tasks);
    } catch {
      // Non-critical
    }
  }

  async recordError(event: {
    provider: string;
    keyHash: string;
    statusCode: number;
    reason: string;
  }): Promise<void> {
    await this.recordErrorDirect({ ...event, count: 1 });
  }

  async recordErrorDirect(event: {
    provider: string;
    keyHash: string;
    statusCode: number;
    reason: string;
    count?: number;
  }): Promise<void> {
    try {
      await this.ready();
      const date = today();
      const count = event.count || 1;
      const status = String(event.statusCode);
      const reason = event.reason.slice(0, 200);

      const tasks: Promise<unknown>[] = [
        this.sql`
          INSERT INTO error_stats (date, provider, status_code, count, reason)
          VALUES (${date}, ${event.provider}, ${status}, ${count}, ${reason})
          ON CONFLICT (date, provider, status_code) DO UPDATE SET
            count = error_stats.count + EXCLUDED.count,
            reason = EXCLUDED.reason
        `,
      ];

      if (event.keyHash) {
        tasks.push(
          this.sql`
            INSERT INTO error_key_stats (date, key_hash, provider, status_code, count, reason)
            VALUES (${date}, ${event.keyHash}, ${event.provider}, ${status}, ${count}, ${reason})
            ON CONFLICT (date, key_hash, status_code) DO UPDATE SET
              provider = EXCLUDED.provider,
              count = error_key_stats.count + EXCLUDED.count,
              reason = EXCLUDED.reason
          `
        );
      }

      await Promise.all(tasks);
    } catch {
      // Non-critical
    }
  }

  async getKeyUsage(keyHash: string): Promise<{
    daily: { requests: number; tokens: number };
    total: { requests: number; tokens: number };
  } | null> {
    try {
      await this.ready();
      const date = today();
      const rows = await this.sql`
        SELECT period, requests, tokens FROM key_usage
        WHERE key_hash = ${keyHash} AND period IN (${date}, 'total')
      `;
      if (rows.length === 0) return null;
      let daily = { requests: 0, tokens: 0 };
      let total = { requests: 0, tokens: 0 };
      for (const r of rows) {
        if (r.period === 'total') {
          total = { requests: Number(r.requests || 0), tokens: Number(r.tokens || 0) };
        } else {
          daily = { requests: Number(r.requests || 0), tokens: Number(r.tokens || 0) };
        }
      }
      return { daily, total };
    } catch {
      return null;
    }
  }

  async getGlobalUsage(): Promise<{
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    providers: Record<
      string,
      { requests: number; tokens: number; promptTokens: number; completionTokens: number }
    >;
  } | null> {
    try {
      await this.ready();
      const rows = await this.sql`
        SELECT provider, requests, tokens, prompt_tokens, completion_tokens
        FROM daily_usage WHERE date = ${today()}
      `;
      if (rows.length === 0) return null;

      let requests = 0;
      let tokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      const providers: Record<
        string,
        { requests: number; tokens: number; promptTokens: number; completionTokens: number }
      > = {};

      for (const row of rows) {
        if (row.provider === '') {
          requests = Number(row.requests || 0);
          tokens = Number(row.tokens || 0);
          promptTokens = Number(row.prompt_tokens || 0);
          completionTokens = Number(row.completion_tokens || 0);
        } else {
          providers[String(row.provider)] = {
            requests: Number(row.requests || 0),
            tokens: Number(row.tokens || 0),
            promptTokens: Number(row.prompt_tokens || 0),
            completionTokens: Number(row.completion_tokens || 0),
          };
        }
      }
      return { requests, tokens, promptTokens, completionTokens, providers };
    } catch {
      return null;
    }
  }

  async getMonthlyUsage(): Promise<{
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
  } | null> {
    try {
      await this.ready();
      const nowBeijing = getBeijingDate();
      const dates = dateRange(nowBeijing.getUTCDate());
      const rows = await this.sql`
        SELECT
          COALESCE(SUM(requests), 0) AS requests,
          COALESCE(SUM(tokens), 0) AS tokens,
          COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) AS completion_tokens
        FROM daily_usage
        WHERE date >= ${dates[0]} AND date <= ${dates[dates.length - 1]} AND provider = ''
      `;
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        requests: Number(row.requests || 0),
        tokens: Number(row.tokens || 0),
        promptTokens: Number(row.prompt_tokens || 0),
        completionTokens: Number(row.completion_tokens || 0),
      };
    } catch {
      return null;
    }
  }

  async getUsageTrend(
    range: string,
    granularity: 'day' | 'week' | 'month' = 'day'
  ): Promise<{ global: TrendPoint[]; providers: ProviderTrendPoint[] }> {
    try {
      await this.ready();
      let days: number;
      if (granularity === 'day') days = range === '30d' ? 30 : 7;
      else if (granularity === 'week') days = range === '12w' ? 84 : 28;
      else days = range === '12m' ? 365 : 180;

      const dates = dateRange(days);
      const rows = await this.sql`
        SELECT date, provider, requests, tokens, prompt_tokens, completion_tokens
        FROM daily_usage
        WHERE date >= ${dates[0]} AND date <= ${dates[dates.length - 1]}
        ORDER BY date ASC
      `;

      const globalMap = new Map<string, TrendPoint>();
      const providerMap = new Map<string, Map<string, TrendPoint>>();
      for (const d of dates) {
        globalMap.set(d, {
          date: d,
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        });
      }

      for (const row of rows) {
        const d = String(row.date);
        const pt: TrendPoint = {
          date: d,
          requests: Number(row.requests || 0),
          promptTokens: Number(row.prompt_tokens || 0),
          completionTokens: Number(row.completion_tokens || 0),
          totalTokens: Number(row.tokens || 0),
        };
        if (row.provider === '') {
          globalMap.set(d, pt);
        } else {
          const pName = String(row.provider);
          if (!providerMap.has(pName)) {
            const m = new Map<string, TrendPoint>();
            for (const dd of dates) {
              m.set(dd, { date: dd, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
            }
            providerMap.set(pName, m);
          }
          providerMap.get(pName)!.set(d, pt);
        }
      }

      const globalPoints = Array.from(globalMap.values());
      const providerPoints: ProviderTrendPoint[] = [];
      for (const [provider, m] of providerMap) {
        const data = Array.from(m.values());
        if (data.some((p) => p.totalTokens > 0)) {
          providerPoints.push({ provider, data });
        }
      }

      if (granularity === 'day') {
        return { global: globalPoints, providers: providerPoints };
      }
      const labelFn = granularity === 'week' ? getWeekLabel : getMonthLabel;
      return {
        global: aggregatePoints(globalPoints, labelFn),
        providers: providerPoints
          .map((p) => ({ provider: p.provider, data: aggregatePoints(p.data, labelFn) }))
          .filter((p) => p.data.some((d) => d.totalTokens > 0)),
      };
    } catch {
      return { global: [], providers: [] };
    }
  }

  async checkQuota(reserve = false): Promise<QuotaStatus> {
    const date = today();
    const month = thisMonth();
    let dailyLimit = parseInt(process.env.RELAY_DAILY_LIMIT || '0', 10) || 0;
    let monthlyLimit = parseInt(process.env.RELAY_MONTHLY_LIMIT || '0', 10) || 0;
    let isOverride = false;

    try {
      const { getCustomQuota } = await import('@/lib/admin/admin-config');
      const customQuota = await getCustomQuota();
      if (customQuota) {
        dailyLimit = customQuota.dailyLimit || 0;
        monthlyLimit = customQuota.monthlyLimit || 0;
        isOverride = true;
      }
    } catch {
      // Fall back to env vars
    }

    if (!dailyLimit && !monthlyLimit) {
      return { allowed: true, dailyUsed: 0, dailyLimit, monthlyUsed: 0, monthlyLimit, isOverride };
    }

    try {
      await this.ready();
      const rows = await this.sql`
        SELECT period, period_type, requests FROM quota_counters
        WHERE (period = ${date} AND period_type = 'daily')
           OR (period = ${month} AND period_type = 'monthly')
      `;
      let dailyUsed = 0;
      let monthlyUsed = 0;
      for (const r of rows) {
        if (r.period_type === 'daily') dailyUsed = Number(r.requests || 0);
        if (r.period_type === 'monthly') monthlyUsed = Number(r.requests || 0);
      }

      if (!reserve) {
        return buildQuotaResult(dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride);
      }
      if ((dailyLimit > 0 && dailyUsed >= dailyLimit) || (monthlyLimit > 0 && monthlyUsed >= monthlyLimit)) {
        return buildQuotaResult(dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride);
      }

      const [nextDailyRows, nextMonthlyRows] = await Promise.all([
        this.sql`
          INSERT INTO quota_counters (period, period_type, requests)
          VALUES (${date}, 'daily', 1)
          ON CONFLICT (period, period_type) DO UPDATE SET requests = quota_counters.requests + 1
          RETURNING requests
        `,
        this.sql`
          INSERT INTO quota_counters (period, period_type, requests)
          VALUES (${month}, 'monthly', 1)
          ON CONFLICT (period, period_type) DO UPDATE SET requests = quota_counters.requests + 1
          RETURNING requests
        `,
      ]);

      dailyUsed = Number(nextDailyRows[0]?.requests ?? dailyUsed + 1);
      monthlyUsed = Number(nextMonthlyRows[0]?.requests ?? monthlyUsed + 1);
      return { allowed: true, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride };
    } catch {
      return { allowed: true, dailyUsed: 0, dailyLimit, monthlyUsed: 0, monthlyLimit, isOverride };
    }
  }

  async getErrorStats(): Promise<Record<string, Record<string, number>>> {
    try {
      await this.ready();
      const rows = await this.sql`
        SELECT provider, status_code, count FROM error_stats WHERE date = ${today()}
      `;
      const result: Record<string, Record<string, number>> = {};
      for (const row of rows) {
        const provider = String(row.provider);
        if (!result[provider]) result[provider] = {};
        result[provider][String(row.status_code)] = Number(row.count || 0);
      }
      return result;
    } catch {
      return {};
    }
  }

  async getKeyErrors(): Promise<
    Array<{ keyHash: string; errors: Record<string, { count: number; reason: string }> }>
  > {
    try {
      await this.ready();
      const rows = await this.sql`
        SELECT key_hash, status_code, count, reason
        FROM error_key_stats
        WHERE date = ${today()}
        ORDER BY key_hash ASC, status_code ASC
      `;
      const byKey = new Map<string, Record<string, { count: number; reason: string }>>();
      for (const row of rows) {
        const keyHash = String(row.key_hash || '');
        const statusCode = String(row.status_code || '');
        if (!keyHash || !statusCode) continue;
        const errors = byKey.get(keyHash) || {};
        errors[statusCode] = {
          count: Number(row.count || 0),
          reason: String(row.reason || ''),
        };
        byKey.set(keyHash, errors);
      }
      return Array.from(byKey.entries()).map(([keyHash, errors]) => ({ keyHash, errors }));
    } catch {
      return [];
    }
  }

  async getDailyReport(date: string): Promise<DailyReportData | null> {
    try {
      await this.ready();
      const rows = await this.sql`
        SELECT provider, requests, tokens, prompt_tokens, completion_tokens
        FROM daily_usage WHERE date = ${date}
      `;
      if (rows.length === 0) return null;

      let totalRequests = 0;
      let totalTokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      const providers: DailyReportData['providers'] = {};
      for (const row of rows) {
        if (row.provider === '') {
          totalRequests = Number(row.requests || 0);
          totalTokens = Number(row.tokens || 0);
          promptTokens = Number(row.prompt_tokens || 0);
          completionTokens = Number(row.completion_tokens || 0);
        } else {
          providers[String(row.provider)] = {
            requests: Number(row.requests || 0),
            tokens: Number(row.tokens || 0),
            promptTokens: Number(row.prompt_tokens || 0),
            completionTokens: Number(row.completion_tokens || 0),
          };
        }
      }
      if (totalRequests === 0) return null;

      const prevDate = new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000)
        .toISOString()
        .slice(0, 10);
      const prevRows = await this.sql`
        SELECT requests, tokens FROM daily_usage WHERE date = ${prevDate} AND provider = '' LIMIT 1
      `;
      const prev = prevRows[0];
      const yesterdayComparison =
        prev && Number(prev.requests) > 0
          ? {
              requestsChange:
                ((totalRequests - Number(prev.requests)) / Number(prev.requests)) * 100,
              tokensChange:
                Number(prev.tokens) > 0
                  ? ((totalTokens - Number(prev.tokens)) / Number(prev.tokens)) * 100
                  : 0,
            }
          : undefined;

      return {
        date,
        totalRequests,
        totalTokens,
        promptTokens,
        completionTokens,
        providers,
        topModels: [],
        yesterdayComparison,
      };
    } catch {
      return null;
    }
  }

  async clearKeyErrors(keyHash: string): Promise<void> {
    try {
      await this.ready();
      await this.sql`
        DELETE FROM error_key_stats WHERE date = ${today()} AND key_hash = ${keyHash}
      `;
    } catch {
      // Non-critical
    }
  }

  async cleanupExpired(): Promise<{ deletedRows: number }> {
    try {
      await this.ready();
      const now = Date.now();
      const ninetyDaysAgo = getBeijingDate(new Date(now - 90 * 86_400_000))
        .toISOString()
        .slice(0, 10);
      const thirtyDaysAgo = getBeijingDate(new Date(now - 30 * 86_400_000))
        .toISOString()
        .slice(0, 10);
      const sevenDaysAgo = getBeijingDate(new Date(now - 7 * 86_400_000))
        .toISOString()
        .slice(0, 10);
      const twoMonthsAgo = getBeijingDate(new Date(now - 62 * 86_400_000))
        .toISOString()
        .slice(0, 7);

      const results = await Promise.all([
        this.sql`DELETE FROM daily_usage WHERE date < ${ninetyDaysAgo}`,
        this.sql`DELETE FROM key_usage WHERE length(period) = 10 AND period < ${ninetyDaysAgo}`,
        this.sql`DELETE FROM error_stats WHERE date < ${thirtyDaysAgo}`,
        this.sql`DELETE FROM error_key_stats WHERE date < ${thirtyDaysAgo}`,
        this.sql`DELETE FROM quota_counters WHERE period_type = 'daily' AND period < ${sevenDaysAgo}`,
        this.sql`DELETE FROM quota_counters WHERE period_type = 'monthly' AND period < ${twoMonthsAgo}`,
        this.sql`DELETE FROM kv_store WHERE expires_at IS NOT NULL AND expires_at <= NOW()`,
      ]);

      const deletedRows = results.reduce((acc, r) => acc + Number(r.count || 0), 0);
      return { deletedRows };
    } catch {
      return { deletedRows: 0 };
    }
  }

  async flush(): Promise<void> {
    // Writes land directly in PostgreSQL.
  }
}
