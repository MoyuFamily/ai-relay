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
import { shouldUseSelfHostedPostgres } from '@/lib/config/env';
import { ensureD1Schema } from '@/lib/db/d1-schema';

function canUseSelfHostedPostgresUsage(): boolean {
  if (isCloudflareSync()) return false;
  return shouldUseSelfHostedPostgres();
}

export async function createUsageStorage(): Promise<UsageStorage> {
  const cfEnv = getCFEnvSync() || await getCFEnv();
  if (cfEnv?.DB) {
    await ensureD1Schema(cfEnv.DB).catch(() => {});
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
