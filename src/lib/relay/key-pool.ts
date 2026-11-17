// ============================================================
// AI API Relay — Key Pool Management & Rotation
// ============================================================

import type { ApiKey, KeyPool, ProviderConfig } from '../providers/types';

/** In-memory key pools (cold start init, refreshed periodically) */
const keyPools = new Map<string, KeyPool>();

/** Cooldown tracking: key hash → expiry timestamp */
const cooldowns = new Map<string, number>();

const COOLDOWN_MS = 60_000; // 60s cooldown after 429/5xx

/** Version check interval for managed keys. Full key lists are fetched only when the version changes. */
const DEFAULT_KEY_VERSION_CHECK_TTL_MS = 30_000;
const lastManagedVersionCheck = new Map<string, number>();
const knownManagedVersions = new Map<string, number>();

function keyVersionCheckTtlMs(): number {
  const raw = Number(process.env.RELAY_KEY_POOL_VERSION_CHECK_TTL_MS || DEFAULT_KEY_VERSION_CHECK_TTL_MS);
  if (!Number.isFinite(raw) || raw < 1_000) return DEFAULT_KEY_VERSION_CHECK_TTL_MS;
  return raw;
}

/**
 * Hash a key to a 16-char hex identifier (for KV storage / logging).
 * Uses dual FNV-1a (two 32-bit hashes with different offsets) for 64-bit output.
 * Synchronous and Edge Runtime compatible — no Node.js crypto dependency.
 */
export function hashKey(key: string): string {
  // FNV-1a with standard offset
  let h1 = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h1 ^= key.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  // FNV-1a with alternate offset for second 32 bits
  let h2 = 0x050c5d1f;
  for (let i = 0; i < key.length; i++) {
    h2 ^= key.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'));
}

/**
 * Parse comma-separated API keys from environment variable.
 */
function parseKeys(envValue: string | undefined, provider: string): ApiKey[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .map((key) => ({
      key,
      hash: hashKey(key),
      provider,
    }));
}

/**
 * Try to load managed keys from admin KV config.
 * Returns null if KV is not configured or no managed keys exist.
 * Returns undefined if an error / network exception occurs.
 */
async function loadManagedKeys(providerName: string, forceRefresh = false): Promise<ApiKey[] | null | undefined> {
  try {
    const { getDefaultConfigStore } = await import('../config-store');
    const store = getDefaultConfigStore();
    const managed = await store.getProviderKeys(providerName, forceRefresh, { throwOnError: true });
    if (managed === undefined) return undefined;
    if (managed !== null) {
      return managed.map((key) => ({
        key,
        hash: hashKey(key),
        provider: providerName,
      }));
    }
    return null;
  } catch {
    return undefined;
  }
}

async function loadManagedKeysVersion(providerName: string, forceRefresh = false): Promise<number | undefined> {
  try {
    const { getDefaultConfigStore } = await import('../config-store');
    const store = getDefaultConfigStore();
    const version = store.getProviderKeysVersion
      ? await store.getProviderKeysVersion(providerName, { forceRefresh, throwOnError: true })
      : await store.getConfigVersion();
    if (version === undefined) return undefined;
    return version;
  } catch {
    return undefined;
  }
}

/**
 * Initialize or refresh key pools from environment variables.
 */
function initKeyPool(config: ProviderConfig): KeyPool {
  const keys = parseKeys(process.env[config.envKeyField], config.name);
  const pool: KeyPool = {
    provider: config.name,
    keys,
    counter: 0,
  };
  keyPools.set(config.name, pool);
  return pool;
}

/**
 * Get the key pool for a provider, initializing if needed.
 * Checks KV for managed keys first; falls back to env vars.
 */
export async function getKeyPool(config: ProviderConfig, forceRefresh = false): Promise<KeyPool> {
  const existing = keyPools.get(config.name);
  if (existing && !forceRefresh) {
    const lastCheck = lastManagedVersionCheck.get(config.name) || 0;
    if (Date.now() - lastCheck > keyVersionCheckTtlMs()) {
      try {
        const remoteVersion = await loadManagedKeysVersion(config.name, true);
        if (remoteVersion !== undefined) {
          const knownVersion = knownManagedVersions.get(config.name) || 0;
          if (remoteVersion !== knownVersion) {
            const managed = await loadManagedKeys(config.name, true);
            if (managed !== undefined) {
              if (managed) {
                existing.keys = managed;
              } else {
                existing.keys = parseKeys(process.env[config.envKeyField], config.name);
              }
              knownManagedVersions.set(config.name, remoteVersion);
              lastManagedVersionCheck.set(config.name, Date.now());
            }
          } else {
            lastManagedVersionCheck.set(config.name, Date.now());
          }
        }
      } catch {
        // Keep current state on error and retry later
      }
    }
    return existing;
  }
  // First call or force refresh — try managed keys, then env vars
  try {
    const [managed, version] = await Promise.all([
      loadManagedKeys(config.name, forceRefresh),
      loadManagedKeysVersion(config.name, forceRefresh),
    ]);
    if (managed !== undefined && version !== undefined) {
      if (managed) {
        const pool: KeyPool = { provider: config.name, keys: managed, counter: 0 };
        keyPools.set(config.name, pool);
        knownManagedVersions.set(config.name, version);
        lastManagedVersionCheck.set(config.name, Date.now());
        return pool;
      }
      const pool = initKeyPool(config);
      knownManagedVersions.set(config.name, version);
      lastManagedVersionCheck.set(config.name, Date.now());
      return pool;
    }
  } catch {
    // fall through to fallback
  }

  // Fallback to env keys or existing pool if it's already there
  if (existing) return existing;
  const pool = initKeyPool(config);
  lastManagedVersionCheck.set(config.name, Date.now());
  return pool;
}

/**
 * Select the next available key using round-robin with cooldown skip.
 * Returns null if all keys are on cooldown.
 */
export async function selectKey(config: ProviderConfig): Promise<ApiKey | null> {
  const pool = await getKeyPool(config);
  if (pool.keys.length === 0) return null;

  const now = Date.now();
  const totalKeys = pool.keys.length;

  for (let i = 0; i < totalKeys; i++) {
    const idx = (pool.counter + i) % totalKeys;
    const candidate = pool.keys[idx];
    const cooldownUntil = cooldowns.get(candidate.hash);

    if (!cooldownUntil || now >= cooldownUntil) {
      pool.counter = (idx + 1) % totalKeys;
      return candidate;
    }
  }

  // All keys on cooldown — return the one with earliest expiry
  let earliest = pool.keys[0];
  let earliestTime = cooldowns.get(earliest.hash) || Infinity;
  for (const key of pool.keys) {
    const cd = cooldowns.get(key.hash) || Infinity;
    if (cd < earliestTime) {
      earliest = key;
      earliestTime = cd;
    }
  }
  pool.counter = (pool.keys.indexOf(earliest) + 1) % totalKeys;
  return earliest;
}

/**
 * Mark a key as on cooldown (called after 429 or 5xx).
 */
export function markCooldown(key: ApiKey): void {
  cooldowns.set(key.hash, Date.now() + COOLDOWN_MS);
}

/**
 * Eagerly initialize all provider key pools from environment variables.
 * Call this in admin/status endpoints so stats reflect all configured providers,
 * not just ones that have handled a request in this invocation.
 */
export async function initAllKeyPools(configs: Record<string, { envKeyField: string; name: string }>, forceRefresh = false): Promise<void> {
  for (const config of Object.values(configs)) {
    if (!keyPools.has(config.name) || forceRefresh) {
      await getKeyPool(config as ProviderConfig, forceRefresh);
    }
  }
}

/**
 * Get key pool stats for admin/status page.
 */
export function getKeyPoolStats(): Record<string, { total: number; available: number; keyHashes: string[]; cooldownKeyHashes: string[] }> {
  const now = Date.now();
  const stats: Record<string, { total: number; available: number; keyHashes: string[]; cooldownKeyHashes: string[] }> = {};

  for (const [name, pool] of keyPools) {
    const cooldownKeyHashes: string[] = [];
    let available = 0;
    for (const k of pool.keys) {
      const cd = cooldowns.get(k.hash);
      if (cd !== undefined && now < cd) {
        cooldownKeyHashes.push(k.hash);
      } else {
        available++;
      }
    }
    stats[name] = {
      total: pool.keys.length,
      available,
      keyHashes: pool.keys.map((k) => k.hash),
      cooldownKeyHashes,
    };
  }

  return stats;
}

/**
 * Update the memory key pool directly (called when admin modifies keys via KV).
 */
export function updateMemoryKeyPool(providerName: string, rawKeys: string[], version?: number): void {
  const existing = keyPools.get(providerName);
  const keys = rawKeys.map((key) => ({
    key,
    hash: hashKey(key),
    provider: providerName,
  }));
  if (existing) {
    existing.keys = keys;
  } else {
    keyPools.set(providerName, {
      provider: providerName,
      keys,
      counter: 0,
    });
  }
  lastManagedVersionCheck.set(providerName, Date.now());
  if (version !== undefined) {
    knownManagedVersions.set(providerName, version);
  }
}
