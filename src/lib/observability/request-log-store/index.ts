// ============================================================
// AI API Relay — Request Log Store Factory
// ============================================================

import type { RequestLogStore } from './types';
import { MemoryRequestLogStore } from './memory-store';
import { KVRequestLogStore } from './kv-store';
import { D1RequestLogStore } from './d1-store';
import { PostgresRequestLogStore } from './postgres-store';
import * as cfEnvModule from '@/lib/cf-env';
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
// calls. The D1/KV/Postgres stores are effectively stateless across requests
// (every method re-resolves its connection), while preserving in-isolate
// capture-flag caches and append counters.
let _d1Store: D1RequestLogStore | null = null;
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
 * - Cloudflare Pages/Workers with D1 binding: D1RequestLogStore (100k rows
 *   written/day Free Tier budget, instead of CF KV's 1,000 writes/day limit)
 * - Cloudflare Pages/Workers without D1 binding: KVRequestLogStore fallback
 * - VPS/Server (DATABASE_URL set, not Vercel/CF): Postgres
 * - Vercel / external KV: KV
 * - Fallback (dev/test, no backend): In-memory
 */
export function getDefaultRequestLogStore(): RequestLogStore {
  if (_override) return _override;

  // Cloudflare Pages/Workers: prefer D1 when bound to stay off CF KV's
  // 1,000 writes/deletes/lists daily Free Tier ceiling; fall back to CF KV
  // when only KV is bound.
  if (cfEnvModule.isCloudflareSync()) {
    let cfEnv: { DB?: unknown } | null = null;
    try {
      if (typeof cfEnvModule.getCFEnvSync === 'function') {
        cfEnv = cfEnvModule.getCFEnvSync();
      }
    } catch {
      cfEnv = null;
    }
    if (cfEnv?.DB) {
      return (_d1Store ??= new D1RequestLogStore());
    }
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
  _d1Store = null;
  _kvStore = null;
  _pgStore = null;
  _memStore = null;
}

export * from './types';
export { MemoryRequestLogStore } from './memory-store';
export { KVRequestLogStore } from './kv-store';
export { D1RequestLogStore } from './d1-store';
export { PostgresRequestLogStore } from './postgres-store';
