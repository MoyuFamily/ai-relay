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

/**
 * Validate that a user-supplied URL is a public http(s) URL before it is
 * forwarded to any fetcher. Blocks credentials, localhost, private/link-local
 * IPv4 ranges, IPv6 loopback / link-local / unique-local, and cloud metadata
 * endpoints literal addresses. This is a first line of defence against SSRF;
 * it is intentionally dependency-free and Edge/Worker safe (no DNS lookup).
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebSearchProviderError('Invalid URL', 400, 'web-fetch');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebSearchProviderError('Only http/https URLs are supported', 400, 'web-fetch');
  }
  if (url.username || url.password) {
    throw new WebSearchProviderError('URL credentials are not allowed', 400, 'web-fetch');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Well-known local / metadata hostnames.
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'instance-data'
  ) {
    throw new WebSearchProviderError('Local or metadata hosts are not allowed', 400, 'web-fetch');
  }

  // IPv4 literals: block private, loopback, link-local, CGNAT, reserved ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    const blocked =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
    if (blocked) {
      throw new WebSearchProviderError('Private or reserved IP addresses are not allowed', 400, 'web-fetch');
    }
  }

  // IPv6 literals: block loopback, link-local, unique-local and v4-mapped loopback.
  if (
    host === '::1' ||
    host.startsWith('::ffff:127.') ||
    host.startsWith('fe80') ||
    /^f[cd][0-9a-f]{2}:/.test(host)
  ) {
    throw new WebSearchProviderError('Private or reserved IP addresses are not allowed', 400, 'web-fetch');
  }

  return url;
}

/**
 * Map an upstream error status to a client-facing status without leaking
 * whether the configured provider key is valid. 401/403 (bad upstream key)
 * and 5xx all collapse to 502; client-safe 4xx and 429 are preserved.
 */
export function mapUpstreamStatus(status: number): number {
  if (status === 429) return 429;
  if (status >= 400 && status < 500 && status !== 401 && status !== 403) return status;
  return 502;
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
