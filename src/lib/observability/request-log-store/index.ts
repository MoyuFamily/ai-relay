// ============================================================
// AI API Relay — Request Log Store Factory
// ============================================================

import type { RequestLogStore } from './types';
import { MemoryRequestLogStore } from './memory-store';
import { KVRequestLogStore } from './kv-store';
import { PostgresRequestLogStore } from './postgres-store';
import { isCloudflareSync } from '@/lib/cf-env';
import {
  getRedisRestConfig,
  hasExplicitFileStorageEnv,
  shouldUseSelfHostedPostgres,
} from '@/lib/config/env';

// Test override — when set, takes precedence over environment detection.
let _override: RequestLogStore | null = null;

// Per-type instances. These are cached individually (not as a single
// "_defaultStore") so the backend is re-selected on every call while each
// store keeps a stable instance. This matters most for the in-memory store,
// whose logs live in the instance itself — caching it preserves them across
// calls. The KV/Postgres stores are effectively stateless (every method
// re-resolves its connection), so reusing the instance is just an allocation
// saving.
let _kvStore: KVRequestLogStore | null = null;
let _pgStore: PostgresRequestLogStore | null = null;
let _memStore: MemoryRequestLogStore | null = null;

/**
 * Get the default request log store based on environment.
 *
 * The backend is chosen on EVERY call (not locked on first use), because the
 * CF signal is request-scoped: the first caller in an isolate must not be able
 * to pin every later request onto the wrong backend.
 *
 * - Cloudflare Pages: KV/D1 — detected via request-scoped CF context, NOT
 *   process.env.CF_PAGES (a build-time-only var that is absent at runtime on
 *   the OpenNext Worker; relying on it silently fell through to the in-memory
 *   store, which is per-isolate and loses logs across requests).
 * - VPS/Server (DATABASE_URL set, not Vercel/CF): Postgres
 * - Vercel / external KV: KV
 * - Fallback (dev/test, no backend): In-memory
 */
export function getDefaultRequestLogStore(): RequestLogStore {
  if (_override) return _override;

  // Cloudflare Pages: KV/D1 via admin-config's unified getKV().
  // Checked first because CF_PAGES is not set at runtime — must use the
  // request-scoped context detector that the rest of the codebase relies on.
  if (isCloudflareSync()) {
    return (_kvStore ??= new KVRequestLogStore());
  }
  // VPS/Server: Postgres (takes precedence over default Docker RELAY_DATA_DIR)
  if (shouldUseSelfHostedPostgres()) {
    return (_pgStore ??= new PostgresRequestLogStore());
  }
  // Explicit self-hosted persistent disk storage
  if (hasExplicitFileStorageEnv() && !process.env.VERCEL && !process.env.CF_PAGES) {
    return (_kvStore ??= new KVRequestLogStore());
  }
  // Vercel / external KV / self-hosted production disk KV
  if (
    process.env.VERCEL ||
    process.env.CF_PAGES ||
    getRedisRestConfig() ||
    (process.env.NODE_ENV === 'production' && !process.env.VITEST && process.env.NEXT_PHASE !== 'phase-production-build')
  ) {
    return (_kvStore ??= new KVRequestLogStore());
  }
  // Fallback: in-memory (dev/test)
  return (_memStore ??= new MemoryRequestLogStore());
}

/**
 * Override the default store (useful for testing).
 */
export function setDefaultRequestLogStore(store: RequestLogStore): void {
  _override = store;
}

/**
 * Reset all cached stores and any override (test helper).
 */
export function __resetDefaultRequestLogStore(): void {
  _override = null;
  _kvStore = null;
  _pgStore = null;
  _memStore = null;
}

export * from './types';
export { MemoryRequestLogStore } from './memory-store';
export { KVRequestLogStore } from './kv-store';
export { PostgresRequestLogStore } from './postgres-store';
