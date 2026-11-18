// ============================================================
// AI API Relay — Config Store Factory
// ============================================================

import type { ConfigStore } from './types';
import { VercelKVConfigStore } from './vercel-kv-store';
import { PostgresConfigStore } from './postgres-store';
import { isCloudflareSync } from '../cf-env';

let _overrideStore: ConfigStore | null = null;
let _kvStore: VercelKVConfigStore | null = null;
let _pgStore: PostgresConfigStore | null = null;

/**
 * Select the ConfigStore dynamically per call (matching RequestLogStore):
 * - Test/CLI override takes precedence when set via setDefaultConfigStore().
 * - Cloudflare runtime (detected via request-scoped CF context) -> KV store.
 * - Vercel or explicit KV_REST_API_URL -> KV store.
 * - Standalone Postgres server (DATABASE_URL without KV/Vercel/CF, outside dev/test mock) -> Postgres store.
 * - Default -> VercelKVConfigStore (uses CF KV / Vercel KV / dev mock / graceful static fallback).
 */
export function getDefaultConfigStore(): ConfigStore {
  if (_overrideStore) return _overrideStore;

  if (isCloudflareSync() || process.env.VERCEL || process.env.CF_PAGES || process.env.KV_REST_API_URL) {
    return (_kvStore ??= new VercelKVConfigStore());
  }

  if (
    process.env.DATABASE_URL &&
    process.env.NODE_ENV !== 'test' &&
    process.env.NODE_ENV !== 'development'
  ) {
    return (_pgStore ??= new PostgresConfigStore());
  }

  return (_kvStore ??= new VercelKVConfigStore());
}

export function setDefaultConfigStore(store: ConfigStore | null): void {
  _overrideStore = store;
}

export function __resetDefaultConfigStore(): void {
  _overrideStore = null;
  _kvStore = null;
  _pgStore = null;
}

export * from './types';
