// ============================================================
// AI API Relay — Cloudflare D1 Idempotent Schema Bootstrap
// ============================================================
// Ensures D1 tables & indexes exist on first access per Worker isolate,
// so one-click Cloudflare Workers deployments (`deploy.workers.cloudflare.com`)
// work immediately even before or without manual `wrangler d1 migrations apply`.
// All statements are strictly `IF NOT EXISTS` and match `migrations/0001..0005`.

import type { D1Database } from '@cloudflare/workers-types';

const D1_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS daily_usage (
    date TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    requests INTEGER NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date, provider)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON daily_usage(date)`,
  `CREATE TABLE IF NOT EXISTS quota_counters (
    period TEXT NOT NULL,
    period_type TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (period, period_type)
  )`,
  `CREATE TABLE IF NOT EXISTS error_stats (
    date TEXT NOT NULL,
    provider TEXT NOT NULL,
    status_code TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (date, provider, status_code)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_error_stats_date ON error_stats(date)`,
  `CREATE TABLE IF NOT EXISTS error_key_stats (
    date TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    provider TEXT NOT NULL,
    status_code TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (date, key_hash, status_code)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_error_key_stats_date ON error_key_stats(date)`,
  `CREATE INDEX IF NOT EXISTS idx_error_key_stats_key_hash ON error_key_stats(key_hash)`,
  `CREATE TABLE IF NOT EXISTS request_logs (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    api_key_hash TEXT NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    http_status INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    is_stream INTEGER NOT NULL DEFAULT 0,
    error_type TEXT,
    error_message TEXT,
    diagnostic TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS request_logs_timestamp_idx ON request_logs(timestamp)`,
  `CREATE INDEX IF NOT EXISTS request_logs_status_idx ON request_logs(status)`,
  `CREATE INDEX IF NOT EXISTS request_logs_provider_idx ON request_logs(provider)`,
  `CREATE INDEX IF NOT EXISTS request_logs_trace_id_idx ON request_logs(trace_id)`,
  `CREATE TABLE IF NOT EXISTS config_flags (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

type GlobalWithD1Schema = typeof globalThis & {
  __aiRelayD1SchemaState?: WeakMap<object, Promise<void>>;
  __aiRelayD1IsolateReady?: Promise<void> | null;
};

export async function ensureD1Schema(db: D1Database): Promise<void> {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    return;
  }
  const g = globalThis as GlobalWithD1Schema;

  // Outside unit tests, Cloudflare Workers binds a single D1 database per isolate
  // (though `getCloudflareContext().env.DB` may hand back a new request-scoped
  // proxy wrapper on every request). Cache once per isolate so we never re-run
  // 13 DDL statements on every request and burn D1's 50-queries/request budget.
  if (!process.env.VITEST && g.__aiRelayD1IsolateReady) {
    return g.__aiRelayD1IsolateReady;
  }

  const stateMap = (g.__aiRelayD1SchemaState ??= new WeakMap<object, Promise<void>>());
  const existing = stateMap.get(db as unknown as object);
  if (existing) {
    return existing;
  }

  let initPromise!: Promise<void>;
  initPromise = (async () => {
    try {
      await db.batch(D1_SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
    } catch (err) {
      // Allow retry on transient D1 error rather than caching a rejected promise forever
      stateMap.delete(db as unknown as object);
      if (g.__aiRelayD1IsolateReady === initPromise) {
        g.__aiRelayD1IsolateReady = null;
      }
      throw err;
    }
  })();

  stateMap.set(db as unknown as object, initPromise);
  if (!process.env.VITEST) {
    g.__aiRelayD1IsolateReady = initPromise;
  }
  return initPromise;
}

export function __resetD1SchemaCacheForTests(): void {
  const g = globalThis as GlobalWithD1Schema;
  g.__aiRelayD1SchemaState = new WeakMap<object, Promise<void>>();
  g.__aiRelayD1IsolateReady = null;
}
