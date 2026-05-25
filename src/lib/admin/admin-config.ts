// ============================================================
// AI API Relay — Admin Config Store (Vercel KV)
// ============================================================
// Runtime overrides for fallback chains and API keys.
// Falls back to source-code defaults when no KV override exists.

import { withTimeout } from '@/lib/utils/timeout';
import type { ProviderConfig } from '../providers/types';
import type { PriorityRule } from './priority-rules-core';
import { normalizePriorityRules } from './priority-rules-core';

let _kv: any = null;

interface ConfigCacheEntry {
  data: unknown;
  expiresAt: number;
}

const CONFIG_CACHE_TTL_MS = 60_000;
const configCache = new Map<string, ConfigCacheEntry>();

function getCached<T>(key: string): T | null {
  const entry = configCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  if (entry) configCache.delete(key);
  return null;
}

function getCachedEntry<T>(key: string): { hit: true; data: T } | { hit: false } {
  const entry = configCache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return { hit: true, data: entry.data as T };
  }
  if (entry) configCache.delete(key);
  return { hit: false };
}

function setCached(key: string, data: unknown, ttlMs = CONFIG_CACHE_TTL_MS): void {
  configCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function clearCache(prefix?: string): void {
  if (!prefix) {
    configCache.clear();
    return;
  }
  for (const key of configCache.keys()) {
    if (key.startsWith(prefix)) {
      configCache.delete(key);
    }
  }
}

export const __adminConfigCacheForTests = {
  clear(): void {
    clearCache();
  },
};

export function createMemoryMockKV() {
  const store = new Map<string, any>();
  const result: any = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async mget(...keysOrArray: Array<string | string[]>) {
      const keys = Array.isArray(keysOrArray[0]) ? keysOrArray[0] as string[] : keysOrArray as string[];
      return keys.map((key) => store.get(key) ?? null);
    },
    async set(key: string, value: any) {
      store.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },
    async hgetall(key: string) {
      const val = store.get(key);
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        return val;
      }
      return null;
    },
    async hset(key: string, dataOrField: any, value?: any) {
      let current = store.get(key);
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        current = {};
        store.set(key, current);
      }
      if (typeof dataOrField === 'object' && dataOrField !== null) {
        Object.assign(current, dataOrField);
      } else if (typeof dataOrField === 'string') {
        current[dataOrField] = value;
      }
      return 1;
    },
    async scan(cursor: number, options?: { match?: string; count?: number }) {
      const keys = Array.from(store.keys());
      const match = options?.match;
      let matched = keys;
      if (match) {
        const regexStr = '^' + match
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') + '$';
        const regex = new RegExp(regexStr);
        matched = keys.filter((k) => regex.test(k));
      }
      return [0, matched];
    },
    async hincrby(key: string, field: string, increment: number) {
      let current = store.get(key);
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        current = {};
        store.set(key, current);
      }
      const prev = Number(current[field] || 0);
      current[field] = prev + increment;
      return current[field];
    },
    async expire(key: string, seconds: number) {
      return 1;
    },
    async incr(key: string) {
      const prev = Number(store.get(key) || 0);
      const next = prev + 1;
      store.set(key, next);
      return next;
    },
    async incrby(key: string, increment: number) {
      const prev = Number(store.get(key) || 0);
      const next = prev + increment;
      store.set(key, next);
      return next;
    },
    async sadd(key: string, member: string) {
      let current = store.get(key);
      if (!(current instanceof Set)) {
        current = new Set();
        store.set(key, current);
      }
      const existed = current.has(member);
      current.add(member);
      return existed ? 0 : 1;
    },
    async smembers(key: string) {
      const current = store.get(key);
      if (current instanceof Set) {
        return Array.from(current);
      }
      return [];
    },
    async srem(key: string, member: string) {
      const current = store.get(key);
      if (current instanceof Set) {
        const existed = current.has(member);
        current.delete(member);
        return existed ? 1 : 0;
      }
      return 0;
    },
    pipeline() {
      const commands: Array<() => Promise<any>> = [];
      const proxy: any = new Proxy({}, {
        get(target, prop) {
          if (prop === 'exec') {
            return async () => {
              return Promise.all(commands.map((cmd) => cmd()));
            };
          }
          const method = result[prop];
          if (typeof method === 'function') {
            return (...args: any[]) => {
              commands.push(() => method(...args));
              return proxy;
            };
          }
          throw new Error(`Mock pipeline method not implemented: ${String(prop)}`);
        }
      });
      return proxy;
    }
  };
  return result;
}

async function getKV() {
  const g = global as any;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    if (_kv && !_kv._isMock) return _kv;
    try {
      const mod = await import('@vercel/kv');
      _kv = mod.kv || mod.createClient({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
      return _kv;
    } catch {
      return null;
    }
  }

  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    if (!g._mockKVInstance) {
      g._mockKVInstance = createMemoryMockKV();
      g._mockKVInstance._isMock = true;
    }
    _kv = g._mockKVInstance;
    return _kv;
  }

  return null;
}


// ── KV Key Prefixes ─────────────────────────────────────────
const PREFIX = {
  fallbacks: 'admin:fallbacks:',   // admin:fallbacks:{provider} → JSON string[]
  keys: 'admin:keys:',             // admin:keys:{provider} → JSON string[] (raw API keys)
  keyVersion: 'admin:keys:version:', // admin:keys:version:{provider} → monotonically increasing number
  quota: 'admin:quota',            // admin:quota → Hash { dailyLimit, monthlyLimit }
  modelAliases: 'relay:models:aliases', // relay:models:aliases → JSON { aliases, hidden }
  priorityRules: 'relay:priority:rules', // relay:priority:rules → JSON PriorityRule[]
} as const;

/**
 * Safely parses values retrieved from KV, handling both raw JSON strings
 * and automatically deserialized array values (which some KV clients return).
 */
function parseJsonOrArray(val: unknown): string[] | null {
  if (!val) return null;
  if (Array.isArray(val)) {
    return val.filter((item): item is string => typeof item === 'string');
  }
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      // ignore
    }
  }
  return null;
}

// ── Priority Rule Management ────────────────────────────────

interface PriorityRulesStore {
  version: 1;
  rules: PriorityRule[];
  updatedAt: number;
}

function parsePriorityRules(raw: unknown): PriorityRule[] {
  if (!raw) return [];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { rules?: unknown }).rules)) {
    return normalizePriorityRules((parsed as { rules: unknown }).rules);
  }
  return normalizePriorityRules(parsed);
}

export async function getPriorityRules(forceRefresh = false): Promise<PriorityRule[]> {
  const cacheKey = 'priorityRules';
  const cached = forceRefresh ? { hit: false as const } : getCachedEntry<PriorityRule[]>(cacheKey);
  if (cached.hit) return cached.data;

  try {
    const kv = await getKV();
    if (kv) {
      const raw = await withTimeout(
        kv.get(PREFIX.priorityRules),
        1000,
        null,
        'getPriorityRules'
      );
      const rules = parsePriorityRules(raw);
      setCached(cacheKey, rules, CONFIG_CACHE_TTL_MS);
      return rules;
    }
  } catch {
    // fall through to empty rules so relay keeps working when KV is unavailable
  }
  setCached(cacheKey, [], CONFIG_CACHE_TTL_MS);
  return [];
}

export async function savePriorityRules(rulesInput: unknown): Promise<PriorityRule[]> {
  const rules = normalizePriorityRules(rulesInput);
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot persist priority rules');
  }
  const store: PriorityRulesStore = { version: 1, rules, updatedAt: Date.now() };
  await kv.set(PREFIX.priorityRules, store);
  clearCache('priorityRules');
  return rules;
}


// ── Model Alias + Visibility Management ─────────────────────

export interface ModelAliasConfig {
  aliases: Record<string, string>;
  hidden: string[];
}

const MODEL_ALIAS_CACHE_TTL_MS = 5 * 60_000;

function parseModelAliasConfig(raw: unknown): ModelAliasConfig {
  if (!raw) return { aliases: {}, hidden: [] };
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { aliases: {}, hidden: [] };
  }
  const obj = parsed as Record<string, unknown>;
  const rawAliases = obj.aliases && typeof obj.aliases === 'object' && !Array.isArray(obj.aliases)
    ? obj.aliases as Record<string, unknown>
    : obj;
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(rawAliases)) {
    if (alias === 'hidden' || alias === 'aliases') continue;
    if (typeof target === 'string' && target.trim()) {
      aliases[alias.toLowerCase()] = target.trim();
    }
  }
  const hidden = Array.isArray(obj.hidden)
    ? Array.from(new Set(obj.hidden.filter((item): item is string => {
      return typeof item === 'string' && item.trim().length > 0;
    }).map((item) => item.trim())))
    : [];
  return { aliases, hidden };
}

export async function getModelAliasConfig(forceRefresh = false): Promise<ModelAliasConfig> {
  const cacheKey = 'modelAliases';
  const cached = forceRefresh ? { hit: false as const } : getCachedEntry<ModelAliasConfig>(cacheKey);
  if (cached.hit) return cached.data;

  try {
    const kv = await getKV();
    if (kv) {
      const raw = await withTimeout(
        kv.get(PREFIX.modelAliases),
        1000,
        null,
        'getModelAliasConfig'
      );
      const config = parseModelAliasConfig(raw);
      setCached(cacheKey, config, MODEL_ALIAS_CACHE_TTL_MS);
      return config;
    }
  } catch {
    // fall through to empty config so relay keeps working when KV is unavailable
  }
  const empty = { aliases: {}, hidden: [] };
  setCached(cacheKey, empty, MODEL_ALIAS_CACHE_TTL_MS);
  return empty;
}

export async function saveModelAliasConfig(configInput: ModelAliasConfig): Promise<ModelAliasConfig> {
  const aliases: Record<string, string> = {};
  for (const [alias, target] of Object.entries(configInput.aliases || {})) {
    if (typeof alias === 'string' && typeof target === 'string' && alias.trim() && target.trim()) {
      aliases[alias.trim().toLowerCase()] = target.trim();
    }
  }
  const hidden = Array.from(new Set((configInput.hidden || []).filter((item) => {
    return typeof item === 'string' && item.trim().length > 0;
  }).map((item) => item.trim())));
  const config = { aliases, hidden };
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot persist model aliases');
  }
  await kv.set(PREFIX.modelAliases, JSON.stringify(config));
  clearCache('modelAliases');
  return config;
}

export async function setModelHidden(model: string, hidden: boolean): Promise<ModelAliasConfig> {
  const config = await getModelAliasConfig(true);
  const current = new Set(config.hidden);
  if (hidden) current.add(model);
  else current.delete(model);
  return saveModelAliasConfig({ aliases: config.aliases, hidden: Array.from(current) });
}

// ── Fallback Chain Management ────────────────────────────────

/**
 * Get the fallback chain for a provider.
 * Returns KV override if set, otherwise returns the static fallback from registry.
 */
export async function getFallbackChain(
  providerName: string,
  staticFallbacks?: string[] | string
): Promise<string[]> {
  if ((global as any).__mockFallbackChain) {
    return (global as any).__mockFallbackChain(providerName, staticFallbacks);
  }
  const cacheKey = `fallback:${providerName}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  try {
    const kv = await getKV();
    if (kv) {
      const raw = await withTimeout(
        kv.get(`${PREFIX.fallbacks}${providerName}`),
        1000,
        null,
        `getFallbackChain:${providerName}`
      );
      if (raw) {
        const parsed = parseJsonOrArray(raw);
        if (parsed) {
          setCached(cacheKey, parsed);
          return parsed;
        }
      }
    }
  } catch {
    // fall through
  }
  // Return static fallback as single-element array, or array if already array, or empty
  const fallback = Array.isArray(staticFallbacks)
    ? staticFallbacks
    : staticFallbacks
      ? [staticFallbacks]
      : [];
  setCached(cacheKey, fallback);
  return fallback;
}

/**
 * Set the fallback chain for a provider.
 * Pass empty array to clear all fallbacks.
 */
export async function setFallbackChain(
  providerName: string,
  chain: string[]
): Promise<void> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot persist fallback overrides');
  }
  await kv.set(`${PREFIX.fallbacks}${providerName}`, JSON.stringify(chain));
  clearCache(`fallback:${providerName}`);
}

/**
 * Reset a provider's fallback chain to static defaults.
 */
export async function clearFallbackChain(providerName: string): Promise<void> {
  const kv = await getKV();
  if (!kv) return;
  await kv.del(`${PREFIX.fallbacks}${providerName}`);
  clearCache(`fallback:${providerName}`);
}

// ── API Key Management ───────────────────────────────────────

/**
 * Get managed API keys for a provider.
 * Returns KV override if set, otherwise null (caller should use env vars).
 */
export async function getManagedKeys(providerName: string, forceRefresh = false): Promise<string[] | null> {
  const cacheKey = `keys:${providerName}`;
  const cached = forceRefresh ? { hit: false as const } : getCachedEntry<string[] | null>(cacheKey);
  if (cached.hit) return cached.data;

  const kv = await getKV();
  if (kv) {
    const raw = await withTimeout(
      kv.get(`${PREFIX.keys}${providerName}`),
      1000,
      undefined,
      `getManagedKeys:${providerName}`
    );
    if (raw === undefined) {
      throw new Error(`Timeout fetching managed keys for ${providerName}`);
    }
    if (raw) {
      const parsed = parseJsonOrArray(raw);
      if (parsed) {
        setCached(cacheKey, parsed);
        return parsed;
      }
    }
    setCached(cacheKey, null);
    return null;
  }
  throw new Error('KV storage not configured');
}

export async function getManagedKeysVersion(providerName: string): Promise<number> {
  const cacheKey = `keyVersion:${providerName}`;
  const cached = getCached<number>(cacheKey);
  if (cached !== null) return cached;

  const kv = await getKV();
  if (!kv) throw new Error('KV storage not configured');
  const raw = await withTimeout(
    kv.get(`${PREFIX.keyVersion}${providerName}`),
    1000,
    undefined,
    `getManagedKeysVersion:${providerName}`
  );
  if (raw === undefined) {
    throw new Error(`Timeout fetching key version for ${providerName}`);
  }
  const version = Number(raw || 0);
  setCached(cacheKey, version, CONFIG_CACHE_TTL_MS); // 60s cache
  return version;
}

async function bumpManagedKeysVersion(providerName: string, kv?: any): Promise<number> {
  const client = kv || await getKV();
  if (!client) return 0;
  try {
    const key = `${PREFIX.keyVersion}${providerName}`;
    if (typeof client.incr === 'function') {
      const version = Number(await client.incr(key));
      clearCache(`keyVersion:${providerName}`); // invalidate cache after bump
      return version;
    }
    const current = Number(await client.get(key) || 0) + 1;
    await client.set(key, current);
    clearCache(`keyVersion:${providerName}`); // invalidate cache after bump
    return current;
  } catch {
    return 0;
  }
}

/**
 * Get all managed keys for all providers (returns a map of provider → keys[]).
 */
export async function getAllManagedKeys(): Promise<Record<string, string[]>> {
  const cached = getCached<Record<string, string[]>>('keys:all');
  if (cached) return cached;

  const kv = await getKV();
  if (!kv) return {};

  try {
    // Scan for all admin:keys:* keys
    const keys: string[] = [];
    let cursor = 0;
    do {
      const result = await withTimeout(
        kv.scan(cursor, { match: 'admin:keys:*', count: 100 }),
        1000,
        [0, []] as [number, string[]],
        'getAllManagedKeys:scan'
      );
      cursor = result[0];
      keys.push(...result[1]);
      if (cursor === 0 || result[1].length === 0) {
        break;
      }
    } while (cursor !== 0);

    const out: Record<string, string[]> = {};
    if (keys.length > 0) {
      const values = await withTimeout(
        Promise.all(keys.map((k: string) => kv.get(k))),
        1000,
        keys.map(() => null),
        'getAllManagedKeys:getValues'
      );
      for (let i = 0; i < keys.length; i++) {
        const provider = keys[i].replace('admin:keys:', '');
        if (values[i]) {
          const parsed = parseJsonOrArray(values[i]);
          if (parsed) {
            out[provider] = parsed;
          }
        }
      }
    }
    setCached('keys:all', out);
    return out;
  } catch {
    return {};
  }
}

/**
 * Set the managed API keys for a provider.
 * This OVERRIDES env var keys for this provider when called.
 */
export async function setManagedKeys(
  providerName: string,
  keys: string[]
): Promise<void> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot persist key overrides');
  }
  await kv.set(`${PREFIX.keys}${providerName}`, JSON.stringify(keys));
  const version = await bumpManagedKeysVersion(providerName, kv);
  clearCache(`keys:${providerName}`);
  clearCache('keys:all');
  try {
    const { updateMemoryKeyPool } = await import('../relay/key-pool');
    updateMemoryKeyPool(providerName, keys, version);
  } catch {
    // ignore
  }
}

/**
 * Add a key to a provider's managed key list.
 * If no managed keys exist yet, bootstraps from env var keys first.
 */
export async function addManagedKey(
  providerName: string,
  newKey: string,
  envKeys: string[] = []
): Promise<string[]> {
  const existing = await getManagedKeys(providerName);
  // Bootstrap from env if no managed keys yet
  const current = existing ?? [...envKeys];
  if (current.includes(newKey)) {
    return current; // already exists
  }
  current.push(newKey);
  await setManagedKeys(providerName, current);
  return current;
}

/**
 * Remove a key from a provider's managed key list.
 * Key can be matched by full value or by hash prefix.
 * If no managed keys exist, bootstraps from env keys first.
 */
export async function removeManagedKey(
  providerName: string,
  keyOrHash: string,
  envKeys: string[] = []
): Promise<string[]> {
  const existing = await getManagedKeys(providerName);
  const current = existing ?? [...envKeys];
  // Try matching by full value first, then by hash
  const filtered = current.filter((k) => k !== keyOrHash);
  if (filtered.length === current.length) {
    throw new Error(`Key not found: ${keyOrHash}`);
  }
  await setManagedKeys(providerName, filtered);
  return filtered;
}

// ── Quota Limit Override Management ─────────────────────────

export interface CustomQuotaConfig {
  dailyLimit: number | null;
  monthlyLimit: number | null;
}

/**
 * Get custom quota override limits from KV.
 * Returns null if no custom quota override is configured.
 */
export async function getCustomQuota(): Promise<CustomQuotaConfig | null> {
  const cached = getCachedEntry<CustomQuotaConfig | null>('quota');
  if (cached.hit) return cached.data;

  try {
    const kv = await getKV();
    if (kv) {
      const raw = await withTimeout<Record<string, unknown> | null>(
        kv.hgetall(PREFIX.quota),
        1000,
        null,
        'getCustomQuota'
      );
      if (raw && (raw.dailyLimit !== undefined || raw.monthlyLimit !== undefined)) {
        const quota = {
          dailyLimit: raw.dailyLimit !== null && raw.dailyLimit !== undefined && raw.dailyLimit !== '' ? parseInt(String(raw.dailyLimit), 10) : null,
          monthlyLimit: raw.monthlyLimit !== null && raw.monthlyLimit !== undefined && raw.monthlyLimit !== '' ? parseInt(String(raw.monthlyLimit), 10) : null,
        };
        setCached('quota', quota);
        return quota;
      }
    }
  } catch {
    // fall through
  }
  setCached('quota', null);
  return null;
}

/**
 * Set custom quota override limits in KV.
 */
export async function setCustomQuota(quota: CustomQuotaConfig): Promise<void> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot persist quota overrides');
  }
  await kv.hset(PREFIX.quota, {
    dailyLimit: quota.dailyLimit === null ? '' : String(quota.dailyLimit),
    monthlyLimit: quota.monthlyLimit === null ? '' : String(quota.monthlyLimit),
  });
  clearCache('quota');
}

/**
 * Clear custom quota overrides and revert to environment variables.
 */
export async function clearCustomQuota(): Promise<void> {
  const kv = await getKV();
  if (!kv) return;
  await kv.del(PREFIX.quota);
  clearCache('quota');
}

// ── Webhook Notification Management ──────────────────────────

import type { WebhookConfig, WebhookSettings, WebhookAlertThreshold } from '../webhooks/types';

const WEBHOOK_PREFIX = 'admin:webhooks';      // admin:webhooks → JSON WebhookSettings

const DEFAULT_SETTINGS: WebhookSettings = {
  webhooks: [],
  alertThresholds: [],
  reportTime: '21:00',
  reportTimezone: 'Asia/Shanghai',
};

/**
 * Get all webhook settings from KV.
 */
export async function getWebhookSettings(): Promise<WebhookSettings> {
  const cached = getCached<WebhookSettings>('webhooks');
  if (cached) return cached;

  try {
    const kv = await getKV();
    if (kv) {
      const raw = await withTimeout(
        kv.get(WEBHOOK_PREFIX),
        1000,
        null,
        'getWebhookSettings'
      );
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const settings = { ...DEFAULT_SETTINGS, ...parsed };
        setCached('webhooks', settings);
        return settings;
      }
    }
  } catch {
    // fall through
  }
  const settings = { ...DEFAULT_SETTINGS };
  setCached('webhooks', settings);
  return settings;
}

/**
 * Save the full webhook settings to KV.
 */
export async function saveWebhookSettings(settings: WebhookSettings): Promise<void> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot persist webhook settings');
  }
  await kv.set(WEBHOOK_PREFIX, JSON.stringify(settings));
  clearCache('webhooks');
}

/**
 * Add a new webhook config. Returns the new config with generated id.
 */
export async function addWebhook(config: Omit<WebhookConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<WebhookConfig> {
  const settings = await getWebhookSettings();
  const now = new Date().toISOString();
  const newWebhook: WebhookConfig = {
    ...config,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  settings.webhooks.push(newWebhook);
  await saveWebhookSettings(settings);
  return newWebhook;
}

/**
 * Update an existing webhook config by id.
 */
export async function updateWebhook(id: string, updates: Partial<Omit<WebhookConfig, 'id' | 'createdAt'>>): Promise<WebhookConfig | null> {
  const settings = await getWebhookSettings();
  const idx = settings.webhooks.findIndex(w => w.id === id);
  if (idx < 0) return null;
  settings.webhooks[idx] = {
    ...settings.webhooks[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await saveWebhookSettings(settings);
  return settings.webhooks[idx];
}

/**
 * Delete a webhook config by id.
 */
export async function deleteWebhook(id: string): Promise<boolean> {
  const settings = await getWebhookSettings();
  const before = settings.webhooks.length;
  settings.webhooks = settings.webhooks.filter(w => w.id !== id);
  if (settings.webhooks.length === before) return false;
  await saveWebhookSettings(settings);
  return true;
}

/**
 * Update alert thresholds.
 */
export async function saveAlertThresholds(thresholds: WebhookAlertThreshold[]): Promise<void> {
  const settings = await getWebhookSettings();
  settings.alertThresholds = thresholds;
  await saveWebhookSettings(settings);
}

// ── Custom Providers Management ──────────────────────────────

/**
 * Get all custom providers from KV.
 */
export async function getCustomProviders(forceRefresh = false): Promise<Record<string, ProviderConfig>> {
  const cached = forceRefresh ? null : getCached<Record<string, ProviderConfig>>('customProviders');
  if (cached) return cached;

  try {
    const kv = await getKV();
    if (kv) {
      const raw = await withTimeout(
        kv.get('admin:custom_providers'),
        1000,
        null,
        'getCustomProviders'
      );
      if (raw) {
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
          const providers = raw as Record<string, ProviderConfig>;
          setCached('customProviders', providers);
          return providers;
        }
        if (typeof raw === 'string') {
          const providers = JSON.parse(raw);
          setCached('customProviders', providers);
          return providers;
        }
      }
    }
  } catch (err) {
    console.error('[getCustomProviders] Error:', err);
  }
  const providers = {};
  setCached('customProviders', providers);
  return providers;
}

/**
 * Save/upsert a custom provider configuration to KV.
 */
export async function saveCustomProvider(provider: ProviderConfig): Promise<void> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot save custom provider');
  }
  const custom = await getCustomProviders(true);
  custom[provider.name] = {
    ...provider,
    isCustom: true,
  };
  await kv.set('admin:custom_providers', JSON.stringify(custom));
  clearCache('customProviders');
  try {
    const { clearProvidersCache } = await import('../providers/resolver');
    clearProvidersCache();
  } catch {
    // ignore
  }
}

/**
 * Delete a custom provider from KV, and clean up its keys and fallback configs.
 */
export async function deleteCustomProvider(name: string): Promise<void> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot delete custom provider');
  }
  const custom = await getCustomProviders(true);
  if (!custom[name]) {
    throw new Error(`Custom provider not found: ${name}`);
  }
  delete custom[name];
  await kv.set('admin:custom_providers', JSON.stringify(custom));
  // Clean up keys and fallbacks entries
  await kv.del(`admin:keys:${name}`);
  await kv.del(`admin:fallbacks:${name}`);
  await bumpManagedKeysVersion(name, kv);
  clearCache('customProviders');
  clearCache(`keys:${name}`);
  clearCache('keys:all');
  clearCache(`fallback:${name}`);
  try {
    const { clearProvidersCache } = await import('../providers/resolver');
    clearProvidersCache();
  } catch {
    // ignore
  }
}

/**
 * Try to decode a base64-encoded API key or JSON service account.
 * Decodes only if the string matches base64 pattern and the output consists
 * entirely of printable ASCII characters or common whitespace.
 */
export function tryDecodeBase64(str: string): string {
  const trimmed = str.trim();
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
      if (/^[\x20-\x7E\t\r\n]+$/.test(decoded) && decoded.trim().length > 0) {
        return decoded;
      }
    } catch {
      // ignore
    }
  }
  return str;
}
