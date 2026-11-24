import type { ProviderConfig } from '@/lib/providers/types';

export type CcSwitchApp = 'claude' | 'claude-desktop' | 'codex' | 'hermes' | 'openclaw';

export const CC_SWITCH_APPS: Array<{ id: CcSwitchApp; labelZh: string; labelEn: string }> = [
  { id: 'claude-desktop', labelZh: 'Claude App', labelEn: 'Claude App' },
  { id: 'claude', labelZh: 'Claude CLI', labelEn: 'Claude CLI' },
  { id: 'codex', labelZh: 'Codex App / CLI', labelEn: 'Codex App / CLI' },
  { id: 'hermes', labelZh: 'Hermes', labelEn: 'Hermes' },
  { id: 'openclaw', labelZh: 'OpenClaw', labelEn: 'OpenClaw' },
];

export interface CcSwitchProviderLink {
  providerId: string;
  providerName: string;
  app: CcSwitchApp;
  name: string;
  endpoint: string;
  model?: string;
  apiKey: string;
  keyHash?: string;
  url: string;
  config: Record<string, unknown>;
}

export interface CcSwitchExportPayload {
  version: 1;
  format: 'cc-switch';
  exportedAt: string;
  mode: 'relay' | 'provider' | 'providers';
  links: CcSwitchProviderLink[];
}

interface BuildLinkOptions {
  providerId: string;
  providerName: string;
  app: CcSwitchApp;
  endpoint: string;
  apiKey: string;
  model?: string;
  keyHash?: string;
}

interface BuildCcSwitchExportOptions {
  mode: 'relay' | 'provider' | 'providers';
  app?: CcSwitchApp;
  relayBaseUrl: string;
  relayApiKey: string;
  providers: Record<string, ProviderConfig>;
  providerKeys: Record<string, string[]>;
  keyHashes?: Record<string, string[]>;
  providerId?: string;
  keyHash?: string;
  exportedAt?: string;
}

export function isCcSwitchApp(value: string | null | undefined): value is CcSwitchApp {
  return value === 'claude'
    || value === 'claude-desktop'
    || value === 'codex'
    || value === 'hermes'
    || value === 'openclaw';
}

function pickDefaultModel(provider?: ProviderConfig): string | undefined {
  if (!provider) return undefined;
  return provider.models?.find((model) => model.id)?.id || provider.modelPrefixes[0];
}

function fallbackModelForApp(app: CcSwitchApp): string {
  return app === 'claude' || app === 'claude-desktop'
    ? 'claude-sonnet-5-5'
    : 'gpt-6.2-sol';
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isClaudeApp(app: CcSwitchApp): boolean {
  return app === 'claude' || app === 'claude-desktop';
}

/**
 * Shape an exported base URL for the target client.
 *
 * Clients disagree on who owns the version prefix:
 *  - Claude CLI / app append `/v1/messages` to ANTHROPIC_BASE_URL themselves, so
 *    the exported base must be a bare origin. A base that already carries `/v1`
 *    (e.g. the built-in anthropic registry entry, or a relay endpoint) would
 *    otherwise produce `/v1/v1/messages` → 404.
 *  - OpenAI-style clients (codex/hermes/openclaw) append `/chat/completions`, so
 *    the base must carry the version prefix.
 *
 * The two source modes differ in where the base starts: a relay base is a bare
 * origin (needs `/v1` added for OpenAI clients), while an upstream provider base
 * already carries its own version path (`/v1`, `/v1beta`, `/compatible-mode/v1`,
 * …) and must be left as-is.
 */
function endpointForApp(app: CcSwitchApp, base: string, source: 'relay' | 'upstream'): string {
  const trimmed = stripTrailingSlash(base);
  if (isClaudeApp(app)) {
    return trimmed.replace(/\/v1$/, '');
  }
  return source === 'relay' ? `${trimmed}/v1` : trimmed;
}

function base64Json(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64');
  }
  return btoa(unescape(encodeURIComponent(json)));
}

function createClaudeConfig(apiKey: string, endpoint: string, model?: string): Record<string, unknown> {
  const env: Record<string, string> = {
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_BASE_URL: endpoint,
  };
  if (model) {
    env.ANTHROPIC_MODEL = model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = model;
  }
  return { env };
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function createCodexConfig(name: string, apiKey: string, endpoint: string, model?: string): Record<string, unknown> {
  const providerName = 'custom';
  const lines = [
    `model_provider = "${providerName}"`,
    model ? `model = "${escapeTomlString(model)}"` : '',
    'disable_response_storage = true',
    '',
    `[model_providers.${providerName}]`,
    `name = "${escapeTomlString(name)}"`,
    `base_url = "${escapeTomlString(endpoint)}"`,
    `wire_api = "chat"`,
    'requires_openai_auth = true',
  ].filter(Boolean);

  return {
    auth: { OPENAI_API_KEY: apiKey },
    config: lines.join('\n'),
  };
}

function createHermesConfig(name: string, apiKey: string, endpoint: string, model?: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    name,
    base_url: endpoint,
    api_key: apiKey,
    api_mode: 'chat_completions',
  };
  if (model) config.models = [{ id: model, name: model }];
  return config;
}

function createOpenClawConfig(apiKey: string, endpoint: string, model?: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    baseUrl: endpoint,
    apiKey,
    api: 'openai-completions',
  };
  if (model) config.models = [{ id: model, name: model }];
  return config;
}

function createConfig(app: CcSwitchApp, name: string, apiKey: string, endpoint: string, model?: string): Record<string, unknown> {
  if (app === 'claude' || app === 'claude-desktop') {
    return createClaudeConfig(apiKey, endpoint, model);
  }
  if (app === 'hermes') {
    return createHermesConfig(name, apiKey, endpoint, model);
  }
  if (app === 'openclaw') {
    return createOpenClawConfig(apiKey, endpoint, model);
  }
  return createCodexConfig(name, apiKey, endpoint, model);
}

function buildDeepLink(params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `ccswitch://v1/import?${query.toString()}`;
}

export function buildCcSwitchLink(options: BuildLinkOptions): CcSwitchProviderLink {
  const endpoint = stripTrailingSlash(options.endpoint);
  const config = createConfig(options.app, options.providerName, options.apiKey, endpoint, options.model);
  const params: Record<string, string> = {
    resource: 'provider',
    app: options.app,
    name: options.providerName,
    endpoint,
    apiKey: options.apiKey,
    enabled: 'true',
    configFormat: 'json',
    config: base64Json(config),
  };
  if (options.model) {
    params.model = options.model;
    if (options.app === 'claude' || options.app === 'claude-desktop') {
      params.haikuModel = options.model;
      params.sonnetModel = options.model;
      params.opusModel = options.model;
    }
  }

  return {
    providerId: options.providerId,
    providerName: options.providerName,
    app: options.app,
    name: options.providerName,
    endpoint,
    model: options.model,
    apiKey: options.apiKey,
    keyHash: options.keyHash,
    url: buildDeepLink(params),
    config,
  };
}

function createPayload(mode: CcSwitchExportPayload['mode'], links: CcSwitchProviderLink[], exportedAt?: string): CcSwitchExportPayload {
  return {
    version: 1,
    format: 'cc-switch',
    exportedAt: exportedAt || new Date().toISOString(),
    mode,
    links,
  };
}

function appDefaultForProvider(provider: ProviderConfig): CcSwitchApp {
  return provider.headerFormat === 'anthropic' ? 'claude' : 'codex';
}

export function buildCcSwitchExport(options: BuildCcSwitchExportOptions): CcSwitchExportPayload {
  const relayEndpoint = stripTrailingSlash(options.relayBaseUrl);
  const links: CcSwitchProviderLink[] = [];

  if (options.mode === 'relay') {
    if (!options.app) throw new Error('app is required for relay export');
    const relayApiEndpoint = endpointForApp(options.app, relayEndpoint, 'relay');
    const providers = Object.values(options.providers);
    const model = options.app === 'claude' || options.app === 'claude-desktop'
      ? pickDefaultModel(providers.find((provider) => provider.headerFormat === 'anthropic') || providers[0])
      : pickDefaultModel(providers.find((provider) => provider.headerFormat !== 'anthropic') || providers[0]);
    const modelWithFallback = model || fallbackModelForApp(options.app);

    return createPayload('relay', [
      buildCcSwitchLink({
        providerId: 'ai-relay',
        providerName: 'AI Relay',
        app: options.app,
        endpoint: relayApiEndpoint,
        apiKey: options.relayApiKey,
        model: modelWithFallback,
      }),
    ], options.exportedAt);
  }

  if (options.mode === 'provider') {
    if (!options.providerId) throw new Error('providerId is required for provider export');
    const provider = options.providers[options.providerId];
    if (!provider) throw new Error(`Unknown provider: ${options.providerId}`);
    const keys = options.providerKeys[options.providerId] || [];
    if (keys.length === 0) return createPayload('provider', [], options.exportedAt);
    const hashes = options.keyHashes?.[options.providerId] || [];
    const keyIndex = options.keyHash ? hashes.indexOf(options.keyHash) : 0;
    if (options.keyHash && keyIndex < 0) throw new Error(`Unknown key hash for provider: ${options.providerId}`);
    const index = keyIndex >= 0 ? keyIndex : 0;
    const app = options.app || appDefaultForProvider(provider);
    const rawEndpoint = process.env[provider.envBaseUrlField || ''] || provider.baseUrl;
    const endpoint = endpointForApp(app, rawEndpoint, 'upstream');
    return createPayload('provider', [
      buildCcSwitchLink({
        providerId: options.providerId,
        providerName: provider.displayName,
        app,
        endpoint,
        apiKey: keys[index],
        keyHash: hashes[index],
        model: pickDefaultModel(provider),
      }),
    ], options.exportedAt);
  }

  for (const [providerId, provider] of Object.entries(options.providers)) {
    const keys = options.providerKeys[providerId] || [];
    if (keys.length === 0) continue;
    const hashes = options.keyHashes?.[providerId] || [];
    const app = options.app || appDefaultForProvider(provider);
    const rawEndpoint = process.env[provider.envBaseUrlField || ''] || provider.baseUrl;
    const endpoint = endpointForApp(app, rawEndpoint, 'upstream');
    links.push(buildCcSwitchLink({
      providerId,
      providerName: provider.displayName,
      app,
      endpoint,
      apiKey: keys[0],
      keyHash: hashes[0],
      model: pickDefaultModel(provider),
    }));
  }

  return createPayload('providers', links, options.exportedAt);
}
