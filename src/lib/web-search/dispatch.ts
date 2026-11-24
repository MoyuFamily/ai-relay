// ============================================================
// AI API Relay — Web Search Dispatcher
// Routes /v1/tools/web-search to the configured engine.
// ============================================================

import { searchTavily } from './tavily';
import { searchExa } from './exa';
import { searchFirecrawl, fetchFirecrawl } from './firecrawl';
import { searchTinyFish, fetchTinyFish } from './tinyfish';
import { WebSearchProviderError, type WebFetchParams, type WebFetchResult, type WebSearchEngine, type WebSearchParams, type WebSearchResult } from './types';

export async function searchWeb(engine: WebSearchEngine, params: WebSearchParams): Promise<WebSearchResult[]> {
  switch (engine) {
    case 'tavily':
      return searchTavily(params);
    case 'exa':
      return searchExa(params);
    case 'firecrawl':
      return searchFirecrawl(params);
    case 'tinyfish':
      return searchTinyFish(params);
    default: {
      const _exhaustive: never = engine;
      throw new WebSearchProviderError(`Web search engine not implemented: ${String(_exhaustive)}`, 503, String(engine));
    }
  }
}

/**
 * Fetch a URL to Markdown. Only Firecrawl and TinyFish expose a first-class
 * fetch/scrape API; Tavily and Exa fall back to a plain HTTP GET with the
 * same key (best-effort) so the endpoint stays usable across all engines.
 */
export async function fetchWeb(engine: WebSearchEngine, params: WebFetchParams): Promise<WebFetchResult> {
  if (engine === 'firecrawl') return fetchFirecrawl(params);
  if (engine === 'tinyfish') return fetchTinyFish(params);

  // Tavily / Exa: best-effort plain GET (their key is attached as a header).
  const fetchImpl = params.fetchImpl ?? fetch;
  let parsed: URL;
  try {
    parsed = new URL(params.url);
  } catch {
    throw new WebSearchProviderError('Invalid URL', 400, engine);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new WebSearchProviderError('Only http/https URLs are supported', 400, engine);
  }
  const response = await fetchImpl(parsed.toString(), {
    headers: engine === 'exa' ? { 'x-api-key': params.apiKey } : { Authorization: `Bearer ${params.apiKey}` },
  });
  if (!response.ok) {
    throw new WebSearchProviderError(`Fetch HTTP ${response.status}`, response.status, engine);
  }
  const html = await response.text();
  const markdown = stripHtmlToMarkdown(html);
  return { url: params.url, markdown };
}

/** Minimal HTML -> text fallback (no DOM dependency, Edge/Worker safe). */
function stripHtmlToMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
