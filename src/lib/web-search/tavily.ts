// ============================================================
// AI API Relay — Tavily Web Search
// POST https://api.tavily.com/search  (Authorization: Bearer <key>)
// Free tier: 1,000 searches/month, 1 credit/search.
// ============================================================

import { clampCount, normalizeDomain, WebSearchProviderError, type WebSearchParams, type WebSearchResult } from './types';

interface TavilyRawResult {
  title?: string;
  url?: string;
  content?: string;
  published_date?: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyRawResult[];
  error?: string;
  message?: string;
  detail?: string | { error?: string };
}

export async function searchTavily(params: WebSearchParams): Promise<WebSearchResult[]> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: clampCount(params.count),
    search_depth: 'basic',
  };
  if (params.allowedDomains?.length) {
    body.include_domains = params.allowedDomains.map(normalizeDomain).filter(Boolean);
  } else if (params.blockedDomains?.length) {
    body.exclude_domains = params.blockedDomains.map(normalizeDomain).filter(Boolean);
  }

  const response = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json: TavilyResponse;
  try {
    json = JSON.parse(text) as TavilyResponse;
  } catch {
    throw new WebSearchProviderError(`Tavily returned non-JSON (HTTP ${response.status})`, response.status || 502, 'tavily');
  }
  if (!response.ok) {
    const msg = json.error || json.message || (typeof json.detail === 'string' ? json.detail : json.detail?.error) || `Tavily HTTP ${response.status}`;
    throw new WebSearchProviderError(msg, response.status, 'tavily');
  }

  return (json.results ?? [])
    .filter((r) => typeof r.url === 'string' && r.url.trim())
    .map((r) => ({
      title: (r.title || r.url || '').trim(),
      url: (r.url || '').trim(),
      snippet: r.content?.trim() || undefined,
      datePublished: r.published_date?.trim() || undefined,
      score: typeof r.score === 'number' ? r.score : undefined,
    }));
}
