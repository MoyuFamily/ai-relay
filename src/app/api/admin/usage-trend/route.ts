// ============================================================
// AI API Relay — Admin Usage Trend API (/api/admin/usage-trend)
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { createUsageStorage } from '@/lib/usage/factory';
import { getUsageSamplingInfo } from '@/lib/usage/storage/kv-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;



/** Valid range options per granularity */
const VALID_RANGES: Record<string, string[]> = {
  day: ['7d', '30d'],
  week: ['4w', '12w'],
  month: ['6m', '12m'],
};

const DEFAULT_RANGES: Record<string, string> = {
  day: '7d',
  week: '4w',
  month: '6m',
};

/**
 * GET /api/admin/usage-trend?granularity=day|week|month&range=7d|30d|4w|12w|6m|12m
 *
 * Returns token consumption trend data at the requested granularity.
 */
export async function GET(request: NextRequest) {
  // Auth check
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;

  const usageStorage = await createUsageStorage();
  const { searchParams } = new URL(request.url);
  const granularity = (searchParams.get('granularity') || 'day') as 'day' | 'week' | 'month';

  if (!['day', 'week', 'month'].includes(granularity)) {
    return Response.json(
      { error: { message: 'Invalid granularity. Use day|week|month.', code: 400 } },
      { status: 400 }
    );
  }

  const rangeParam = searchParams.get('range') || DEFAULT_RANGES[granularity];
  const validRange = VALID_RANGES[granularity];
  const range = validRange.includes(rangeParam) ? rangeParam : DEFAULT_RANGES[granularity];

  const trend = await usageStorage.getUsageTrend(range, granularity);

  return Response.json({
    range,
    granularity,
    sampling: getUsageSamplingInfo(),
    ...trend,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    }
  });
}
