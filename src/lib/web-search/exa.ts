// ============================================================
// AI API Relay — Exa Neural Web Search
// POST https://api.exa.ai/search  (x-api-key: <key>)
// Free tier: $10 credits/month (~2,500 searches, refreshed monthly).
// ============================================================

import { clampCount, normalizeDomain, WebSearchProviderError, type WebSearchParams, type WebSearchResult } from './types';

interface ExaRawResult {
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  publishedDate?: string;
}

interface ExaResponse {
  results?: ExaRawResult[];
  error?: string;
  message?: string;
}

export async function searchExa(params: WebSearchParams): Promise<WebSearchResult[]> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    query: params.query,
    type: 'auto',
    numResults: clampCount(params.count),
    contents: { highlights: true },
  };
  if (params.allowedDomains?.length) {
    body.includeDomains = params.allowedDomains.map(normalizeDomain).filter(Boolean);
  } else if (params.blockedDomains?.length) {
    body.excludeDomains = params.blockedDomains.map(normalizeDomain).filter(Boolean);
  }

  const response = await fetchImpl('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'x-api-key': params.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json: ExaResponse;
  try {
    json = JSON.parse(text) as ExaResponse;
  } catch {
    throw new WebSearchProviderError(`Exa returned non-JSON (HTTP ${response.status})`, response.status || 502, 'exa');
  }
  if (!response.ok) {
    throw new WebSearchProviderError(json.error || json.message || `Exa HTTP ${response.status}`, response.status, 'exa');
  }

  return (json.results ?? [])
    .filter((r) => typeof r.url === 'string' && r.url.trim())
    .map((r) => ({
      title: (r.title || r.url || '').trim(),
      url: (r.url || '').trim(),
      snippet: (typeof r.text === 'string' ? r.text : undefined)?.slice(0, 2000) || undefined,
      datePublished: r.publishedDate?.trim() || undefined,
      score: typeof r.score === 'number' ? r.score : undefined,
    }));
}
