// ============================================================
// AI API Relay — Admin Web Search Config API
// GET/PUT /api/admin/tools/web-search
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin/auth';
import {
  getWebSearchSettings,
  saveWebSearchSettings,
  listWebSearchEngineStatus,
  type WebSearchSettings,
} from '@/lib/web-search/config';
import { WEB_SEARCH_ENGINES } from '@/lib/web-search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET status (masks API keys) + engine catalog.
 * Use `?includeSecrets=1` to fetch keys for editing (admin-only).
 */
export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const includeSecrets = request.nextUrl.searchParams.get('includeSecrets') === '1';
  const settings = await getWebSearchSettings(true);
  const status = await listWebSearchEngineStatus();
  const catalog = WEB_SEARCH_ENGINES.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    configured: status.find((s) => s.id === id)?.configured ?? false,
    active: status.find((s) => s.id === id)?.active ?? false,
  }));

  const payload: Record<string, unknown> = {
    activeEngine: settings.activeEngine,
    defaultPrice: settings.defaultPrice,
    catalog,
  };
  if (includeSecrets) {
    payload.engines = settings.engines;
  } else {
    payload.engines = status.reduce((acc, s) => {
      acc[s.id] = { configured: s.configured, pricePerRequest: settings.engines[s.id]?.pricePerRequest };
      return acc;
    }, {} as Record<string, unknown>);
  }

  return Response.json(payload, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

/** PUT full settings. Body: { activeEngine, defaultPrice, engines: { id: { apiKey, pricePerRequest? } } }. */
export async function PUT(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: WebSearchSettings;
  try {
    body = (await request.json()) as WebSearchSettings;
  } catch {
    return Response.json({ error: { message: 'Invalid JSON body.', code: 400 } }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: { message: 'Body must be an object.', code: 400 } }, { status: 400 });
  }

  try {
    const saved = await saveWebSearchSettings(body);
    return Response.json(
      { success: true, activeEngine: saved.activeEngine, defaultPrice: saved.defaultPrice },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save web search settings';
    const status = /KV storage not configured/i.test(message) ? 503 : 500;
    return Response.json({ error: { message, code: status } }, { status });
  }
}
