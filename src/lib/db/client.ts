// ============================================================
// AI API Relay — Drizzle & Raw Postgres Client
// ============================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Lazy-initialized Postgres client.
 * Only connects when DATABASE_URL is a valid PostgreSQL connection string.
 * Re-initializes cleanly if DATABASE_URL changes at runtime or in tests.
 */

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _client: postgres.Sql | null = null;
let _currentUrl: string | null = null;

export function isPostgresUrl(url: string | undefined | null): url is string {
  return typeof url === 'string' && /^postgres(ql)?:\/\//i.test(url.trim());
}

export function getPostgresSql(): postgres.Sql {
  const url = process.env.DATABASE_URL?.trim();
  if (!isPostgresUrl(url)) {
    throw new Error(
      'DATABASE_URL is not set to a valid PostgreSQL connection string.'
    );
  }

  if (_client && _currentUrl === url) {
    return _client;
  }

  if (_client && _currentUrl !== url) {
    _client.end({ timeout: 2 }).catch(() => {});
    _client = null;
    _db = null;
  }

  const maxConnections = parseInt(process.env.DATABASE_POOL_MAX || '10', 10);
  _client = postgres(url, {
    max: Number.isFinite(maxConnections) && maxConnections > 0 ? maxConnections : 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // Compatible with both direct Postgres and PgBouncer/Supabase
  });
  _currentUrl = url;
  return _client;
}

export function getDb() {
  const client = getPostgresSql();
  if (_db) return _db;
  _db = drizzle(client, { schema });
  return _db;
}

/**
 * Check if a PostgreSQL database URL is configured.
 */
export function hasDb(): boolean {
  return isPostgresUrl(process.env.DATABASE_URL);
}

/**
 * Get Drizzle database if available, null otherwise.
 */
export function getDbOrNull() {
  if (!hasDb()) return null;
  try {
    return getDb();
  } catch {
    return null;
  }
}

/**
 * Get raw postgres.Sql client if available, null otherwise.
 */
export function getPostgresSqlOrNull(): postgres.Sql | null {
  if (!hasDb()) return null;
  try {
    return getPostgresSql();
  } catch {
    return null;
  }
}

/**
 * Close the database connection (for graceful shutdown / tests).
 */
export async function closeDb() {
  if (_client) {
    await _client.end({ timeout: 5 });
    _client = null;
    _db = null;
    _currentUrl = null;
  }
}
