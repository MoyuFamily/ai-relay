import { describe, expect, it } from 'vitest';
import { buildCcSwitchExport } from '@/lib/admin/cc-switch-export';
import type { ProviderConfig } from '@/lib/providers/types';

const providers: Record<string, ProviderConfig> = {
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelPrefixes: ['gpt-'],
    headerFormat: 'openai',
    envKeyField: 'OPENAI_KEYS',
    models: [{ id: 'gpt-5.4', displayName: 'GPT-5.4', contextWindow: 1000 }],
  },
  anthropic: {
    name: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    modelPrefixes: ['claude-'],
    headerFormat: 'anthropic',
    envKeyField: 'CLAUDE_KEYS',
    models: [{ id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet', contextWindow: 1000 }],
  },
};

function linkParams(url: string) {
  return new URL(url).searchParams;
}

describe('CC Switch export', () => {
  it('exports a relay link for Claude apps with a bare-origin base (CLI appends /v1/messages)', () => {
    const payload = buildCcSwitchExport({
      mode: 'relay',
      app: 'claude-desktop',
      relayBaseUrl: 'https://relay.example.com/',
      relayApiKey: 'sk-relay',
      providers,
      providerKeys: {},
      exportedAt: '2026-06-08T00:00:00.000Z',
    });

    expect(payload.links).toHaveLength(1);
    expect(payload.links[0].app).toBe('claude-desktop');
    // Claude CLI/app append `/v1/messages` to ANTHROPIC_BASE_URL themselves, so
    // the exported base must stay a bare origin — a `/v1` here would produce
    // `/v1/v1/messages` → 404.
    expect(payload.links[0].endpoint).toBe('https://relay.example.com');

    const params = linkParams(payload.links[0].url);
    expect(params.get('resource')).toBe('provider');
    expect(params.get('app')).toBe('claude-desktop');
    expect(params.get('apiKey')).toBe('sk-relay');
    expect(params.get('model')).toBe('claude-sonnet-4-6');
  });

  it('exports a relay link for OpenAI apps with a /v1 base (client appends /chat/completions)', () => {
    const payload = buildCcSwitchExport({
      mode: 'relay',
      app: 'codex',
      relayBaseUrl: 'https://relay.example.com/',
      relayApiKey: 'sk-relay',
      providers,
      providerKeys: {},
      exportedAt: '2026-06-08T00:00:00.000Z',
    });

    expect(payload.links).toHaveLength(1);
    expect(payload.links[0].app).toBe('codex');
    // OpenAI-style clients append `/chat/completions`, so the base must carry
    // the version prefix.
    expect(payload.links[0].endpoint).toBe('https://relay.example.com/v1');
    expect(payload.links[0].model).toBe('gpt-5.4');
  });

  it('exports one keyed upstream provider by selected key hash', () => {
    const payload = buildCcSwitchExport({
      mode: 'provider',
      app: 'codex',
      providerId: 'openai',
      keyHash: 'hash-2',
      relayBaseUrl: 'https://relay.example.com',
      relayApiKey: 'sk-relay',
      providers,
      providerKeys: { openai: ['sk-openai-1', 'sk-openai-2'] },
      keyHashes: { openai: ['hash-1', 'hash-2'] },
      exportedAt: '2026-06-08T00:00:00.000Z',
    });

    expect(payload.links).toHaveLength(1);
    expect(payload.links[0]).toMatchObject({
      providerId: 'openai',
      app: 'codex',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'sk-openai-2',
      keyHash: 'hash-2',
      model: 'gpt-5.4',
    });

    const params = linkParams(payload.links[0].url);
    expect(params.get('name')).toBe('OpenAI');
    expect(params.get('endpoint')).toBe('https://api.openai.com/v1');
    expect(params.get('enabled')).toBe('true');
  });

  it('strips the version prefix from a built-in Claude provider base for Claude apps', () => {
    const payload = buildCcSwitchExport({
      mode: 'provider',
      app: 'claude',
      providerId: 'anthropic',
      relayBaseUrl: 'https://relay.example.com',
      relayApiKey: 'sk-relay',
      providers,
      providerKeys: { anthropic: ['sk-claude'] },
      keyHashes: { anthropic: ['hash-claude'] },
      exportedAt: '2026-06-08T00:00:00.000Z',
    });

    expect(payload.links).toHaveLength(1);
    // The built-in anthropic registry base is `https://api.anthropic.com/v1`,
    // but a Claude client appends `/v1/messages` itself — so the exported base
    // must be the bare origin to avoid `/v1/v1/messages`.
    expect(payload.links[0]).toMatchObject({
      providerId: 'anthropic',
      app: 'claude',
      endpoint: 'https://api.anthropic.com',
      apiKey: 'sk-claude',
    });
    expect(linkParams(payload.links[0].url).get('endpoint')).toBe('https://api.anthropic.com');
  });

  it('exports relay mode with a safe fallback model when no providers exist', () => {
    const payload = buildCcSwitchExport({
      mode: 'relay',
      app: 'codex',
      relayBaseUrl: 'https://relay.example.com',
      relayApiKey: 'sk-relay',
      providers: {},
      providerKeys: {},
      exportedAt: '2026-06-08T00:00:00.000Z',
    });

    expect(payload.links).toHaveLength(1);
    expect(payload.links[0]).toMatchObject({
      providerId: 'ai-relay',
      app: 'codex',
      model: 'gpt-6.2-sol',
    });
    expect(linkParams(payload.links[0].url).get('model')).toBe('gpt-6.2-sol');
  });

  it('keeps bulk provider export as a JSON-file payload', () => {
    const payload = buildCcSwitchExport({
      mode: 'providers',
      relayBaseUrl: 'https://relay.example.com',
      relayApiKey: 'sk-relay',
      providers,
      providerKeys: { openai: ['sk-openai'] },
      keyHashes: { openai: ['hash-openai'] },
      exportedAt: '2026-06-08T00:00:00.000Z',
    });

    expect(payload.links).toHaveLength(1);
    expect(payload.links[0].app).toBe('codex');
    expect(payload.links[0].keyHash).toBe('hash-openai');
  });
});
