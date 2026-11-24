// ============================================================
// AI API Relay — Web Search Types
// Shared types and unified error for web search engines.
// ============================================================

/** A single normalized web search result. */
export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  siteName?: string;
  datePublished?: string;
  score?: number;
}

/** Parameters passed to every engine client. */
export interface WebSearchParams {
  apiKey: string;
  query: string;
  count?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** Fetch implementation override (defaults to globalThis.fetch). */
  fetchImpl?: typeof fetch;
}

/** Parameters for the web-fetch endpoint. */
export interface WebFetchParams {
  apiKey: string;
  url: string;
  fetchImpl?: typeof fetch;
}

export interface WebFetchResult {
  url: string;
  title?: string;
  markdown: string;
}

/** Supported web search / fetch engine ids. */
export const WEB_SEARCH_ENGINES = ['tavily', 'exa', 'firecrawl', 'tinyfish'] as const;
export type WebSearchEngine = (typeof WEB_SEARCH_ENGINES)[number];

export function isWebSearchEngine(value: string): value is WebSearchEngine {
  return (WEB_SEARCH_ENGINES as readonly string[]).includes(value);
}

/** Upstream engine error; the route layer maps status codes without leaking user key errors. */
export class WebSearchProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string
  ) {
    super(message);
    this.name = 'WebSearchProviderError';
  }
}

/** Clamp result count into a safe range. */
export function clampCount(count: number | undefined, max = 10): number {
  if (!Number.isFinite(count)) return max;
  return Math.max(1, Math.min(max, Math.floor(count as number)));
}

/** Normalize a domain value (strip protocol/path/wildcard) for provider filters. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .replace(/^\*?\.?/, '')
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase();
}
