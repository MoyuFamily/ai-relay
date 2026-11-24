// ============================================================
// AI Relay — Admin Usage Report API
// GET /api/admin/usage-report?from=YYYY-MM-DD&to=YYYY-MM-DD
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getUsageDailyReportsWithGaps, reportsToTrend, enumerateDateKeys, createEmptyUsageDailyReport, type UsageDailyReport } from '@/lib/usage/daily-report-store';
import { getCFEnv, isCloudflareSync } from '@/lib/cf-env';
import { shouldUseSelfHostedPostgres } from '@/lib/config/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildReportsFromRelationalRows(
  dates: string[],
  rows: Array<Record<string, any>>
): { reports: UsageDailyReport[]; timeline: UsageDailyReport[] } {
  const byDate = new Map<string, { global: any; providers: Record<string, any> }>();
  for (const date of dates) byDate.set(date, { global: null, providers: {} });

  for (const row of rows) {
    const entry = byDate.get(String(row.date));
    if (!entry) continue;
    if (row.provider === '') {
      entry.global = row;
    } else {
      entry.providers[String(row.provider)] = row;
    }
  }

  const reports: UsageDailyReport[] = [];
  const timeline: UsageDailyReport[] = [];
  for (const date of dates) {
    const entry = byDate.get(date)!;
    if (entry.global) {
      const report: UsageDailyReport = {
        date,
        summary: {
          totalRequests: Number(entry.global.requests),
          totalTokens: Number(entry.global.tokens),
          promptTokens: Number(entry.global.prompt_tokens),
          completionTokens: Number(entry.global.completion_tokens),
          errorRate: 0,
          p95LatencyMs: null,
        },
        byProvider: Object.fromEntries(
          Object.entries(entry.providers).map(([p, r]: [string, any]) => [p, {
            requests: Number(r.requests),
            tokens: Number(r.tokens),
            promptTokens: Number(r.prompt_tokens),
            completionTokens: Number(r.completion_tokens),
          }])
        ),
        topModels: [],
      };
      reports.push(report);
      timeline.push(report);
    } else {
      timeline.push(createEmptyUsageDailyReport(date));
    }
  }

  return { reports, timeline };
}

function canQuerySelfHostedPostgres(): boolean {
  if (isCloudflareSync()) return false;
  return shouldUseSelfHostedPostgres();
}

export async function GET(request: NextRequest) {
  const auth = requireAdminAuth(request);
  if (auth) return auth;

  const url = new URL(request.url);
  const to = url.searchParams.get('to') || todayUtc();
  const from = url.searchParams.get('from') || to;

  try {
    const cfEnv = await getCFEnv();
    if (cfEnv?.DB) {
      const dates = enumerateDateKeys(from, to);
      const rows = await cfEnv.DB.prepare(
        `SELECT date, provider, requests, tokens, prompt_tokens, completion_tokens
         FROM daily_usage WHERE date >= ? AND date <= ? ORDER BY date ASC`
      ).bind(from, to).all();

      const { reports, timeline } = buildReportsFromRelationalRows(
        dates,
        (rows.results || []) as Array<Record<string, any>>
      );

      return Response.json({
        range: { from, to },
        reports,
        trend: reportsToTrend(timeline),
      }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }

    if (canQuerySelfHostedPostgres()) {
      const [{ getPostgresSql }, { ensureSelfHostedPostgresSchema }] = await Promise.all([
        import('@/lib/db/client'),
        import('@/lib/db/self-hosted-schema'),
      ]);
      const sql = getPostgresSql();
      await ensureSelfHostedPostgresSchema(sql);

      const dates = enumerateDateKeys(from, to);
      const rows = await sql<Array<Record<string, any>>>`
        SELECT date, provider, requests, tokens, prompt_tokens, completion_tokens
        FROM daily_usage
        WHERE date >= ${from} AND date <= ${to}
        ORDER BY date ASC
      `;

      const { reports, timeline } = buildReportsFromRelationalRows(dates, rows);
      return Response.json({
        range: { from, to },
        reports,
        trend: reportsToTrend(timeline),
      }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }

    const { reports, timeline } = await getUsageDailyReportsWithGaps(from, to);
    return Response.json({
      range: { from, to },
      reports,
      trend: reportsToTrend(timeline),
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : String(error), code: 500 } },
      { status: 500 }
    );
  }
}
