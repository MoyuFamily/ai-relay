// ============================================================
// AI API Relay — Web Search Dispatcher
// Routes /v1/tools/web-search to the configured engine.
// ============================================================

import { searchTavily } from './tavily';
import { searchExa } from './exa';
import { searchFirecrawl, fetchFirecrawl } from './firecrawl';
import { searchTinyFish, fetchTinyFish } from './tinyfish';
import { assertPublicHttpUrl, WebSearchProviderError, type WebFetchParams, type WebFetchResult, type WebSearchEngine, type WebSearchParams, type WebSearchResult } from './types';

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
 * (server-side) fetch/scrape API; those pass the target URL as a parameter to
 * the provider, which never receives our API key as a requests header bound
 * for the target. Tavily and Exa have no such API and are explicitly NOT
 * supported here: attaching the configured provider key to an arbitrary
 * user-supplied URL would leak the key and create an SSRF vector.
 */
export async function fetchWeb(engine: WebSearchEngine, params: WebFetchParams): Promise<WebFetchResult> {
  // Validate the target URL first, for every engine, before any network call.
  assertPublicHttpUrl(params.url);

  if (engine === 'firecrawl') return fetchFirecrawl(params);
  if (engine === 'tinyfish') return fetchTinyFish(params);

  throw new WebSearchProviderError(
    `Web fetch is not supported by the '${engine}' engine. Select 'firecrawl' or 'tinyfish' as the active engine to use /v1/tools/web-fetch.`,
    400,
    engine
  );
}
