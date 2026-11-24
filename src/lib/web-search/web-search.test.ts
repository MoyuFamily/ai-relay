// ============================================================
// AI API Relay — Web Search Engine Unit Tests
// Uses mock fetch; no real API keys required.
// ============================================================

import { describe, it, expect } from 'vitest';
import { searchWeb } from './dispatch';
import { WebSearchProviderError } from './types';

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
