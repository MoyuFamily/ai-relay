// ============================================================
// AI API Relay — Cloudflare D1 Request Log Store
// ============================================================
// Backs request logs with Cloudflare D1 (`request_logs` & `config_flags`)
// instead of CF KV so logging uses D1's 100,000 rows written/day Free Tier
// budget rather than CF KV's 1,000 writes/deletes/lists per day limit.
//
// Resolves D1 per call via `getCFEnvSync()` / `getCFEnv()` to respect
// workerd's request-scoped AsyncLocalStorage isolation.

import type { D1Database } from '@cloudflare/workers-types';
import type { RequestLogStore, RequestLogEntry, RequestLogFilters } from './types';
import { getCFEnv, getCFEnvSync } from '@/lib/cf-env';
import { ensureD1Schema } from '@/lib/db/d1-schema';

const CAPTURE_FLAG_KEY = 'request_logs_capture_enabled';
const DEFAULT_MAX_ENTRIES = 200;
const PRUNE_INTERVAL = 10;
const CAPTURE_CACHE_TTL_MS = 15_000;

async function getD1(): Promise<D1Database | null> {
  const cfEnv = getCFEnvSync() || (await getCFEnv());
  if (!cfEnv?.DB) return null;
  await ensureD1Schema(cfEnv.DB);
  return cfEnv.DB;
}

export class D1RequestLogStore implements RequestLogStore {
  readonly source = 'd1' as const;
  private defaultMaxEntries: number;
  private appendCount = 0;
  private captureCache: { enabled: boolean; expiresAt: number } | null = null;

  constructor() {
    const userMax = parseInt(process.env.REQUEST_LOGS_MAX_ENTRIES || '', 10);
    this.defaultMaxEntries = isNaN(userMax) ? DEFAULT_MAX_ENTRIES : Math.max(1, userMax);
  }

  private getMaxEntries(): number {
    const userMax = parseInt(process.env.REQUEST_LOGS_MAX_ENTRIES || '', 10);
    return isNaN(userMax) ? this.defaultMaxEntries : Math.max(1, userMax);
  }

  async append(log: RequestLogEntry): Promise<void> {
    if (!(await this.isCaptureEnabled())) return;

    try {
      const db = await getD1();
      if (!db) return;

      const id = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      await db
        .prepare(
          `INSERT INTO request_logs (
            id, trace_id, timestamp, api_key_hash, model, provider, status,
            http_status, latency_ms, prompt_tokens, completion_tokens, total_tokens,
            is_stream, error_type, error_message, diagnostic
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          log.traceId,
          log.timestamp,
          log.apiKeyHash || '',
          log.model || '',
          log.provider || '',
          log.status,
          log.httpStatus,
          log.latencyMs,
          log.promptTokens ?? null,
          log.completionTokens ?? null,
          log.totalTokens ?? null,
          log.isStream ? 1 : 0,
          log.errorType ?? null,
          log.errorMessage ?? null,
          log.diagnostic ?? null
        )
        .run();

      this.appendCount++;
      const maxEntries = this.getMaxEntries();
      if (maxEntries <= PRUNE_INTERVAL || this.appendCount % PRUNE_INTERVAL === 0) {
        await this.pruneIfNeeded(db, maxEntries);
      }
    } catch (err) {
      // Non-critical: log append failures don't block the request
      console.error('[D1RequestLogStore] append failed:', err);
    }
  }

  async list(filters?: RequestLogFilters): Promise<RequestLogEntry[]> {
    try {
      const db = await getD1();
      if (!db) return [];

      const conditions: string[] = [];
      const bindings: unknown[] = [];

      if (filters?.status && filters.status !== 'all') {
        conditions.push('status = ?');
        bindings.push(filters.status);
      }
      if (filters?.provider) {
        conditions.push('provider = ?');
        bindings.push(filters.provider);
      }

      const limit = filters?.limit && filters.limit > 0 ? Math.min(filters.limit, 200) : 100;
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const sql = `SELECT trace_id, timestamp, api_key_hash, model, provider, status,
        http_status, latency_ms, prompt_tokens, completion_tokens, total_tokens,
        is_stream, error_type, error_message, diagnostic
        FROM request_logs ${whereClause}
        ORDER BY timestamp DESC
        LIMIT ?`;

      const rows = await db
        .prepare(sql)
        .bind(...bindings, limit)
        .all();

      return ((rows.results || []) as Array<Record<string, unknown>>).map((row) => ({
        traceId: String(row.trace_id || ''),
        timestamp: String(row.timestamp || ''),
        apiKeyHash: String(row.api_key_hash || ''),
        model: String(row.model || ''),
        provider: String(row.provider || ''),
        status: (row.status === 'error' ? 'error' : 'success') as 'success' | 'error',
        httpStatus: Number(row.http_status || 0),
        latencyMs: Number(row.latency_ms || 0),
        promptTokens: row.prompt_tokens !== null && row.prompt_tokens !== undefined ? Number(row.prompt_tokens) : undefined,
        completionTokens: row.completion_tokens !== null && row.completion_tokens !== undefined ? Number(row.completion_tokens) : undefined,
        totalTokens: row.total_tokens !== null && row.total_tokens !== undefined ? Number(row.total_tokens) : undefined,
        isStream: Number(row.is_stream || 0) === 1,
        errorType: typeof row.error_type === 'string' ? row.error_type : undefined,
        errorMessage: typeof row.error_message === 'string' ? row.error_message : undefined,
        diagnostic: typeof row.diagnostic === 'string' ? row.diagnostic : undefined,
      }));
    } catch (err) {
      console.error('[D1RequestLogStore] list failed:', err);
      return [];
    }
  }

  async clear(): Promise<void> {
    this.captureCache = { enabled: false, expiresAt: Date.now() + CAPTURE_CACHE_TTL_MS };
    this.appendCount = 0;
    try {
      const db = await getD1();
      if (!db) return;
      await db.batch([
        db.prepare('DELETE FROM request_logs'),
        db.prepare('DELETE FROM config_flags WHERE key = ?').bind(CAPTURE_FLAG_KEY),
      ]);
    } catch (err) {
      console.error('[D1RequestLogStore] clear failed:', err);
    }
  }

  async isCaptureEnabled(): Promise<boolean> {
    const now = Date.now();
    if (this.captureCache && now < this.captureCache.expiresAt) {
      return this.captureCache.enabled;
    }

    try {
      const db = await getD1();
      if (!db) return false;

      const row = await db
        .prepare('SELECT value, expires_at FROM config_flags WHERE key = ?')
        .bind(CAPTURE_FLAG_KEY)
        .first<{ value?: string; expires_at?: string | null }>();

      let enabled = false;
      let cacheExpiry = now + CAPTURE_CACHE_TTL_MS;
      if (row && row.value === '1') {
        if (!row.expires_at) {
          enabled = true;
        } else {
          const expMs = Date.parse(row.expires_at);
          if (Number.isFinite(expMs) && expMs > now) {
            enabled = true;
            cacheExpiry = Math.min(cacheExpiry, expMs);
          }
        }
      }
      this.captureCache = { enabled, expiresAt: cacheExpiry };
      return enabled;
    } catch {
      return false;
    }
  }

  async enableCapture(ttlSeconds: number): Promise<void> {
    const now = Date.now();
    const expiresAtMs = now + Math.max(1, ttlSeconds) * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    this.captureCache = {
      enabled: true,
      expiresAt: Math.min(now + CAPTURE_CACHE_TTL_MS, expiresAtMs),
    };

    try {
      const db = await getD1();
      if (!db) return;
      await db
        .prepare(
          `INSERT INTO config_flags (key, value, expires_at, updated_at)
           VALUES (?, '1', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET
             value = '1',
             expires_at = excluded.expires_at,
             updated_at = CURRENT_TIMESTAMP`
        )
        .bind(CAPTURE_FLAG_KEY, expiresAtIso)
        .run();
    } catch (err) {
      console.error('[D1RequestLogStore] enableCapture failed:', err);
    }
  }

  private async pruneIfNeeded(db: D1Database, maxEntries: number): Promise<void> {
    try {
      // Keep only the newest `maxEntries` rows (indexed by timestamp).
      await db
        .prepare(
          `DELETE FROM request_logs
           WHERE id IN (
             SELECT id FROM request_logs
             ORDER BY timestamp DESC
             LIMIT -1 OFFSET ?
           )`
        )
        .bind(maxEntries)
        .run();
    } catch {
      // Best-effort pruning
    }
  }
}
