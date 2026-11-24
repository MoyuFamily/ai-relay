// ============================================================
// AI API Relay — Firecrawl Web Search
// POST https://api.firecrawl.dev/v2/search  (Authorization: Bearer <key>)
// Free tier: 1,000 credits/month, ~2 credits/search (~500 searches).
// Also powers web-fetch via POST https://api.firecrawl.dev/v2/scrape
// ============================================================

import {
  clampCount,
  normalizeDomain,
  WebSearchProviderError,
  type WebFetchParams,
  type WebFetchResult,
  type WebSearchParams,
  type WebSearchResult,
} from './types';

interface FirecrawlWebResult {
  title?: string;
  description?: string;
  url?: string;
  markdown?: string;
}

interface FirecrawlResponse {
  success?: boolean;
  data?: { web?: FirecrawlWebResult[] };
  error?: string;
  message?: string;
}

export async function searchFirecrawl(params: WebSearchParams): Promise<WebSearchResult[]> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const body: Record<string, unknown> = {
    query: params.query,
    limit: clampCount(params.count),
    sources: ['web'],
  };
  if (params.allowedDomains?.length) {
    body.includeDomains = params.allowedDomains.map(normalizeDomain).filter(Boolean);
  } else if (params.blockedDomains?.length) {
    body.excludeDomains = params.blockedDomains.map(normalizeDomain).filter(Boolean);
  }

  const response = await fetchImpl('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json: FirecrawlResponse;
  try {
    json = JSON.parse(text) as FirecrawlResponse;
  } catch {
    throw new WebSearchProviderError(`Firecrawl returned non-JSON (HTTP ${response.status})`, response.status || 502, 'firecrawl');
  }
  if (!response.ok || json.success === false) {
    throw new WebSearchProviderError(json.error || json.message || `Firecrawl HTTP ${response.status}`, response.status, 'firecrawl');
  }

  return (json.data?.web ?? [])
    .filter((r) => typeof r.url === 'string' && r.url.trim())
    .map((r) => ({
      title: (r.title || r.url || '').trim(),
      url: (r.url || '').trim(),
      snippet: r.description?.trim() || undefined,
    }));
}

/** Fetch a URL and return cleaned Markdown (Firecrawl scrape). */
export async function fetchFirecrawl(params: WebFetchParams): Promise<WebFetchResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: params.url, formats: ['markdown'], onlyMainContent: true }),
  });

  const text = await response.text();
  let json: { success?: boolean; data?: { markdown?: string; metadata?: { title?: string } }; error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new WebSearchProviderError(`Firecrawl scrape returned non-JSON (HTTP ${response.status})`, response.status || 502, 'firecrawl');
  }
  if (!response.ok || json.success === false) {
    throw new WebSearchProviderError(json.error || `Firecrawl scrape HTTP ${response.status}`, response.status, 'firecrawl');
  }
  return {
    url: params.url,
    title: json.data?.metadata?.title,
    markdown: json.data?.markdown || '',
  };
}
