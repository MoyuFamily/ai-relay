// ============================================================
// AI Relay — Runtime Capabilities
// ============================================================

import { isCloudflareSync } from '../cf-env';
import { getRedisRestConfig, shouldUseSelfHostedPostgres } from '../config/env';

export interface RuntimeCapabilities {
  runtime: 'vercel' | 'cloudflare' | 'local' | 'server';
  persistentProcess: boolean;
  publicEndpoint: boolean;
  localAgentSetup: boolean;
  storage: 'kv' | 'd1' | 'sqlite' | 'postgres' | 'file';
}

export function detectRuntime(): RuntimeCapabilities {
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    return {
      runtime: 'vercel',
      persistentProcess: false,
      publicEndpoint: true,
      localAgentSetup: false,
      storage: 'kv',
    };
  }

  // Detect Cloudflare via request-scoped OpenNext context at runtime,
  // falling back to CF_PAGES during Cloudflare Pages build steps.
  if (isCloudflareSync() || process.env.CF_PAGES) {
    return {
      runtime: 'cloudflare',
      persistentProcess: false,
      publicEndpoint: true,
      localAgentSetup: false,
      storage: 'd1',
    };
  }

  if (shouldUseSelfHostedPostgres()) {
    return {
      runtime: 'server',
      persistentProcess: true,
      publicEndpoint: true,
      localAgentSetup: false,
      storage: 'postgres',
    };
  }

  if (
    process.env.RELAY_STORAGE_PATH ||
    process.env.RELAY_DATA_DIR ||
    process.env.NODE_ENV === 'production'
  ) {
    return {
      runtime: 'server',
      persistentProcess: true,
      publicEndpoint: true,
      localAgentSetup: false,
      storage: getRedisRestConfig() ? 'kv' : 'file',
    };
  }

  // Local CLI / standalone dev process
  return {
    runtime: 'local',
    persistentProcess: true,
    publicEndpoint: false,
    localAgentSetup: true,
    storage: 'sqlite',
  };
}
