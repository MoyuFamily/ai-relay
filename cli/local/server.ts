// ============================================================
// AI Relay CLI — Local HTTP Server
// ============================================================

import * as http from 'http';
import type { LocalProfile } from './profile';
import type { ConfigSource } from '../lib/config-source';
import type { ConfigSnapshot, ConfigStore, ModelAliasConfig } from '../../src/lib/config-store/types';
import type { ProviderConfig } from '../../src/lib/providers/types';
import type { PriorityRule } from '../../src/lib/admin/priority-rules-core';
import { setDefaultConfigStore } from '../../src/lib/config-store';
import { clearProvidersCache, getAllProviders } from '../../src/lib/providers';
import { relayRequest } from '../../src/lib/relay/relay';
import { collectPassthroughHeaders } from '../../src/lib/relay/passthrough';
import { transformAnthropicMessageToOpenAIChat, transformOpenAIToAnthropic } from '../../src/lib/relay/transform';
import { getKeyPoolStats, initAllKeyPools, validateAuth, validateRequestSize } from '../../src/lib/relay';
import { RelayError } from '../../src/lib/errors';
import { resolveConfigSource } from '../lib/config-resolver';
import pkg from '../../package.json';

export interface LocalServer {
  port: number;
  stop(): Promise<void>;
}

export interface StartServerOptions {
  profile: LocalProfile;
  configArg?: string;
  configSource?: ConfigSource;
}

class SnapshotConfigStore implements ConfigStore {
  constructor(private getSnapshot: () => ConfigSnapshot | null) {}

  async getProviders(): Promise<Record<string, ProviderConfig>> {
    return this.getSnapshot()?.providers || {};
  }

  async getProviderKeys(provider: string): Promise<string[] | null> {
    const keys = this.getSnapshot()?.providerKeys?.[provider];
    return keys && keys.length > 0 ? keys : null;
  }

  async getProviderKeysVersion(): Promise<number> {
    return this.getSnapshot()?.version || 0;
  }

  async getModelAliases(): Promise<ModelAliasConfig> {
    return this.getSnapshot()?.modelAliases || { aliases: {}, hidden: [] };
  }

  async getPriorityRules(): Promise<PriorityRule[]> {
    return this.getSnapshot()?.priorityRules || [];
  }

  async getFallbackChain(provider: string, staticFallbacks?: string[] | string): Promise<string[]> {
    const cloudChain = this.getSnapshot()?.fallbackChains?.[provider];
    if (cloudChain && cloudChain.length > 0) return cloudChain;
    if (!staticFallbacks) return [];
    return Array.isArray(staticFallbacks) ? staticFallbacks : [staticFallbacks];
  }

  async getConfigVersion(): Promise<number> {
    return this.getSnapshot()?.version || 0;
  }
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function readNodeRequestBody(req: http.IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxBytes) {
        req.destroy();
        reject(new RelayError(`Request body exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit.`, 'invalid_request_error', 400));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function toWebHeaders(rawHeaders: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (Array.isArray(v)) {
      headers.set(k, v.join(', '));
    } else if (typeof v === 'string') {
      headers.set(k, v);
    }
  }
  return headers;
}

export async function startLocalServer(options: StartServerOptions): Promise<LocalServer> {
  const { profile, configArg, configSource: explicitSource } = options;

  // Resolve config source
  const configSource = explicitSource || resolveConfigSource({
    configArg,
    profile,
    env: process.env,
  });

  if (!configSource) {
    throw new Error(
      'No configuration source found. Please:\n' +
      '  - Login: airelay login <cloud-url>\n' +
      '  - Use config file: airelay local:start --config ./config.json\n' +
      '  - Set environment: export RELAY_CONFIG_PATH=./config.json'
    );
  }

  console.log(`📋 Config source: ${configSource.describe()}`);

  let config: ConfigSnapshot | null = null;
  let configVersion = 0;
  const pendingUsageEvents: Array<Record<string, unknown>> = [];

  // Load initial config
  try {
    config = await configSource.load();
    configVersion = config.version;
    setDefaultConfigStore(new SnapshotConfigStore(() => config));
    clearProvidersCache();
    console.log(`✅ Config loaded (v${configVersion})`);
  } catch (err) {
    console.error('❌ Failed to load initial config:', (err as Error).message);
    throw err;
  }

  // Setup config watching/syncing if supported
  if (configSource.watch) {
    configSource.watch(async () => {
      try {
        const updated = await configSource.load();
        if (updated.version !== configVersion) {
          config = updated;
          configVersion = updated.version;
          clearProvidersCache();
          console.log(`✅ Config synced (v${configVersion})`);
        }
      } catch (err) {
        console.error('❌ Config sync failed:', (err as Error).message);
      }
    });
  }

  // Heartbeat & usage batch upload loop (only if connected to cloud)
  let heartbeatInterval: NodeJS.Timeout | undefined;
  if (profile.cloudUrl && profile.deviceToken) {
    heartbeatInterval = setInterval(async () => {
      const batch = pendingUsageEvents.splice(0, 200);
      try {
        const res = await fetch(`${profile.cloudUrl}/api/local/usage/batch`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${profile.deviceToken}`,
          },
          body: JSON.stringify({ events: batch }),
        });
        if (!res.ok && batch.length > 0) {
          pendingUsageEvents.unshift(...batch);
        }
      } catch (err) {
        if (batch.length > 0) {
          pendingUsageEvents.unshift(...batch);
        }
        console.error('❌ Heartbeat failed:', (err as Error).message);
      }
    }, 60_000);
    if (typeof heartbeatInterval.unref === 'function') {
      heartbeatInterval.unref();
    }
  }

  const requireAuth = !isLoopbackHost(profile.listenHost) || Boolean(process.env.RELAY_API_KEY?.trim());
  const isCloudConnected = Boolean(profile.cloudUrl && profile.deviceToken);
  const recordLocalUsage = (event: Record<string, unknown>) => {
    if (!isCloudConnected) return;
    if (pendingUsageEvents.length >= 2000) {
      pendingUsageEvents.shift();
    }
    pendingUsageEvents.push(event);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // CORS preflight support for local browser tools
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, Anthropic-Version, Anthropic-Beta, X-Request-ID');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: pkg.version, config_version: configVersion }));
      return;
    }

    const webHeaders = toWebHeaders(req.headers);
    if (requireAuth) {
      const fakeReq = new Request(url.toString(), { headers: webHeaders });
      if (!(await validateAuth(fakeReq))) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid API key.', type: 'authentication_error', code: 401 } }));
        return;
      }
    }

    if (url.pathname === '/v1/models' && req.method === 'GET') {
      try {
        const allProviders = await getAllProviders();
        await initAllKeyPools(allProviders);
        const poolStats = getKeyPoolStats();
        const hidden = new Set(config?.modelAliases?.hidden || []);
        const created = Math.floor(Date.now() / 1000);
        const data: Array<Record<string, unknown>> = [];

        for (const [providerId, pConfig] of Object.entries(allProviders)) {
          const hasKeys = (poolStats[providerId]?.available || 0) > 0;
          for (const model of pConfig.models || []) {
            if (hidden.has(model.id)) continue;
            data.push({
              id: model.id,
              object: 'model',
              created,
              owned_by: providerId,
              display_name: model.displayName,
              context_window: model.contextWindow,
              configured: hasKeys,
            });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: (err as Error).message, type: 'server_error', code: 500 } }));
      }
      return;
    }

    if (url.pathname.startsWith('/v1/models/') && req.method === 'GET') {
      try {
        const requestedModel = decodeURIComponent(url.pathname.slice('/v1/models/'.length));
        const allProviders = await getAllProviders();
        await initAllKeyPools(allProviders);
        const poolStats = getKeyPoolStats();
        const created = Math.floor(Date.now() / 1000);

        for (const [providerId, pConfig] of Object.entries(allProviders)) {
          const found = (pConfig.models || []).find((m) => m.id === requestedModel);
          if (found) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: found.id,
                object: 'model',
                created,
                owned_by: providerId,
                display_name: found.displayName,
                context_window: found.contextWindow,
                configured: (poolStats[providerId]?.available || 0) > 0,
              })
            );
            return;
          }
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Model '${requestedModel}' not found.`, type: 'not_found_error', code: 404 } }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: (err as Error).message, type: 'server_error', code: 500 } }));
      }
      return;
    }

    if (url.pathname === '/v1/messages/count_tokens' && req.method === 'POST') {
      try {
        const rawBody = await readNodeRequestBody(req);
        let body: any;
        try {
          body = JSON.parse(rawBody);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Invalid JSON in request body.' } }));
          return;
        }
        const inputTokens = Math.max(1, Math.ceil(JSON.stringify({
          system: body?.system ?? '',
          messages: body?.messages ?? [],
          tools: body?.tools ?? [],
        }).length / 4));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ input_tokens: inputTokens }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'server_error', message: (err as Error).message } }));
      }
      return;
    }

    if (
      req.method === 'POST' &&
      (url.pathname === '/v1/chat/completions' || url.pathname === '/v1/messages' || url.pathname === '/v1/responses')
    ) {
      const apiType =
        url.pathname === '/v1/messages'
          ? 'anthropicMessages'
          : url.pathname === '/v1/responses'
            ? 'responses'
            : 'chat';
      const startTime = Date.now();
      try {
        const rawBody = await readNodeRequestBody(req);
        const sizeCheck = validateRequestSize(rawBody.length);
        if (!sizeCheck.valid) {
          throw new RelayError(sizeCheck.error || 'Payload too large', 'invalid_request_error', 400);
        }

        let body: any;
        try {
          body = JSON.parse(rawBody);
        } catch {
          throw new RelayError('Invalid JSON in request body.', 'invalid_request_error', 400);
        }

        if (!body?.model || typeof body.model !== 'string') {
          throw new RelayError('Missing required field: model.', 'invalid_request_error', 400);
        }

        const userAgent = webHeaders.get('user-agent') || undefined;
        const passthroughHeaders = collectPassthroughHeaders(webHeaders);
        const { response, provider, apiKey } = await relayRequest(
          body,
          apiType,
          userAgent,
          rawBody,
          passthroughHeaders
        );
        const latencyMs = Date.now() - startTime;

        if (body.stream && response.ok && response.body) {
          res.writeHead(response.status, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Relay-Provider': provider.name,
            'X-Relay-Key': apiKey.hash,
          });
          const reader = response.body.getReader();
          let streamBytes = 0;
          req.on('close', () => {
            reader.cancel().catch(() => {});
          });
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              streamBytes += value.byteLength;
              res.write(Buffer.from(value));
            }
          }
          res.end();
          recordLocalUsage({
            provider: provider.name,
            model: body.model,
            apiKeyHash: apiKey.hash,
            statusCode: response.status,
            promptTokens: Math.max(1, Math.ceil(rawBody.length / 4)),
            completionTokens: Math.max(1, Math.round(streamBytes / 20)),
            latencyMs: Date.now() - startTime,
            isStream: true,
          });
          return;
        }

        let responseText = await response.text();
        if (response.ok) {
          try {
            const parsed = JSON.parse(responseText);
            if (apiType === 'chat' && provider.headerFormat === 'anthropic') {
              responseText = JSON.stringify(transformAnthropicMessageToOpenAIChat(parsed, body.model));
            } else if (apiType === 'anthropicMessages' && provider.headerFormat !== 'anthropic') {
              responseText = JSON.stringify(transformOpenAIToAnthropic(parsed, body.model));
            }
            recordLocalUsage({
              provider: provider.name,
              model: body.model,
              apiKeyHash: apiKey.hash,
              statusCode: response.status,
              promptTokens: Number(parsed?.usage?.prompt_tokens ?? parsed?.usage?.input_tokens ?? 0),
              completionTokens: Number(parsed?.usage?.completion_tokens ?? parsed?.usage?.output_tokens ?? 0),
              latencyMs,
              isStream: false,
            });
          } catch {
            // Non-JSON upstream body; forward as-is
          }
        }

        res.writeHead(response.status, {
          'Content-Type': response.headers.get('content-type') || 'application/json',
          'X-Relay-Provider': provider.name,
          'X-Relay-Key': apiKey.hash,
        });
        res.end(responseText);
      } catch (err) {
        if (err instanceof RelayError) {
          res.writeHead(err.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: err.message, type: err.type, code: err.status } }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Internal relay error.', type: 'server_error', code: 500 } }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Not Found', type: 'not_found_error', code: 404 } }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(profile.listenPort, profile.listenHost, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : profile.listenPort;
      resolve({
        port: actualPort,
        async stop() {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          configSource.dispose?.();
          setDefaultConfigStore(null);
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}
