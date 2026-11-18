// ============================================================
// AI API Relay — Self-Hosted PostgreSQL Auto-Bootstrap Schema
// ============================================================
// Idempotently provisions all required self-hosted tables on first use
// so `docker compose up` or VPS deployments with `DATABASE_URL=postgres://...`
// work immediately out of the box without manual migration steps.

import type postgres from 'postgres';

const initializedClients = new WeakSet<object>();
const inflightInit = new WeakMap<object, Promise<void>>();

const BOOTSTRAP_DDL = `
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kv_store_expires_at ON kv_store(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS daily_usage (
  date TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  requests INTEGER NOT NULL DEFAULT 0,
  tokens BIGINT NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (date, provider)
);

CREATE INDEX IF NOT EXISTS idx_pg_daily_usage_date ON daily_usage(date);

CREATE TABLE IF NOT EXISTS key_usage (
  key_hash TEXT NOT NULL,
  period TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (key_hash, period)
);

CREATE TABLE IF NOT EXISTS quota_counters (
  period TEXT NOT NULL,
  period_type TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period, period_type)
);

CREATE TABLE IF NOT EXISTS error_stats (
  date TEXT NOT NULL,
  provider TEXT NOT NULL,
  status_code TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (date, provider, status_code)
);

CREATE INDEX IF NOT EXISTS idx_pg_error_stats_date ON error_stats(date);

CREATE TABLE IF NOT EXISTS error_key_stats (
  date TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  status_code TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (date, key_hash, status_code)
);

CREATE INDEX IF NOT EXISTS idx_pg_error_key_stats_date ON error_key_stats(date);
CREATE INDEX IF NOT EXISTS idx_pg_error_key_stats_hash ON error_key_stats(key_hash);

CREATE TABLE IF NOT EXISTS request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS request_logs_timestamp_idx ON request_logs(timestamp);
CREATE INDEX IF NOT EXISTS request_logs_status_idx ON request_logs(status);
CREATE INDEX IF NOT EXISTS request_logs_provider_idx ON request_logs(provider);
CREATE INDEX IF NOT EXISTS request_logs_trace_id_idx ON request_logs(trace_id);

CREATE TABLE IF NOT EXISTS config_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function ensureSelfHostedPostgresSchema(sqlClient: postgres.Sql): Promise<void> {
  const key = sqlClient as unknown as object;
  if (initializedClients.has(key)) return;

  const existing = inflightInit.get(key);
  if (existing) {
    await existing;
    return;
  }

  const initTask = (async () => {
    try {
      await sqlClient.unsafe(BOOTSTRAP_DDL);
      initializedClients.add(key);
    } finally {
      inflightInit.delete(key);
    }
  })();

  inflightInit.set(key, initTask);
  await initTask;
}
