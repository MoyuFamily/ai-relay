// ============================================================
// AI API Relay — POST /v1/tools/web-search
// Web search tool for AI agents. Auth via RELAY_API_KEY (same as /v1/*).
// Engine + key are configured in Admin → Tools → Web Search.
// ============================================================

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/relay/auth';
import { resolveActiveWebSearch } from '@/lib/web-search/config';
import { searchWeb, WebSearchProviderError } from '@/lib/web-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SearchBody {
  query?: string;
  count?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
}

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return Response.json({ error: { message: 'Invalid JSON body.', code: 400 } }, { status: 400 });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return Response.json({ error: { message: '`query` is required.', code: 400 } }, { status: 400 });
  }

  const active = await resolveActiveWebSearch();
  if (!active) {
    return Response.json(
      { error: { message: 'Web search is not configured. Set an engine API key in Admin → Tools → Web Search.', code: 503, type: 'not_configured' } },
      { status: 503 }
    );
  }

  try {
    const results = await searchWeb(active.engine, {
      apiKey: active.apiKey,
      query,
      count: body.count,
      allowedDomains: body.allowed_domains,
      blockedDomains: body.blocked_domains,
    });
    return Response.json(
      {
        object: 'web_search',
        engine: active.engine,
        query,
        results,
        billing_units: 1,
        unit_price: active.pricePerRequest,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof WebSearchProviderError) {
      const status = err.status >= 500 ? 502 : err.status;
      return Response.json(
        { error: { message: `Web search upstream error: ${err.message}`, code: status, provider: err.provider, type: 'upstream_error' } },
        { status }
      );
    }
    const message = err instanceof Error ? err.message : 'Web search failed';
    return Response.json({ error: { message, code: 502, type: 'upstream_error' } }, { status: 502 });
  }
}
