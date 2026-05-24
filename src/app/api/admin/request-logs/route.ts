// AI Relay v2.1 — Request logs API
import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { listRequestLogs } from '@/lib/observability/request-logs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;

  const url = new URL(request.url);
  const result = await listRequestLogs({
    provider: url.searchParams.get('provider') || undefined,
    status: (url.searchParams.get('status') as any) || 'all',
    traceId: url.searchParams.get('traceId') || undefined,
    limit: Number(url.searchParams.get('limit') || 50),
  });

  return Response.json({ status: 'ok', ...result, timestamp: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
