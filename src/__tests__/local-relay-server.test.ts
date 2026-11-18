import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalServer, type LocalServer } from '../../cli/local/server';
import { InlineConfigSource } from '../../cli/lib/config-source';
import { resolveConfigSource } from '../../cli/lib/config-resolver';
import { __resetDefaultConfigStore } from '@/lib/config-store';

describe('CLI Local Relay HTTP Server & Config Resolver', () => {
  let localServer: LocalServer | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetDefaultConfigStore();
  });

  afterEach(async () => {
    if (localServer) {
      await localServer.stop();
      localServer = null;
    }
    __resetDefaultConfigStore();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('preserves provider underscore IDs and /v1 base URLs when resolving inline env keys', async () => {
    const source = resolveConfigSource({
      env: {
        OPENAI_KEYS: 'sk-openai-inline',
        XIAOMI_CODING_KEYS: 'sk-mimo-coding',
      } as any,
    });
    expect(source).not.toBeNull();
    const snap = await source!.load();

    expect(snap.providers.openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(snap.providers.xiaomi_coding).toBeDefined();
    expect(snap.providers.xiaomi_coding.baseUrl).toBe('https://token-plan-cn.xiaomimimo.com/v1');
    expect(snap.providerKeys.xiaomi_coding).toEqual(['sk-mimo-coding']);
  });

  it('serves /health, /v1/models, and relays /v1/chat/completions end-to-end on ephemeral loopback port', async () => {
    const upstreamCalls: string[] = [];
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('http://127.0.0.1:')) {
        return realFetch(input, init);
      }
      upstreamCalls.push(url);
      return new Response(
        JSON.stringify({
          id: 'chatcmpl_local_1',
          object: 'chat.completion',
          created: 1700000000,
          model: 'gpt-5.4-mini',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'pong from local relay' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 4, total_tokens: 8 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const configSource = new InlineConfigSource({
      version: 3,
      providers: {
        openai: {
          name: 'openai',
          displayName: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          headerFormat: 'openai',
          modelPrefixes: ['gpt-'],
          envKeyField: 'OPENAI_KEYS',
          apiKeys: ['sk-local-test-key'],
          models: [{ id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', contextWindow: 400000 }],
        },
      },
    });

    localServer = await startLocalServer({
      profile: {
        deviceName: 'test-mac',
        listenHost: '127.0.0.1',
        listenPort: 0, // OS-assigned ephemeral port
        configVersion: 3,
      },
      configSource,
    });

    const base = `http://127.0.0.1:${localServer.port}`;

    const healthRes = await realFetch(`${base}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson).toMatchObject({ status: 'ok', config_version: 3 });

    const modelsRes = await realFetch(`${base}/v1/models`);
    expect(modelsRes.status).toBe(200);
    const modelsJson = await modelsRes.json();
    expect(modelsJson.data.some((m: any) => m.id === 'gpt-5.4-mini')).toBe(true);

    const chatRes = await realFetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    expect(chatRes.status).toBe(200);
    expect(chatRes.headers.get('x-relay-provider')).toBe('openai');
    const chatJson = await chatRes.json();
    expect(chatJson.choices[0].message.content).toBe('pong from local relay');
    expect(upstreamCalls).toEqual(['https://api.openai.com/v1/chat/completions']);
  });
});
