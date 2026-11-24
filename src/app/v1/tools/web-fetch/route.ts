// ============================================================
// AI API Relay — POST /v1/tools/web-fetch
// Fetch a URL to Markdown for AI agents. Auth via RELAY_API_KEY.
// Uses the active web search engine's fetch capability.
// ============================================================

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/relay/auth';
import { resolveActiveWebSearch } from '@/lib/web-search/config';
import { fetchWeb, WebSearchProviderError } from '@/lib/web-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FetchBody {
  url?: string;
}

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request);
  if (authErr) return authErr;

  let body: FetchBody;
  try {
    body = (await request.json()) as FetchBody;
  } catch {
    return Response.json({ error: { message: 'Invalid JSON body.', code: 400 } }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return Response.json({ error: { message: '`url` must be an http(s) URL.', code: 400 } }, { status: 400 });
  }

  const active = await resolveActiveWebSearch();
  if (!active) {
    return Response.json(
      { error: { message: 'Web fetch is not configured. Set an engine API key in Admin → Tools → Web Search.', code: 503, type: 'not_configured' } },
      { status: 503 }
    );
  }

  try {
    const result = await fetchWeb(active.engine, { apiKey: active.apiKey, url });
    return Response.json(
      { object: 'web_fetch', engine: active.engine, ...result, billing_units: 1, unit_price: active.pricePerRequest },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    if (err instanceof WebSearchProviderError) {
      const status = err.status >= 500 ? 502 : err.status;
      return Response.json(
        { error: { message: `Web fetch upstream error: ${err.message}`, code: status, provider: err.provider, type: 'upstream_error' } },
        { status }
      );
    }
    const message = err instanceof Error ? err.message : 'Web fetch failed';
    return Response.json({ error: { message, code: 502, type: 'upstream_error' } }, { status: 502 });
  }
}
