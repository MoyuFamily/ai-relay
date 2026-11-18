// ============================================================
// AI API Relay — Storage Factory
// ============================================================
// Returns the correct UsageStorage implementation based on
// the current runtime environment:
// 1. Cloudflare Pages/Workers -> D1UsageStorage
// 2. Self-Hosted PostgreSQL -> PostgresUsageStorage
// 3. Vercel KV / Self-Hosted FileKVAdapter / Dev Memory -> KVUsageStorage

import { KVUsageStorage } from './storage/kv-storage';
import { D1UsageStorage } from './storage/d1-usage-storage';
import type { UsageStorage } from './sdk';
import { getCFEnvSync, getCFEnv, isCloudflareSync } from '@/lib/cf-env';

function canUseSelfHostedPostgresUsage(): boolean {
  if (isCloudflareSync()) return false;
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  if (process.env.VERCEL || process.env.CF_PAGES) return false;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return false;
  if (process.env.RELAY_STORAGE_PATH?.trim() || process.env.RELAY_DATA_DIR?.trim()) return false;
  if (process.env.VITEST && process.env.RELAY_ENABLE_POSTGRES_IN_TEST !== '1') return false;
  const url = process.env.DATABASE_URL?.trim() || '';
  return /^postgres(ql)?:\/\//i.test(url);
}

export async function createUsageStorage(): Promise<UsageStorage> {
  const cfEnv = getCFEnvSync() || await getCFEnv();
  if (cfEnv?.DB) {
    return new D1UsageStorage(cfEnv.DB);
  }

  if (canUseSelfHostedPostgresUsage()) {
    const [{ getPostgresSql }, { PostgresUsageStorage }] = await Promise.all([
      import('@/lib/db/client'),
      import('./storage/postgres-usage-storage'),
    ]);
    return new PostgresUsageStorage(getPostgresSql());
  }

  return new KVUsageStorage();
}
