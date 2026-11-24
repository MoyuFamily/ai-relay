// ============================================================
// AI API Relay — TinyFish Search & Fetch
// GET  https://api.search.tinyfish.ai?q=...   (X-API-Key: <key>)
// POST https://api.fetch.tinyfish.ai          (X-API-Key: <key>)
// Free tier: Search 12,000/day (~360k/month), 30/min & 500/hour.
// ============================================================

import {
  clampCount,
  WebSearchProviderError,
  type WebFetchParams,
  type WebFetchResult,
  type WebSearchParams,
  type WebSearchResult,
} from './types';

interface TinyFishRawResult {
  position?: number;
  site_name?: string;
  title?: string;
  snippet?: string;
  url?: string;
}

interface TinyFishSearchResponse {
  results?: TinyFishRawResult[];
  error?: { code?: string; message?: string } | string;
  message?: string;
}

export async function searchTinyFish(params: WebSearchParams): Promise<WebSearchResult[]> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = new URL('https://api.search.tinyfish.ai');
  url.searchParams.set('q', params.query);
  url.searchParams.set('num_results', String(clampCount(params.count)));
  if (params.allowedDomains?.length) {
    url.searchParams.set('include_domains', params.allowedDomains.join(','));
  }

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': params.apiKey },
  });

  const text = await response.text();
  let json: TinyFishSearchResponse;
  try {
    json = JSON.parse(text) as TinyFishSearchResponse;
  } catch {
    throw new WebSearchProviderError(`TinyFish returned non-JSON (HTTP ${response.status})`, response.status || 502, 'tinyfish');
  }
  if (!response.ok) {
    const e = json.error;
    const msg = (typeof e === 'object' ? e?.message : e) || json.message || `TinyFish HTTP ${response.status}`;
    throw new WebSearchProviderError(msg, response.status, 'tinyfish');
  }

  return (json.results ?? [])
    .filter((r) => typeof r.url === 'string' && r.url.trim())
    .map((r) => ({
      title: (r.title || r.url || '').trim(),
      url: (r.url || '').trim(),
      snippet: r.snippet?.trim() || undefined,
      siteName: r.site_name?.trim() || undefined,
    }));
}

/** Fetch a URL and return extracted content (TinyFish Fetch API). */
export async function fetchTinyFish(params: WebFetchParams): Promise<WebFetchResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl('https://api.fetch.tinyfish.ai', {
    method: 'POST',
    headers: {
      'X-API-Key': params.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: params.url }),
  });

  const text = await response.text();
  let json: { markdown?: string; content?: string; text?: string; title?: string; error?: { message?: string } | string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new WebSearchProviderError(`TinyFish fetch returned non-JSON (HTTP ${response.status})`, response.status || 502, 'tinyfish');
  }
  if (!response.ok) {
    const e = json.error;
    const msg = (typeof e === 'object' ? e?.message : e) || `TinyFish fetch HTTP ${response.status}`;
    throw new WebSearchProviderError(msg, response.status, 'tinyfish');
  }

  return {
    url: params.url,
    title: json.title,
    markdown: json.markdown || json.content || json.text || '',
  };
}
