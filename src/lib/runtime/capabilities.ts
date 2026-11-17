// ============================================================
// AI Relay — Runtime Capabilities
// ============================================================

import { isCloudflareSync } from '../cf-env';

export interface RuntimeCapabilities {
  runtime: 'vercel' | 'cloudflare' | 'local' | 'server';
  persistentProcess: boolean;
  publicEndpoint: boolean;
  localAgentSetup: boolean;
  storage: 'kv' | 'd1' | 'sqlite' | 'postgres';
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

  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://')) {
    return {
      runtime: 'server',
      persistentProcess: true,
      publicEndpoint: true,
      localAgentSetup: false,
      storage: 'postgres',
    };
  }

  // Local CLI / standalone Node process
  return {
    runtime: 'local',
    persistentProcess: true,
    publicEndpoint: false,
    localAgentSetup: true,
    storage: 'sqlite',
  };
}
