// ============================================================
// AI API Relay — Web Search Engine Unit Tests
// Uses mock fetch; no real API keys required.
// ============================================================

import { describe, it, expect } from 'vitest';
import { searchWeb, fetchWeb } from './dispatch';
import { WebSearchProviderError, assertPublicHttpUrl, mapUpstreamStatus } from './types';

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('web search engines', () => {
  it('maps Tavily results', async () => {
    const results = await searchWeb('tavily', {
      apiKey: 'test',
      query: 'hello',
      fetchImpl: mockFetch({ results: [{ title: 'A', url: 'https://a.com', content: 'snippet' }] }),
    });
    expect(results).toEqual([{ title: 'A', url: 'https://a.com', snippet: 'snippet', datePublished: undefined, score: undefined }]);
  });

  it('maps Exa results', async () => {
    const results = await searchWeb('exa', {
      apiKey: 'test',
      query: 'hello',
      fetchImpl: mockFetch({ results: [{ title: 'B', url: 'https://b.com', text: 'body', score: 1 }] }),
    });
    expect(results[0].title).toBe('B');
    expect(results[0].score).toBe(1);
  });

  it('falls back to Exa highlights when text is empty', async () => {
    const results = await searchWeb('exa', {
      apiKey: 'test',
      query: 'hello',
      fetchImpl: mockFetch({ results: [{ title: 'H', url: 'https://h.com', text: '', highlights: ['one', 'two'] }] }),
    });
    expect(results[0].snippet).toBe('one\ntwo');
  });

  it('maps Firecrawl results (data.web)', async () => {
    const results = await searchWeb('firecrawl', {
      apiKey: 'test',
      query: 'hello',
      fetchImpl: mockFetch({ success: true, data: { web: [{ title: 'C', url: 'https://c.com', description: 'desc' }] } }),
    });
    expect(results[0].snippet).toBe('desc');
  });

  it('maps TinyFish results', async () => {
    const results = await searchWeb('tinyfish', {
      apiKey: 'test',
      query: 'hello',
      fetchImpl: mockFetch({ results: [{ title: 'D', url: 'https://d.com', snippet: 's', site_name: 'd.com' }] }),
    });
    expect(results[0].siteName).toBe('d.com');
  });

  it('throws WebSearchProviderError on upstream error', async () => {
    await expect(
      searchWeb('tavily', {
        apiKey: 'bad',
        query: 'x',
        fetchImpl: mockFetch({ error: 'Invalid key' }, 401),
      })
    ).rejects.toBeInstanceOf(WebSearchProviderError);
  });

  it('filters results without a URL', async () => {
    const results = await searchWeb('tavily', {
      apiKey: 'test',
      query: 'x',
      fetchImpl: mockFetch({ results: [{ title: 'no url' }, { url: 'https://ok.com', title: 'ok' }] }),
    });
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://ok.com');
  });
});

describe('assertPublicHttpUrl (SSRF guard)', () => {
  it('allows public http(s) URLs', () => {
    expect(() => assertPublicHttpUrl('https://example.com/a?q=1')).not.toThrow();
    expect(() => assertPublicHttpUrl('http://8.8.8.8/')).not.toThrow();
  });

  it.each([
    'http://localhost:3000/admin',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal/',
    'http://[::1]/',
    'http://user:pass@example.com/',
    'file:///etc/passwd',
  ])('blocks unsafe URL %s', (u) => {
    expect(() => assertPublicHttpUrl(u)).toThrow(WebSearchProviderError);
  });
});

describe('mapUpstreamStatus', () => {
  it('hides upstream auth failures and server errors as 502', () => {
    expect(mapUpstreamStatus(401)).toBe(502);
    expect(mapUpstreamStatus(403)).toBe(502);
    expect(mapUpstreamStatus(500)).toBe(502);
    expect(mapUpstreamStatus(503)).toBe(502);
  });

  it('preserves client-safe statuses and rate limiting', () => {
    expect(mapUpstreamStatus(429)).toBe(429);
    expect(mapUpstreamStatus(400)).toBe(400);
    expect(mapUpstreamStatus(404)).toBe(404);
  });
});

describe('fetchWeb safety', () => {
  it('does not attach the API key to a user URL for Tavily/Exa', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const trackingFetch = (async (url: string, init?: RequestInit) => {
      captured.push({ url, init });
      return { ok: true, status: 200, text: async () => '<html>ok</html>' } as Response;
    }) as unknown as typeof fetch;
    await expect(
      fetchWeb('tavily', { apiKey: 'SUPER_SECRET', url: 'https://example.com', fetchImpl: trackingFetch })
    ).rejects.toBeInstanceOf(WebSearchProviderError);
    expect(captured).toHaveLength(0);
  });

  it('rejects a private URL before any fetch', async () => {
    let called = false;
    const trackingFetch = (async () => {
      called = true;
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as unknown as typeof fetch;
    await expect(
      fetchWeb('firecrawl', { apiKey: 'k', url: 'http://127.0.0.1/', fetchImpl: trackingFetch })
    ).rejects.toBeInstanceOf(WebSearchProviderError);
    expect(called).toBe(false);
  });
});
