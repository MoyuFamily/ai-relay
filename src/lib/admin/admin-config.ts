// ============================================================
// AI API Relay — Admin Config Store (Vercel KV)
// ============================================================
// Runtime overrides for fallback chains and API keys.
// Falls back to source-code defaults when no KV override exists.

import { withTimeout } from '@/lib/utils/timeout';
import type { ProviderConfig } from '../providers/types';
import type { PriorityRule } from './priority-rules-core';
import { normalizePriorityRules } from './priority-rules-core';
import { getCFEnvSync, getCFEnv, isCloudflareSync } from '@/lib/cf-env';

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
  resetClients(): void {
    _kv = null;
    _pgKv = null;
    _pgKvUrl = null;
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
    async set(key: string, value: any, _options?: { ex?: number }) {
      store.set(key, value);
      return 'OK';
    },
    async del(...keys: string[]) {
      let deleted = 0;
      for (const key of keys) {
        if (store.delete(key)) deleted++;
      }
      return deleted;
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
    async sadd(key: string, ...members: string[]) {
      let current = store.get(key);
      if (!(current instanceof Set)) {
        current = new Set();
        store.set(key, current);
      }
      let added = 0;
      for (const member of members) {
        if (!current.has(member)) {
          current.add(member);
          added++;
        }
      }
      return added;
    },
    async smembers(key: string) {
      const current = store.get(key);
      if (current instanceof Set) {
        return Array.from(current);
      }
      return [];
    },
    async srem(key: string, ...members: string[]) {
      const current = store.get(key);
      if (current instanceof Set) {
        let removed = 0;
        for (const member of members) {
          if (current.delete(member)) removed++;
        }
        return removed;
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

let _pgKv: any = null;
let _pgKvUrl: string | null = null;

export type StorageBackendType =
  | 'cloudflare-kv-d1'
  | 'vercel-kv'
  | 'postgres'
  | 'file'
  | 'memory'
  | 'none';

function isNextProductionBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build';
}

function canUseSelfHostedPostgres(): boolean {
  if (isNextProductionBuildPhase()) return false;
  if (process.env.VERCEL || process.env.CF_PAGES) return false;
  if (process.env.VITEST && process.env.RELAY_ENABLE_POSTGRES_IN_TEST !== '1') return false;
  const url = process.env.DATABASE_URL?.trim() || '';
  return /^postgres(ql)?:\/\//i.test(url);
}

function hasExplicitFileStorageEnv(): boolean {
  return Boolean(process.env.RELAY_STORAGE_PATH?.trim() || process.env.RELAY_DATA_DIR?.trim());
}

function canUseDefaultSelfHostedFileStorage(): boolean {
  if (isNextProductionBuildPhase()) return false;
  if (process.env.VERCEL || process.env.CF_PAGES) return false;
  if (process.env.VITEST) return false;
  return process.env.NODE_ENV === 'production';
}

export async function detectStorageBackend(): Promise<StorageBackendType> {
  if (isCloudflareSync()) {
    const cfEnv = getCFEnvSync() || await getCFEnv();
    return cfEnv?.KV ? 'cloudflare-kv-d1' : 'none';
  }
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return 'vercel-kv';
  }
  if (!process.env.VERCEL && !process.env.CF_PAGES && hasExplicitFileStorageEnv()) {
    return 'file';
  }
  if (canUseSelfHostedPostgres()) {
    return 'postgres';
  }
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return 'memory';
  }
  if (canUseDefaultSelfHostedFileStorage()) {
    return 'file';
  }
  return 'none';
}

/**
 * Get KV client for the current environment.
 * Supports:
 * 1. Cloudflare Pages/Workers KV binding (`CFKVAdapter`)
 * 2. Vercel KV / Upstash REST API (`@vercel/kv`)
 * 3. Self-hosted explicit file storage (`RELAY_STORAGE_PATH` / `RELAY_DATA_DIR` -> `FileKVAdapter`)
 * 4. Self-hosted PostgreSQL (`DATABASE_URL` -> `PostgresKVAdapter`)
 * 5. Development / Test in-memory mock (`createMemoryMockKV`)
 * 6. Self-hosted zero-dependency production default (`./data/kv-store.json` -> `FileKVAdapter`)
 */
export async function getKV() {
  const g = global as any;

  // 1. Cloudflare Pages/Workers: use CF KV binding via CFKVAdapter
  if (isCloudflareSync()) {
    try {
      const cfEnv = getCFEnvSync() || await getCFEnv();
      if (cfEnv?.KV) {
        const { CFKVAdapter } = await import('./cf-kv-adapter');
        return new CFKVAdapter(cfEnv.KV);
      }
    } catch { /* fall through */ }
    return null;
  }

  // 2. Vercel KV / Upstash REST API
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    if (_kv && _kv._backendType === 'vercel-kv') return _kv;
    try {
      const mod = await import('@vercel/kv');
      _kv = mod.kv || mod.createClient({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
      if (_kv && typeof _kv === 'object') {
        _kv._backendType = 'vercel-kv';
      }
      return _kv;
    } catch {
      return null;
    }
  }

  // Avoid opening database sockets or writing local files during `next build` static generation
  if (isNextProductionBuildPhase()) {
    return null;
  }

  // 3. Explicit self-hosted persistent file storage (RELAY_STORAGE_PATH or RELAY_DATA_DIR)
  if (!process.env.VERCEL && !process.env.CF_PAGES && hasExplicitFileStorageEnv()) {
    try {
      const { getFileKVAdapter } = await import('../storage/file-kv-adapter');
      return getFileKVAdapter();
    } catch {
      return null;
    }
  }

  // 4. Self-hosted PostgreSQL (multi-instance / Docker / VPS with DATABASE_URL)
  if (canUseSelfHostedPostgres()) {
    try {
      const url = process.env.DATABASE_URL!.trim();
      if (_pgKv && _pgKvUrl === url) return _pgKv;
      const [{ getPostgresSql }, { PostgresKVAdapter }] = await Promise.all([
        import('../db/client'),
        import('../storage/postgres-kv-adapter'),
      ]);
      _pgKv = new PostgresKVAdapter(getPostgresSql());
      _pgKvUrl = url;
      return _pgKv;
    } catch {
      return null;
    }
  }

  // 5. Development / Test in-memory mock
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    if (!g._mockKVInstance) {
      g._mockKVInstance = createMemoryMockKV();
      g._mockKVInstance._isMock = true;
    }
    _kv = g._mockKVInstance;
    return _kv;
  }

  // 6. Self-hosted single-node production default: persistent disk file (`./data/kv-store.json`)
  if (canUseDefaultSelfHostedFileStorage()) {
    try {
      const { getFileKVAdapter } = await import('../storage/file-kv-adapter');
      return getFileKVAdapter();
    } catch {
      return null;
    }
  }

  return null;
}


// ── KV Key Prefixes ─────────────────────────────────────────
const PREFIX = {
  fallbacks: 'admin:fallbacks:',   // admin:fallbacks:{provider} → JSON string[]
  keys: 'admin:keys:',             // admin:keys:{provider} → JSON string[] (raw API keys)
  keyVersion: 'admin:keys:version:', // admin:keys:version:{provider} → monotonically increasing number
  configVersion: 'admin:config:version', // global monotonic version for config snapshots
  quota: 'admin:quota',            // admin:quota → Hash { dailyLimit, monthlyLimit }
  modelAliases: 'relay:models:aliases', // relay:models:aliases → JSON { aliases, hidden }
  priorityRules: 'relay:priority:rules', // relay:priority:rules → JSON PriorityRule[]
} as const;

export async function getGlobalConfigVersion(forceRefresh = false): Promise<number> {
  const cacheKey = 'configVersion';
  if (!forceRefresh) {
    const cached = getCached<number>(cacheKey);
    if (cached !== null) return cached;
  }

  const kv = await getKV();
  if (!kv) return 0;

  try {
    const raw = await withTimeout(
      kv.get(PREFIX.configVersion),
      1000,
      null,
      'getGlobalConfigVersion'
    );
    const version = Number(raw || 0);
    setCached(cacheKey, version, CONFIG_CACHE_TTL_MS);
    return version;
  } catch {
    return 0;
  }
}

async function bumpGlobalConfigVersion(kv?: any): Promise<number> {
  const client = kv || await getKV();
  if (!client) return 0;
  try {
    if (typeof client.incr === 'function') {
      const next = Number(await client.incr(PREFIX.configVersion));
      clearCache('configVersion');
      return next;
    }
    const next = Number(await client.get(PREFIX.configVersion) || 0) + 1;
    await client.set(PREFIX.configVersion, next);
    clearCache('configVersion');
    return next;
  } catch {
    return 0;
  }
}

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
  await bumpGlobalConfigVersion(kv);
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
  await bumpGlobalConfigVersion(kv);
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
 * Detect circular fallback configurations using DFS.
 * Returns the cycle path (e.g. ['openai', 'anthropic', 'openai']) if a cycle is found, otherwise null.
 */
export async function detectFallbackCycle(
  providerName: string,
  proposedChain: string[]
): Promise<string[] | null> {
  const { getAllProviders } = await import('../providers');
  const allProviders = await getAllProviders();

  const fallbackGraph: Record<string, string[]> = {};
  for (const pName of Object.keys(allProviders)) {
    if (pName === providerName) {
      fallbackGraph[pName] = proposedChain.map((entry) => {
        const colonIdx = entry.indexOf(':');
        return colonIdx >= 0 ? entry.slice(0, colonIdx) : entry;
      });
    } else {
      const prov = allProviders[pName];
      const staticFallbacks = prov.fallbackProviders || (prov.fallbackProvider ? [prov.fallbackProvider] : []);
      const chain = await getFallbackChain(pName, staticFallbacks);
      fallbackGraph[pName] = chain.map((entry) => {
        const colonIdx = entry.indexOf(':');
        return colonIdx >= 0 ? entry.slice(0, colonIdx) : entry;
      });
    }
  }

  const visited = new Set<string>();
  const path: string[] = [];
  const pathSet = new Set<string>();

  function dfs(node: string): string[] | null {
    if (pathSet.has(node)) {
      const cycleStartIdx = path.indexOf(node);
      return [...path.slice(cycleStartIdx), node];
    }
    if (visited.has(node)) {
      return null;
    }
    path.push(node);
    pathSet.add(node);

    const neighbors = fallbackGraph[node] || [];
    for (const neighbor of neighbors) {
      const cycle = dfs(neighbor);
      if (cycle) return cycle;
    }

    path.pop();
    pathSet.delete(node);
    visited.add(node);
    return null;
  }

  return dfs(providerName);
}

/**
 * Set the fallback chain for a provider.
 * Pass empty array to clear all fallbacks.
 */
export async function setFallbackChain(
  providerName: string,
  chain: string[]
): Promise<void> {
  const cycle = await detectFallbackCycle(providerName, chain);
  if (cycle) {
    throw new Error(`Circular fallback detected: ${cycle.join(' -> ')}`);
  }

  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured — cannot persist fallback overrides');
  }
  await kv.set(`${PREFIX.fallbacks}${providerName}`, JSON.stringify(chain));
  await bumpGlobalConfigVersion(kv);
  clearCache(`fallback:${providerName}`);
}

/**
 * Reset a provider's fallback chain to static defaults.
 */
export async function clearFallbackChain(providerName: string): Promise<void> {
  const kv = await getKV();
  if (!kv) return;
  await kv.del(`${PREFIX.fallbacks}${providerName}`);
  await bumpGlobalConfigVersion(kv);
  clearCache(`fallback:${providerName}`);
}

// ── API Key Management ───────────────────────────────────────

/**
 * Get managed API keys for a provider.
 * Returns KV override if set, otherwise null (caller should use env vars).
 */
const TIMEOUT_OR_ERROR = Symbol('kv_timeout_or_error');

export async function getManagedKeys(
  providerName: string,
  forceRefresh = false,
  options?: { throwOnError?: boolean }
): Promise<string[] | null> {
  const cacheKey = `keys:${providerName}`;
  const cached = forceRefresh ? { hit: false as const } : getCachedEntry<string[] | null>(cacheKey);
  if (cached.hit) return cached.data;

  const kv = await getKV();
  if (kv) {
    const raw = await withTimeout<unknown>(
      kv.get(`${PREFIX.keys}${providerName}`),
      1000,
      TIMEOUT_OR_ERROR,
      `getManagedKeys:${providerName}`
    );
    if (raw === TIMEOUT_OR_ERROR) {
      // Do NOT poison configCache with `null` on transient KV errors/timeouts.
      if (options?.throwOnError) {
        throw new Error(`KV error reading managed keys for ${providerName}`);
      }
      const stale = getCachedEntry<string[] | null>(cacheKey);
      return stale.hit ? stale.data : null;
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
  return null;
}

export async function getManagedKeysVersion(
  providerName: string,
  options?: { forceRefresh?: boolean; throwOnError?: boolean }
): Promise<number> {
  const cacheKey = `keyVersion:${providerName}`;
  if (!options?.forceRefresh) {
    const cached = getCached<number>(cacheKey);
    if (cached !== null) return cached;
  }

  const kv = await getKV();
  if (!kv) return 0;
  const raw = await withTimeout<unknown>(
    kv.get(`${PREFIX.keyVersion}${providerName}`),
    1000,
    TIMEOUT_OR_ERROR,
    `getManagedKeysVersion:${providerName}`
  );
  if (raw === TIMEOUT_OR_ERROR) {
    if (options?.throwOnError) {
      throw new Error(`KV error reading key version for ${providerName}`);
    }
    return 0;
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

    const providerKeyNames = keys.filter((k) => !k.startsWith(PREFIX.keyVersion));
    const out: Record<string, string[]> = {};
    if (providerKeyNames.length > 0) {
      const values = await withTimeout(
        Promise.all(providerKeyNames.map((k: string) => kv.get(k))),
        1000,
        providerKeyNames.map(() => null),
        'getAllManagedKeys:getValues'
      );
      for (let i = 0; i < providerKeyNames.length; i++) {
        const provider = providerKeyNames[i].replace('admin:keys:', '');
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
  await bumpGlobalConfigVersion(kv);
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
  await bumpGlobalConfigVersion(kv);
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
  const { PROVIDERS } = await import('../providers/registry');
  const allProviderNames = Array.from(new Set([
    ...Object.keys(PROVIDERS),
    ...Object.keys(custom),
  ]));
  delete custom[name];
  await kv.set('admin:custom_providers', JSON.stringify(custom));

  // Clean up keys, its own fallback chain, and references from other fallback chains.
  await kv.del(`admin:keys:${name}`);
  await kv.del(`admin:fallbacks:${name}`);
  await Promise.all(allProviderNames
    .filter((providerName) => providerName !== name)
    .map(async (providerName) => {
      const raw = await kv.get(`${PREFIX.fallbacks}${providerName}`);
      const chain = parseJsonOrArray(raw);
      if (!chain) return;

      const filtered = chain.filter((entry) => {
        const colonIdx = entry.indexOf(':');
        const providerNamePart = colonIdx >= 0 ? entry.slice(0, colonIdx) : entry;
        return providerNamePart !== name;
      });

      if (filtered.length === chain.length) return;
      if (filtered.length > 0) {
        await kv.set(`${PREFIX.fallbacks}${providerName}`, JSON.stringify(filtered));
      } else {
        await kv.del(`${PREFIX.fallbacks}${providerName}`);
      }
      clearCache(`fallback:${providerName}`);
    }));
  await bumpManagedKeysVersion(name, kv);
  await bumpGlobalConfigVersion(kv);
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

/**
 * Exports all configuration-related data from Vercel KV as a single JSON-serializable object.
 */
export async function exportBackupData(): Promise<Record<string, any>> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured');
  }

  // 1. Get custom providers
  const customProviders = await getCustomProviders(true);

  // Get all possible provider names (static + custom)
  const { PROVIDERS } = await import('../providers/registry');
  const allProviderNames = Array.from(new Set([
    ...Object.keys(PROVIDERS),
    ...Object.keys(customProviders)
  ]));

  // 2. Fetch all keys and fallback overrides in parallel
  const keysPayload: Record<string, string[]> = {};
  const fallbacksPayload: Record<string, string[]> = {};

  const keysPromises = allProviderNames.map(async (name) => {
    try {
      const keys = await getManagedKeys(name, true);
      if (keys && keys.length > 0) {
        keysPayload[name] = keys;
      }
    } catch {
      // Ignore errors for individual provider lookups
    }
  });

  const fallbacksPromises = allProviderNames.map(async (name) => {
    try {
      // Query the KV key directly to only back up custom overrides rather than static defaults
      const raw = await kv.get(`${PREFIX.fallbacks}${name}`);
      if (raw) {
        const parsed = parseJsonOrArray(raw);
        if (parsed && parsed.length > 0) {
          fallbacksPayload[name] = parsed;
        }
      }
    } catch {
      // Ignore
    }
  });

  // 3. Fetch global configurations
  const [quota, modelAliases, priorityRules, webhooks] = await Promise.all([
    getCustomQuota(),
    getModelAliasConfig(true),
    getPriorityRules(true),
    getWebhookSettings(),
    ...keysPromises,
    ...fallbacksPromises
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    customProviders,
    keys: keysPayload,
    fallbacks: fallbacksPayload,
    quota,
    modelAliases,
    priorityRules,
    webhooks
  };
}

/**
 * Restores configuration-related data into Vercel KV from a backup object.
 */
function validateCustomProviders(customProviders: any): Record<string, ProviderConfig> {
  if (!customProviders || typeof customProviders !== 'object' || Array.isArray(customProviders)) {
    return {};
  }
  const validated: Record<string, ProviderConfig> = {};
  for (const [key, value] of Object.entries(customProviders)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const val = value as any;
    // Essential validations to prevent resolver crash
    if (typeof val.name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(val.name)) continue;
    if (typeof val.displayName !== 'string' || !val.displayName.trim()) continue;
    if (typeof val.baseUrl !== 'string' || !val.baseUrl.startsWith('https://')) continue;
    if (!Array.isArray(val.modelPrefixes) || val.modelPrefixes.length === 0) continue;
    if (!val.modelPrefixes.every((p: any) => typeof p === 'string' && p.trim())) continue;
    if (!['openai', 'anthropic', 'azure'].includes(val.headerFormat)) continue;

    // Normalizing and building valid config
    const config: ProviderConfig = {
      name: val.name,
      displayName: val.displayName.trim(),
      baseUrl: val.baseUrl.trim(),
      modelPrefixes: val.modelPrefixes.map((p: string) => p.trim()),
      headerFormat: val.headerFormat as 'openai' | 'anthropic' | 'azure',
      envKeyField: typeof val.envKeyField === 'string' ? val.envKeyField.trim() : `${val.name.toUpperCase()}_KEYS`,
      envBaseUrlField: typeof val.envBaseUrlField === 'string' ? val.envBaseUrlField.trim() : undefined,
      userAgent: typeof val.userAgent === 'string' ? val.userAgent.trim() : undefined,
      models: Array.isArray(val.models) 
        ? val.models.filter((m: any) => m && typeof m === 'object' && typeof m.id === 'string' && typeof m.displayName === 'string') 
        : [],
      modelMapping: val.modelMapping && typeof val.modelMapping === 'object' && !Array.isArray(val.modelMapping) ? val.modelMapping : undefined,
      isCustom: true,
    };
    validated[val.name] = config;
  }
  return validated;
}

/**
 * Restores configuration-related data into Vercel KV from a backup object.
 */
export async function importBackupData(data: Record<string, any>): Promise<void> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured');
  }

  if (data.version !== 1) {
    throw new Error('Invalid backup version or format');
  }

  // Load existing custom providers before overwriting them
  const oldCustomProviders = await getCustomProviders(true);

  // 1. Restore custom providers (only if customProviders is in data)
  if ('customProviders' in data) {
    if (data.customProviders && typeof data.customProviders === 'object') {
      const validated = validateCustomProviders(data.customProviders);
      await kv.set('admin:custom_providers', JSON.stringify(validated));
    } else {
      await kv.del('admin:custom_providers');
    }

    // Clear cache for custom providers immediately so subsequent validation works
    try {
      const { clearProvidersCache } = await import('../providers/resolver');
      clearProvidersCache();
    } catch {
      // ignore
    }
  }

  // 2. Restore custom priority rules
  if ('priorityRules' in data) {
    if (data.priorityRules) {
      await savePriorityRules(data.priorityRules);
    } else {
      await kv.del(PREFIX.priorityRules);
    }
  }

  // 3. Restore model aliases
  if ('modelAliases' in data) {
    if (data.modelAliases) {
      await saveModelAliasConfig(data.modelAliases);
    } else {
      await kv.del(PREFIX.modelAliases);
    }
  }

  // 4. Restore webhooks
  if ('webhooks' in data) {
    if (data.webhooks) {
      await saveWebhookSettings(data.webhooks);
    } else {
      await kv.del(WEBHOOK_PREFIX);
    }
  }

  // 5. Restore custom quota
  if ('quota' in data) {
    if (data.quota) {
      await setCustomQuota(data.quota);
    } else {
      await clearCustomQuota();
    }
  }

  // 6. Clean up and restore keys and fallbacks in KV (only if present in backup)
  if ('keys' in data || 'fallbacks' in data) {
    const { PROVIDERS } = await import('../providers/registry');
    const newCustomProviders = data.customProviders && typeof data.customProviders === 'object' ? data.customProviders : {};
    const allProviderNames = Array.from(new Set([
      ...Object.keys(PROVIDERS),
      ...Object.keys(oldCustomProviders),
      ...Object.keys(newCustomProviders)
    ]));

    // Restore keys (if present)
    if ('keys' in data && data.keys && typeof data.keys === 'object') {
      await Promise.all(allProviderNames.map((name) => kv.del(`${PREFIX.keys}${name}`)));
      const setPromises: Promise<void>[] = [];
      for (const [provider, keys] of Object.entries(data.keys)) {
        if (Array.isArray(keys) && keys.length > 0) {
          setPromises.push(setManagedKeys(provider, keys));
        }
      }
      await Promise.all(setPromises);
    }

    // Restore fallbacks (if present)
    if ('fallbacks' in data && data.fallbacks && typeof data.fallbacks === 'object') {
      await Promise.all(allProviderNames.map((name) => kv.del(`${PREFIX.fallbacks}${name}`)));
      const fallbackPromises: Promise<void>[] = [];
      for (const [provider, fallbacks] of Object.entries(data.fallbacks)) {
        if (Array.isArray(fallbacks) && fallbacks.length > 0) {
          fallbackPromises.push(setFallbackChain(provider, fallbacks));
        }
      }
      await Promise.all(fallbackPromises);
    }
  }

  // Bump global config version and clear all caches at the end
  await bumpGlobalConfigVersion(kv);
  clearCache();
}

/**
 * Exports stats-related data (usage counts, daily reports, error logs) from Vercel KV for a given date range.
 */
export async function exportStatsData(startDate: string, endDate: string): Promise<Record<string, any>> {
  const kv = await getKV();
  if (!kv) {
    return {
      type: 'ai-relay-stats-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      startDate,
      endDate,
      data: {
        usageDaily: {},
        usageProviderDaily: {},
        errorProviderDaily: {},
        dailyReports: {},
        quotaDaily: {},
        quotaMonthly: {},
        errorKeys: {}
      }
    };
  }

  // Parse dates
  const { enumerateDateKeys } = await import('../usage/daily-report-store');
  const dates = enumerateDateKeys(startDate, endDate);
  if (dates.length === 0) {
    throw new Error('Invalid date range');
  }

  const { getAllProviders } = await import('../providers/resolver');
  const allProviders = await getAllProviders();
  const providerNames = Object.keys(allProviders);

  // Extract months represented in the date range
  const months = Array.from(new Set(dates.map(d => d.slice(0, 7))));

  // Fetch data in one big pipeline request to save connection overhead & free tier quota
  const pipeline = kv.pipeline();
  
  dates.forEach((d) => {
    pipeline.hgetall(`usage:daily:${d}`);
    pipeline.get(`quota:daily:${d}`);
    pipeline.smembers(`error:keys:${d}`);
    pipeline.get(`relay:report:daily:${d}`);
    
    providerNames.forEach((provider) => {
      pipeline.hgetall(`usage:provider:${provider}:daily:${d}`);
      pipeline.hgetall(`error:${provider}:${d}`);
    });
  });

  months.forEach((m) => {
    pipeline.get(`quota:monthly:${m}`);
  });

  const results = await pipeline.exec();

  // Parse results back to expected structured objects
  const usageDaily: Record<string, any> = {};
  const quotaDaily: Record<string, any> = {};
  const errorKeys: Record<string, string[]> = {};
  const dailyReports: Record<string, any> = {};
  const usageProviderDaily: Record<string, Record<string, any>> = {};
  const errorProviderDaily: Record<string, Record<string, any>> = {};

  // Init provider sub-records
  for (const provider of providerNames) {
    usageProviderDaily[provider] = {};
    errorProviderDaily[provider] = {};
  }

  let idx = 0;
  dates.forEach((d) => {
    const uDaily = results[idx++];
    const qDaily = results[idx++];
    const errKeys = results[idx++];
    const report = results[idx++];

    if (uDaily && typeof uDaily === 'object' && Object.keys(uDaily).length > 0) {
      usageDaily[d] = uDaily;
    }
    if (qDaily !== null && qDaily !== undefined) {
      quotaDaily[d] = qDaily;
    }
    if (Array.isArray(errKeys) && errKeys.length > 0) {
      errorKeys[d] = errKeys as string[];
    }
    if (report) {
      dailyReports[d] = typeof report === 'string' ? JSON.parse(report) : report;
    }

    providerNames.forEach((provider) => {
      const upDaily = results[idx++];
      const epDaily = results[idx++];

      if (upDaily && typeof upDaily === 'object' && Object.keys(upDaily).length > 0) {
        usageProviderDaily[provider][d] = upDaily;
      }
      if (epDaily && typeof epDaily === 'object' && Object.keys(epDaily).length > 0) {
        errorProviderDaily[provider][d] = epDaily;
      }
    });
  });

  const quotaMonthly: Record<string, any> = {};
  months.forEach((m) => {
    const qMonthly = results[idx++];
    if (qMonthly !== null && qMonthly !== undefined) {
      quotaMonthly[m] = qMonthly;
    }
  });

  return {
    type: 'ai-relay-stats-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    startDate,
    endDate,
    data: {
      usageDaily,
      usageProviderDaily,
      errorProviderDaily,
      dailyReports,
      quotaDaily,
      quotaMonthly,
      errorKeys
    }
  };
}

/**
 * Restores stats-related data (usage counts, daily reports, error logs) into Vercel KV from a backup payload.
 */
export async function importStatsData(payload: Record<string, any>): Promise<void> {
  const kv = await getKV();
  if (!kv) {
    throw new Error('KV storage not configured');
  }

  if (payload.type !== 'ai-relay-stats-backup' || payload.version !== 1 || !payload.data) {
    throw new Error('Invalid statistics backup format or version');
  }

  const {
    usageDaily = {},
    usageProviderDaily = {},
    errorProviderDaily = {},
    dailyReports = {},
    quotaDaily = {},
    quotaMonthly = {},
    errorKeys = {}
  } = payload.data;

  // Restore everything in a single pipeline
  const pipeline = kv.pipeline();

  // Restore usage daily
  for (const [date, val] of Object.entries(usageDaily)) {
    if (val && typeof val === 'object' && Object.keys(val).length > 0) {
      pipeline.hset(`usage:daily:${date}`, val);
      pipeline.expire(`usage:daily:${date}`, 30 * 24 * 60 * 60); // 30 days standard TTL
    }
  }

  // Restore quota daily
  for (const [date, val] of Object.entries(quotaDaily)) {
    pipeline.set(`quota:daily:${date}`, String(val));
    pipeline.expire(`quota:daily:${date}`, 2 * 24 * 60 * 60); // 2 days standard TTL
  }

  // Restore quota monthly
  for (const [month, val] of Object.entries(quotaMonthly)) {
    pipeline.set(`quota:monthly:${month}`, String(val));
    pipeline.expire(`quota:monthly:${month}`, 35 * 24 * 60 * 60); // 35 days standard TTL
  }

  // Restore daily reports — if dailyReports is empty but usageDaily has data,
  // synthesize reports from raw usage so the chart has something to display.
  const reportsToWrite: Record<string, object> = { ...dailyReports };
  for (const [date, raw] of Object.entries(usageDaily as Record<string, any>)) {
    if (reportsToWrite[date]) continue; // prefer explicit report if present
    if (!raw || typeof raw !== 'object') continue;
    const byProvider: Record<string, object> = {};
    const providerData = (usageProviderDaily as Record<string, Record<string, any>>);
    for (const [provider, datesData] of Object.entries(providerData)) {
      const pRaw = datesData?.[date];
      if (pRaw && typeof pRaw === 'object' && Object.keys(pRaw).length > 0) {
        byProvider[provider] = {
          requests: Number(pRaw.requests ?? 0),
          tokens: Number(pRaw.tokens ?? 0),
          promptTokens: Number(pRaw.promptTokens ?? 0),
          completionTokens: Number(pRaw.completionTokens ?? 0),
        };
      }
    }
    reportsToWrite[date] = {
      date,
      summary: {
        totalRequests: Number(raw.requests ?? 0),
        totalTokens: Number(raw.tokens ?? 0),
        promptTokens: Number(raw.promptTokens ?? 0),
        completionTokens: Number(raw.completionTokens ?? 0),
        errorRate: 0,
        p95LatencyMs: null,
      },
      byProvider,
      topModels: [],
    };
  }
  for (const [date, val] of Object.entries(reportsToWrite)) {
    if (val && typeof val === 'object') {
      pipeline.set(`relay:report:daily:${date}`, JSON.stringify(val));
      pipeline.expire(`relay:report:daily:${date}`, 30 * 24 * 60 * 60);
    }
  }

  // Restore error keys
  for (const [date, members] of Object.entries(errorKeys)) {
    if (Array.isArray(members) && members.length > 0) {
      pipeline.del(`error:keys:${date}`); // Clear first
      pipeline.sadd(`error:keys:${date}`, ...members);
      pipeline.expire(`error:keys:${date}`, 7 * 24 * 60 * 60); // 7 days standard TTL
    }
  }

  // Restore provider daily usage
  for (const [provider, datesData] of Object.entries(usageProviderDaily)) {
    if (datesData && typeof datesData === 'object') {
      for (const [date, val] of Object.entries(datesData as Record<string, any>)) {
        if (val && typeof val === 'object' && Object.keys(val).length > 0) {
          pipeline.hset(`usage:provider:${provider}:daily:${date}`, val);
          pipeline.expire(`usage:provider:${provider}:daily:${date}`, 30 * 24 * 60 * 60);
        }
      }
    }
  }

  // Restore provider error daily logs
  for (const [provider, datesData] of Object.entries(errorProviderDaily)) {
    if (datesData && typeof datesData === 'object') {
      for (const [date, val] of Object.entries(datesData as Record<string, any>)) {
        if (val && typeof val === 'object' && Object.keys(val).length > 0) {
          pipeline.hset(`error:${provider}:${date}`, val);
          pipeline.expire(`error:${provider}:${date}`, 7 * 24 * 60 * 60);
        }
      }
    }
  }

  await pipeline.exec();

  // On CF, also write usage data to D1 so the chart reads from the correct store
  try {
    const cfEnv = getCFEnvSync() || await getCFEnv();
    if (cfEnv?.DB) {
      const d1Stmts: any[] = [];
      const upsertSql = `INSERT INTO daily_usage (date, provider, requests, tokens, prompt_tokens, completion_tokens)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (date, provider) DO UPDATE SET
           requests = excluded.requests, tokens = excluded.tokens,
           prompt_tokens = excluded.prompt_tokens, completion_tokens = excluded.completion_tokens`;

      for (const [date, raw] of Object.entries(usageDaily as Record<string, any>)) {
        if (!raw || typeof raw !== 'object') continue;
        d1Stmts.push(cfEnv.DB.prepare(upsertSql).bind(
          date, '',
          Number(raw.requests || 0), Number(raw.tokens || 0),
          Number(raw.promptTokens || 0), Number(raw.completionTokens || 0)
        ));
      }

      for (const [provider, datesData] of Object.entries(usageProviderDaily as Record<string, Record<string, any>>)) {
        if (!datesData || typeof datesData !== 'object') continue;
        for (const [date, raw] of Object.entries(datesData)) {
          if (!raw || typeof raw !== 'object') continue;
          d1Stmts.push(cfEnv.DB.prepare(upsertSql).bind(
            date, provider,
            Number(raw.requests || 0), Number(raw.tokens || 0),
            Number(raw.promptTokens || 0), Number(raw.completionTokens || 0)
          ));
        }
      }

      for (let i = 0; i < d1Stmts.length; i += 100) {
        await cfEnv.DB.batch(d1Stmts.slice(i, i + 100));
      }
    }
  } catch {
    // Non-critical: D1 write failure should not fail the whole import
  }

  // On self-hosted Postgres, also sync daily_usage rows so relational trend/report queries match
  if (canUseSelfHostedPostgres()) {
    try {
      const [{ getPostgresSql }, { ensureSelfHostedPostgresSchema }] = await Promise.all([
        import('../db/client'),
        import('../db/self-hosted-schema'),
      ]);
      const sql = getPostgresSql();
      await ensureSelfHostedPostgresSchema(sql);

      for (const [date, raw] of Object.entries(usageDaily as Record<string, any>)) {
        if (!raw || typeof raw !== 'object') continue;
        await sql`
          INSERT INTO daily_usage (date, provider, requests, tokens, prompt_tokens, completion_tokens)
          VALUES (
            ${date},
            '',
            ${Number(raw.requests || 0)},
            ${Number(raw.tokens || 0)},
            ${Number(raw.promptTokens || 0)},
            ${Number(raw.completionTokens || 0)}
          )
          ON CONFLICT (date, provider) DO UPDATE SET
            requests = EXCLUDED.requests,
            tokens = EXCLUDED.tokens,
            prompt_tokens = EXCLUDED.prompt_tokens,
            completion_tokens = EXCLUDED.completion_tokens
        `;
      }

      for (const [provider, datesData] of Object.entries(usageProviderDaily as Record<string, Record<string, any>>)) {
        if (!datesData || typeof datesData !== 'object') continue;
        for (const [date, raw] of Object.entries(datesData)) {
          if (!raw || typeof raw !== 'object') continue;
          await sql`
            INSERT INTO daily_usage (date, provider, requests, tokens, prompt_tokens, completion_tokens)
            VALUES (
              ${date},
              ${provider},
              ${Number(raw.requests || 0)},
              ${Number(raw.tokens || 0)},
              ${Number(raw.promptTokens || 0)},
              ${Number(raw.completionTokens || 0)}
            )
            ON CONFLICT (date, provider) DO UPDATE SET
              requests = EXCLUDED.requests,
              tokens = EXCLUDED.tokens,
              prompt_tokens = EXCLUDED.prompt_tokens,
              completion_tokens = EXCLUDED.completion_tokens
          `;
        }
      }
    } catch {
      // Non-critical: Postgres relational sync failure should not fail KV backup import
    }
  }
}
