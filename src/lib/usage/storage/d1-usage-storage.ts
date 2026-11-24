// ============================================================
// AI API Relay — D1-backed Usage Storage (Cloudflare Pages)
// ============================================================

import type { D1Database } from '@cloudflare/workers-types';
import type {
  UsageStorage,
  UsageEvent,
  TrendPoint,
  ProviderTrendPoint,
  QuotaStatus,
} from '../sdk';
import type { DailyReportData } from '@/lib/webhooks/types';

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
  const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
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
      buckets.set(label, { date: label, requests: p.requests, promptTokens: p.promptTokens, completionTokens: p.completionTokens, totalTokens: p.totalTokens });
    }
  }
  return Array.from(buckets.values());
}

function buildQuotaResult(
  dailyUsed: number, dailyLimit: number,
  monthlyUsed: number, monthlyLimit: number,
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
    const retryAfter = Math.ceil((new Date(nextMonth.getTime() - 8 * 60 * 60 * 1000).getTime() - now.getTime()) / 1000);
    return { allowed: false, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, retryAfter, isOverride };
  }
  return { allowed: true, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride };
}

export class D1UsageStorage implements UsageStorage {
  readonly shouldRecordDirect = true;

  constructor(private db: D1Database) {}

  async record(event: UsageEvent): Promise<void> {
    try {
      await this.upsertDailyUsage(today(), event.provider, 1, event.totalTokens, event.promptTokens, event.completionTokens);
    } catch {
      // Non-critical
    }
  }

  async recordDirect(event: UsageEvent, requestCount = 1, options: { includeGlobal?: boolean } = {}): Promise<void> {
    try {
      const date = today();
      const includeGlobal = options.includeGlobal ?? true;
      const stmts = [];
      if (includeGlobal) {
        stmts.push(this.buildUpsert(date, '', requestCount, event.totalTokens, event.promptTokens, event.completionTokens));
      }
      if (event.provider) {
        stmts.push(this.buildUpsert(date, event.provider, requestCount, event.totalTokens, event.promptTokens, event.completionTokens));
      }
      if (stmts.length > 0) await this.db.batch(stmts);
    } catch {
      // Non-critical
    }
  }

  async recordError(event: { provider: string; keyHash: string; statusCode: number; reason: string }): Promise<void> {
    try {
      const status = String(event.statusCode);
      const reason = event.reason.slice(0, 200);
      const stmts = [
        this.db.prepare(
          `INSERT INTO error_stats (date, provider, status_code, count, reason)
           VALUES (?, ?, ?, 1, ?)
           ON CONFLICT (date, provider, status_code) DO UPDATE SET
             count = count + 1, reason = excluded.reason`
        ).bind(today(), event.provider, status, reason),
      ];

      if (event.keyHash) {
        stmts.push(
          this.db.prepare(
            `INSERT INTO error_key_stats (date, key_hash, provider, status_code, count, reason)
             VALUES (?, ?, ?, ?, 1, ?)
             ON CONFLICT (date, key_hash, status_code) DO UPDATE SET
               provider = excluded.provider,
               count = count + 1,
               reason = excluded.reason`
          ).bind(today(), event.keyHash, event.provider, status, reason)
        );
      }

      await this.db.batch(stmts);
    } catch {
      // Non-critical
    }
  }

  async recordErrorDirect(event: { provider: string; keyHash: string; statusCode: number; reason: string; count?: number }): Promise<void> {
    try {
      const count = event.count || 1;
      const status = String(event.statusCode);
      const reason = event.reason.slice(0, 200);
      const stmts = [
        this.db.prepare(
          `INSERT INTO error_stats (date, provider, status_code, count, reason)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (date, provider, status_code) DO UPDATE SET
             count = count + excluded.count, reason = excluded.reason`
        ).bind(today(), event.provider, status, count, reason),
      ];

      if (event.keyHash) {
        stmts.push(
          this.db.prepare(
            `INSERT INTO error_key_stats (date, key_hash, provider, status_code, count, reason)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (date, key_hash, status_code) DO UPDATE SET
               provider = excluded.provider,
               count = count + excluded.count,
               reason = excluded.reason`
          ).bind(today(), event.keyHash, event.provider, status, count, reason)
        );
      }

      await this.db.batch(stmts);
    } catch {
      // Non-critical
    }
  }

  async getKeyUsage(_keyHash: string): Promise<{ daily: { requests: number; tokens: number }; total: { requests: number; tokens: number } } | null> {
    return null;
  }

  async getGlobalUsage(): Promise<{
    requests: number; tokens: number; promptTokens: number; completionTokens: number;
    providers: Record<string, { requests: number; tokens: number; promptTokens: number; completionTokens: number }>;
  } | null> {
    try {
      const rows = await this.db.prepare(
        `SELECT provider, requests, tokens, prompt_tokens, completion_tokens FROM daily_usage WHERE date = ?`
      ).bind(today()).all();

      if (!rows.results?.length) return null;

      let requests = 0, tokens = 0, promptTokens = 0, completionTokens = 0;
      const providers: Record<string, { requests: number; tokens: number; promptTokens: number; completionTokens: number }> = {};

      for (const row of rows.results as any[]) {
        if (row.provider === '') {
          requests = Number(row.requests); tokens = Number(row.tokens);
          promptTokens = Number(row.prompt_tokens); completionTokens = Number(row.completion_tokens);
        } else {
          providers[row.provider] = {
            requests: Number(row.requests), tokens: Number(row.tokens),
            promptTokens: Number(row.prompt_tokens), completionTokens: Number(row.completion_tokens),
          };
        }
      }
      return { requests, tokens, promptTokens, completionTokens, providers };
    } catch {
      return null;
    }
  }

  async getMonthlyUsage(): Promise<{ requests: number; tokens: number; promptTokens: number; completionTokens: number } | null> {
    try {
      const nowBeijing = getBeijingDate();
      const dates = dateRange(nowBeijing.getUTCDate());
      const row = await this.db.prepare(
        `SELECT SUM(requests) as requests, SUM(tokens) as tokens, SUM(prompt_tokens) as prompt_tokens, SUM(completion_tokens) as completion_tokens
         FROM daily_usage WHERE date >= ? AND date <= ? AND provider = ''`
      ).bind(dates[0], dates[dates.length - 1]).first();
      if (!row) return null;
      return {
        requests: Number((row as any).requests || 0), tokens: Number((row as any).tokens || 0),
        promptTokens: Number((row as any).prompt_tokens || 0), completionTokens: Number((row as any).completion_tokens || 0),
      };
    } catch {
      return null;
    }
  }

  async getUsageTrend(range: string, granularity: 'day' | 'week' | 'month' = 'day'): Promise<{ global: TrendPoint[]; providers: ProviderTrendPoint[] }> {
    try {
      let days: number;
      if (granularity === 'day') days = range === '30d' ? 30 : 7;
      else if (granularity === 'week') days = range === '12w' ? 84 : 28;
      else days = range === '12m' ? 365 : 180;

      const dates = dateRange(days);
      const rows = await this.db.prepare(
        `SELECT date, provider, requests, tokens, prompt_tokens, completion_tokens
         FROM daily_usage WHERE date >= ? AND date <= ? ORDER BY date ASC`
      ).bind(dates[0], dates[dates.length - 1]).all();

      const globalMap = new Map<string, TrendPoint>();
      const providerMap = new Map<string, Map<string, TrendPoint>>();
      for (const d of dates) globalMap.set(d, { date: d, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });

      for (const row of (rows.results || []) as any[]) {
        const d = row.date as string;
        const pt: TrendPoint = { date: d, requests: Number(row.requests), promptTokens: Number(row.prompt_tokens), completionTokens: Number(row.completion_tokens), totalTokens: Number(row.tokens) };
        if (row.provider === '') {
          globalMap.set(d, pt);
        } else {
          if (!providerMap.has(row.provider)) {
            const m = new Map<string, TrendPoint>();
            for (const dd of dates) m.set(dd, { date: dd, requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 });
            providerMap.set(row.provider, m);
          }
          providerMap.get(row.provider)!.set(d, pt);
        }
      }

      const globalPoints = Array.from(globalMap.values());
      const providerPoints: ProviderTrendPoint[] = [];
      for (const [provider, m] of providerMap) {
        const data = Array.from(m.values());
        if (data.some(p => p.totalTokens > 0)) providerPoints.push({ provider, data });
      }

      if (granularity === 'day') return { global: globalPoints, providers: providerPoints };
      const labelFn = granularity === 'week' ? getWeekLabel : getMonthLabel;
      return {
        global: aggregatePoints(globalPoints, labelFn),
        providers: providerPoints.map(p => ({ provider: p.provider, data: aggregatePoints(p.data, labelFn) })).filter(p => p.data.some(d => d.totalTokens > 0)),
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
    } catch { /* ignore */ }

    if (!dailyLimit && !monthlyLimit) {
      return { allowed: true, dailyUsed: 0, dailyLimit, monthlyUsed: 0, monthlyLimit, isOverride };
    }

    try {
      const [dailyRow, monthlyRow] = await this.db.batch([
        this.db.prepare('SELECT requests FROM quota_counters WHERE period = ? AND period_type = ?').bind(date, 'daily'),
        this.db.prepare('SELECT requests FROM quota_counters WHERE period = ? AND period_type = ?').bind(month, 'monthly'),
      ]);
      let dailyUsed = Number((dailyRow.results?.[0] as any)?.requests || 0);
      let monthlyUsed = Number((monthlyRow.results?.[0] as any)?.requests || 0);

      if (!reserve) return buildQuotaResult(dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride);
      if (dailyLimit > 0 && dailyUsed >= dailyLimit) return buildQuotaResult(dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride);
      if (monthlyLimit > 0 && monthlyUsed >= monthlyLimit) return buildQuotaResult(dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride);

      const [newDaily, newMonthly] = await this.db.batch([
        this.db.prepare(
          `INSERT INTO quota_counters (period, period_type, requests) VALUES (?, 'daily', 1)
           ON CONFLICT (period, period_type) DO UPDATE SET requests = requests + 1 RETURNING requests`
        ).bind(date),
        this.db.prepare(
          `INSERT INTO quota_counters (period, period_type, requests) VALUES (?, 'monthly', 1)
           ON CONFLICT (period, period_type) DO UPDATE SET requests = requests + 1 RETURNING requests`
        ).bind(month),
      ]);
      dailyUsed = Number((newDaily.results?.[0] as any)?.requests || dailyUsed + 1);
      monthlyUsed = Number((newMonthly.results?.[0] as any)?.requests || monthlyUsed + 1);
      return { allowed: true, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride };
    } catch {
      return { allowed: true, dailyUsed: 0, dailyLimit, monthlyUsed: 0, monthlyLimit, isOverride };
    }
  }

  async getErrorStats(): Promise<Record<string, Record<string, number>>> {
    try {
      const rows = await this.db.prepare(
        `SELECT provider, status_code, count FROM error_stats WHERE date = ?`
      ).bind(today()).all();
      const result: Record<string, Record<string, number>> = {};
      for (const row of (rows.results || []) as any[]) {
        if (!result[row.provider]) result[row.provider] = {};
        result[row.provider][row.status_code] = Number(row.count);
      }
      return result;
    } catch {
      return {};
    }
  }

  async getKeyErrors(): Promise<Array<{ keyHash: string; errors: Record<string, { count: number; reason: string }> }>> {
    try {
      const rows = await this.db.prepare(
        `SELECT key_hash, status_code, count, reason
         FROM error_key_stats
         WHERE date = ?
         ORDER BY key_hash ASC, status_code ASC`
      ).bind(today()).all();

      const byKey = new Map<string, Record<string, { count: number; reason: string }>>();
      for (const row of (rows.results || []) as any[]) {
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
      const rows = await this.db.prepare(
        `SELECT provider, requests, tokens, prompt_tokens, completion_tokens FROM daily_usage WHERE date = ?`
      ).bind(date).all();
      if (!rows.results?.length) return null;

      let totalRequests = 0, totalTokens = 0, promptTokens = 0, completionTokens = 0;
      const providers: DailyReportData['providers'] = {};
      for (const row of rows.results as any[]) {
        if (row.provider === '') {
          totalRequests = Number(row.requests); totalTokens = Number(row.tokens);
          promptTokens = Number(row.prompt_tokens); completionTokens = Number(row.completion_tokens);
        } else {
          providers[row.provider] = { requests: Number(row.requests), tokens: Number(row.tokens), promptTokens: Number(row.prompt_tokens), completionTokens: Number(row.completion_tokens) };
        }
      }
      if (totalRequests === 0) return null;

      const prevDate = new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      const prevRow = await this.db.prepare(
        `SELECT requests, tokens FROM daily_usage WHERE date = ? AND provider = ''`
      ).bind(prevDate).first();
      const yesterdayComparison = prevRow && Number((prevRow as any).requests) > 0 ? {
        requestsChange: ((totalRequests - Number((prevRow as any).requests)) / Number((prevRow as any).requests)) * 100,
        tokensChange: ((totalTokens - Number((prevRow as any).tokens)) / Number((prevRow as any).tokens)) * 100,
      } : undefined;

      return { date, totalRequests, totalTokens, promptTokens, completionTokens, providers, topModels: [], yesterdayComparison };
    } catch {
      return null;
    }
  }

  async clearKeyErrors(keyHash: string): Promise<void> {
    try {
      await this.db.prepare(
        `DELETE FROM error_key_stats WHERE date = ? AND key_hash = ?`
      ).bind(today(), keyHash).run();
    } catch {
      // Non-critical
    }
  }

  /**
   * Prune expired quota counters (>2 days daily, >2 months monthly) and
   * stale error rows (>31 days) in D1 so tables stay bounded on Cloudflare Pages.
   */
  async cleanupExpired(): Promise<{ deletedRows: number }> {
    try {
      const nowBeijing = getBeijingDate();
      const cutoffDailyQuota = new Date(nowBeijing.getTime() - 2 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const cutoffMonthlyDate = new Date(nowBeijing);
      cutoffMonthlyDate.setUTCDate(1);
      cutoffMonthlyDate.setUTCMonth(cutoffMonthlyDate.getUTCMonth() - 2);
      const cutoffMonthlyQuota = cutoffMonthlyDate.toISOString().slice(0, 7);
      const cutoffErrors = new Date(nowBeijing.getTime() - 31 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const results = await this.db.batch([
        this.db
          .prepare(
            `DELETE FROM quota_counters
             WHERE (period_type = 'daily' AND period < ?)
                OR (period_type = 'monthly' AND period < ?)`
          )
          .bind(cutoffDailyQuota, cutoffMonthlyQuota),
        this.db.prepare('DELETE FROM error_stats WHERE date < ?').bind(cutoffErrors),
        this.db.prepare('DELETE FROM error_key_stats WHERE date < ?').bind(cutoffErrors),
      ]);

      const deletedRows = results.reduce(
        (sum, r) => sum + Number((r as any)?.meta?.changes ?? 0),
        0
      );
      return { deletedRows };
    } catch {
      return { deletedRows: 0 };
    }
  }

  async flush(): Promise<void> { /* no-op */ }

  private buildUpsert(date: string, provider: string, requests: number, tokens: number, promptTokens: number, completionTokens: number) {
    return this.db.prepare(
      `INSERT INTO daily_usage (date, provider, requests, tokens, prompt_tokens, completion_tokens)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (date, provider) DO UPDATE SET
         requests = requests + excluded.requests,
         tokens = tokens + excluded.tokens,
         prompt_tokens = prompt_tokens + excluded.prompt_tokens,
         completion_tokens = completion_tokens + excluded.completion_tokens`
    ).bind(date, provider, requests, tokens, promptTokens, completionTokens);
  }

  private async upsertDailyUsage(date: string, provider: string, requests: number, tokens: number, promptTokens: number, completionTokens: number): Promise<void> {
    const stmts = [this.buildUpsert(date, '', requests, tokens, promptTokens, completionTokens)];
    if (provider) stmts.push(this.buildUpsert(date, provider, requests, tokens, promptTokens, completionTokens));
    await this.db.batch(stmts);
  }
}
