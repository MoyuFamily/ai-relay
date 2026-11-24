// ============================================================
// AI API Relay — First-Time Bootstrap Auth (Zero-Env Onboarding)
// ============================================================
// Enables true zero-env one-click deployments (Vercel / Cloudflare / Docker):
// when neither RELAY_API_KEY nor RELAY_ADMIN_KEY is configured via environment
// variables, the first visitor to `/admin` can one-click initialize and lock a
// randomly generated API key into persistent storage (D1, KV/Redis, Disk, PG).
//
// Security invariants:
// 1. Environment variables ALWAYS take precedence over bootstrapped storage.
// 2. Until initialized, all `/v1/*` and `/api/admin/*` routes stay locked.
// 3. Initialization is strictly one-time: subsequent POST calls return 409.
// 4. `GET /api/admin/bootstrap` NEVER exposes the key value.

import { getCFEnv, getCFEnvSync, isCloudflareSync } from '@/lib/cf-env';
import { ensureD1Schema } from '@/lib/db/d1-schema';
import { detectStorageBackend, getKV, type StorageBackendType } from './admin-config';
import { getRuntimeSettings } from './runtime-settings';

export const BOOTSTRAP_STORAGE_KEY = 'admin:bootstrap:auth';
const BOOTSTRAP_CACHE_TTL_MS = 60_000;
const MIN_BOOTSTRAP_KEY_LENGTH = 12;
const MAX_BOOTSTRAP_KEY_LENGTH = 128;

export interface BootstrapAuthRecord {
  apiKey: string;
  createdAt: string;
}

export interface BootstrapStatus {
  initialized: boolean;
  canBootstrap: boolean;
  source: 'env' | 'storage' | 'none';
  storageBackend: StorageBackendType;
}

export class BootstrapError extends Error {
  constructor(
    message: string,
    public readonly code: 400 | 409 | 503,
    public readonly type: 'invalid_request' | 'already_initialized' | 'storage_not_configured'
  ) {
    super(message);
    this.name = 'BootstrapError';
  }
}

interface BootstrapCacheEntry {
  apiKey: string | null;
  expiresAt: number;
}

type GlobalWithBootstrapCache = typeof globalThis & {
  __aiRelayBootstrapAuthCache?: BootstrapCacheEntry | null;
};

function getGlobalCache(): BootstrapCacheEntry | null {
  const g = globalThis as GlobalWithBootstrapCache;
  const entry = g.__aiRelayBootstrapAuthCache;
  if (entry && Date.now() < entry.expiresAt) {
    return entry;
  }
  return null;
}

function setGlobalCache(apiKey: string | null, ttlMs = BOOTSTRAP_CACHE_TTL_MS): void {
  const g = globalThis as GlobalWithBootstrapCache;
  g.__aiRelayBootstrapAuthCache = {
    apiKey,
    expiresAt: Date.now() + ttlMs,
  };
}

export function __resetBootstrapAuthCacheForTests(): void {
  const g = globalThis as GlobalWithBootstrapCache;
  g.__aiRelayBootstrapAuthCache = null;
}

function parseKeyList(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

export function getEnvRelayApiKeys(): string[] {
  return parseKeyList(process.env.RELAY_API_KEY);
}

export function getEnvRelayAdminKeys(): string[] {
  const adminKeys = parseKeyList(process.env.RELAY_ADMIN_KEY);
  return adminKeys.length > 0 ? adminKeys : getEnvRelayApiKeys();
}

export function hasEnvAuthConfigured(): boolean {
  return getEnvRelayApiKeys().length > 0 || getEnvRelayAdminKeys().length > 0;
}

export function generateSecureRelayApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sk-relay-${hex}`;
}

function parseBootstrapRecord(raw: unknown): BootstrapAuthRecord | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { apiKey?: unknown }).apiKey === 'string'
    ) {
      const apiKey = (parsed as { apiKey: string }).apiKey.trim();
      if (!apiKey) return null;
      const createdAt =
        typeof (parsed as { createdAt?: unknown }).createdAt === 'string'
          ? (parsed as { createdAt: string }).createdAt
          : new Date().toISOString();
      return { apiKey, createdAt };
    }
  } catch {
    // ignore malformed storage entry
  }
  return null;
}

async function readStoredBootstrapKey(): Promise<string | null> {
  // Prefer strongly-consistent Cloudflare D1 when available
  if (isCloudflareSync()) {
    try {
      const cfEnv = getCFEnvSync() || (await getCFEnv());
      if (cfEnv?.DB) {
        await ensureD1Schema(cfEnv.DB);
        const row = await cfEnv.DB.prepare('SELECT value FROM config_flags WHERE key = ?')
          .bind(BOOTSTRAP_STORAGE_KEY)
          .first<{ value: string }>();
        const parsed = parseBootstrapRecord(row?.value);
        if (parsed) return parsed.apiKey;
      }
    } catch {
      // Fall through to KV adapter if D1 read fails
    }
  }

  try {
    const kv = await getKV();
    if (!kv) return null;
    const raw = await kv.get(BOOTSTRAP_STORAGE_KEY);
    const parsed = parseBootstrapRecord(raw);
    return parsed ? parsed.apiKey : null;
  } catch {
    return null;
  }
}

/**
 * Retrieve the persisted bootstrap API key when no environment keys are set.
 * Returns `null` immediately when env vars are configured (zero I/O overhead).
 */
export async function getBootstrappedApiKey(forceRefresh = false): Promise<string | null> {
  if (hasEnvAuthConfigured()) {
    return null;
  }

  if (!forceRefresh) {
    const cached = getGlobalCache();
    if (cached) {
      return cached.apiKey;
    }
  }

  const stored = await readStoredBootstrapKey();
  // Short TTL for negative lookups so another isolate's first-time init becomes visible quickly
  setGlobalCache(stored, stored ? BOOTSTRAP_CACHE_TTL_MS : 3_000);
  return stored;
}

export async function getEffectiveRelayApiKeys(): Promise<string[]> {
  const envKeys = getEnvRelayApiKeys();
  const baseKeys = envKeys.length > 0 ? envKeys : (() => [] as string[])();
  if (baseKeys.length === 0) {
    const bootstrapped = await getBootstrappedApiKey();
    if (bootstrapped) baseKeys.push(bootstrapped);
  }
  const settings = await getRuntimeSettings();
  const extra = Array.isArray(settings.extraClientKeys) ? settings.extraClientKeys : [];
  if (extra.length === 0) return baseKeys;
  return Array.from(new Set([...baseKeys, ...extra]));
}

export async function getEffectiveRelayAdminKeys(): Promise<string[]> {
  const envAdminKeys = getEnvRelayAdminKeys();
  if (envAdminKeys.length > 0) return envAdminKeys;

  const bootstrapped = await getBootstrappedApiKey();
  return bootstrapped ? [bootstrapped] : [];
}

async function hasPersistentStorage(): Promise<{ available: boolean; backend: StorageBackendType }> {
  const backend = await detectStorageBackend();
  if (backend === 'none') {
    // On Cloudflare Workers, D1 alone is also sufficient to persist bootstrap auth
    if (isCloudflareSync()) {
      const cfEnv = getCFEnvSync() || (await getCFEnv());
      if (cfEnv?.DB) {
        return { available: true, backend: 'cloudflare-kv-d1' };
      }
    }
    return { available: false, backend };
  }
  const kv = await getKV();
  if (kv) {
    return { available: true, backend };
  }
  if (isCloudflareSync()) {
    const cfEnv = getCFEnvSync() || (await getCFEnv());
    if (cfEnv?.DB) {
      return { available: true, backend: 'cloudflare-kv-d1' };
    }
  }
  return { available: false, backend: 'none' };
}

export async function getBootstrapStatus(): Promise<BootstrapStatus> {
  const storage = await hasPersistentStorage();

  if (hasEnvAuthConfigured()) {
    return {
      initialized: true,
      canBootstrap: false,
      source: 'env',
      storageBackend: storage.backend,
    };
  }

  const bootstrapped = await getBootstrappedApiKey(true);
  if (bootstrapped) {
    return {
      initialized: true,
      canBootstrap: false,
      source: 'storage',
      storageBackend: storage.backend,
    };
  }

  return {
    initialized: false,
    canBootstrap: storage.available,
    source: 'none',
    storageBackend: storage.backend,
  };
}

function validateCandidateKey(rawKey?: string): string {
  if (rawKey === undefined || rawKey === null || rawKey === '') {
    return generateSecureRelayApiKey();
  }
  if (typeof rawKey !== 'string') {
    throw new BootstrapError('apiKey must be a string.', 400, 'invalid_request');
  }
  const trimmed = rawKey.trim();
  if (trimmed.length < MIN_BOOTSTRAP_KEY_LENGTH || trimmed.length > MAX_BOOTSTRAP_KEY_LENGTH) {
    throw new BootstrapError(
      `API key must be between ${MIN_BOOTSTRAP_KEY_LENGTH} and ${MAX_BOOTSTRAP_KEY_LENGTH} characters.`,
      400,
      'invalid_request'
    );
  }
  if (/[\s,]/.test(trimmed)) {
    throw new BootstrapError(
      'API key cannot contain whitespace or commas.',
      400,
      'invalid_request'
    );
  }
  return trimmed;
}

/**
 * One-time initialization of the instance API key when no env key is configured.
 * Persists atomically where supported (D1 `INSERT OR IGNORE`, Redis `NX`) and locks forever.
 */
export async function initializeBootstrapApiKey(customKey?: string): Promise<BootstrapAuthRecord> {
  if (hasEnvAuthConfigured()) {
    throw new BootstrapError(
      'Instance authentication is already configured via environment variables.',
      409,
      'already_initialized'
    );
  }

  const candidateKey = validateCandidateKey(customKey);
  const existing = await readStoredBootstrapKey();
  if (existing) {
    setGlobalCache(existing, BOOTSTRAP_CACHE_TTL_MS);
    throw new BootstrapError(
      'Instance is already initialized. Sign in with your configured API key.',
      409,
      'already_initialized'
    );
  }

  const record: BootstrapAuthRecord = {
    apiKey: candidateKey,
    createdAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(record);

  let persisted = false;

  // 1. Strongly-consistent atomic write on Cloudflare D1
  if (isCloudflareSync()) {
    const cfEnv = getCFEnvSync() || (await getCFEnv());
    if (cfEnv?.DB) {
      await ensureD1Schema(cfEnv.DB);
      const res = await cfEnv.DB.prepare(
        `INSERT OR IGNORE INTO config_flags (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`
      )
        .bind(BOOTSTRAP_STORAGE_KEY, serialized)
        .run();
      const changes = Number((res as { meta?: { changes?: number } })?.meta?.changes ?? 1);
      if (changes === 0) {
        const winner = await readStoredBootstrapKey();
        if (winner) setGlobalCache(winner, BOOTSTRAP_CACHE_TTL_MS);
        throw new BootstrapError(
          'Instance is already initialized. Sign in with your configured API key.',
          409,
          'already_initialized'
        );
      }
      persisted = true;
    }
  }

  // 2. Persist to KV/Redis/Disk/Postgres (and mirror to CF KV if bound)
  const kv = await getKV();
  if (kv) {
    if (!persisted) {
      // Check-and-set; use Redis NX option when running against Vercel KV / Upstash
      const isVercelRedis = kv._backendType === 'vercel-kv';
      if (isVercelRedis) {
        const result = await kv.set(BOOTSTRAP_STORAGE_KEY, serialized, { nx: true });
        if (result === null || result === false) {
          const winner = await readStoredBootstrapKey();
          if (winner) setGlobalCache(winner, BOOTSTRAP_CACHE_TTL_MS);
          throw new BootstrapError(
            'Instance is already initialized. Sign in with your configured API key.',
            409,
            'already_initialized'
          );
        }
      } else {
        const doubleCheck = await kv.get(BOOTSTRAP_STORAGE_KEY);
        if (doubleCheck) {
          const parsed = parseBootstrapRecord(doubleCheck);
          if (parsed) setGlobalCache(parsed.apiKey, BOOTSTRAP_CACHE_TTL_MS);
          throw new BootstrapError(
            'Instance is already initialized. Sign in with your configured API key.',
            409,
            'already_initialized'
          );
        }
        await kv.set(BOOTSTRAP_STORAGE_KEY, serialized);
      }
      persisted = true;
    } else {
      // Best-effort mirror to CF KV when D1 already persisted atomically
      await kv.set(BOOTSTRAP_STORAGE_KEY, serialized).catch(() => {});
    }
  }

  if (!persisted) {
    throw new BootstrapError(
      'Persistent storage is not configured. Attach Upstash Redis (Vercel), bind KV/D1 (Cloudflare), or set RELAY_API_KEY in environment variables.',
      503,
      'storage_not_configured'
    );
  }

  setGlobalCache(record.apiKey, BOOTSTRAP_CACHE_TTL_MS);
  return record;
}
