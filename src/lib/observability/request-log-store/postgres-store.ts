// ============================================================
// AI API Relay — Postgres Request Log Store
// ============================================================
// Backs request logs with Postgres via Drizzle ORM. Used for VPS/self-hosted
// deployments where DATABASE_URL is set.

import type { RequestLogStore, RequestLogEntry, RequestLogFilters } from './types';
import { getDbOrNull, getPostgresSqlOrNull } from '@/lib/db/client';
import { ensureSelfHostedPostgresSchema } from '@/lib/db/self-hosted-schema';
import { requestLogs } from '@/lib/db/schema';
import { desc, eq, and, sql } from 'drizzle-orm';

const DEFAULT_MAX_ENTRIES = 500;

async function ensureReadyDb() {
  const sqlClient = getPostgresSqlOrNull();
  if (sqlClient) {
    await ensureSelfHostedPostgresSchema(sqlClient);
  }
  return getDbOrNull();
}

export class PostgresRequestLogStore implements RequestLogStore {
  readonly source = 'postgres' as const;
  private maxEntries: number;

  constructor() {
    const userMax = parseInt(process.env.REQUEST_LOGS_MAX_ENTRIES || '', 10);
    this.maxEntries = isNaN(userMax) ? DEFAULT_MAX_ENTRIES : userMax;
  }

  async append(log: RequestLogEntry): Promise<void> {
    if (!(await this.isCaptureEnabled())) return;

    try {
      const db = await ensureReadyDb();
      if (!db) return;
      await db.insert(requestLogs).values({
        traceId: log.traceId,
        timestamp: new Date(log.timestamp),
        apiKeyHash: log.apiKeyHash,
        model: log.model,
        provider: log.provider,
        status: log.status,
        httpStatus: log.httpStatus,
        latencyMs: log.latencyMs,
        promptTokens: log.promptTokens ?? null,
        completionTokens: log.completionTokens ?? null,
        totalTokens: log.totalTokens ?? null,
        isStream: log.isStream ? 1 : 0,
        errorType: log.errorType ?? null,
        errorMessage: log.errorMessage ?? null,
        diagnostic: log.diagnostic ?? null,
      });

      // Prune old entries if we exceed maxEntries
      await this.pruneIfNeeded(db);
    } catch (err) {
      // Non-critical: log append failures don't block the request
      console.error('[PostgresRequestLogStore] append failed:', err);
    }
  }

  async list(filters?: RequestLogFilters): Promise<RequestLogEntry[]> {
    try {
      const db = await ensureReadyDb();
      if (!db) return [];
      const conditions = [];
      if (filters?.status && filters.status !== 'all') {
        conditions.push(eq(requestLogs.status, filters.status));
      }
      if (filters?.provider) {
        conditions.push(eq(requestLogs.provider, filters.provider));
      }

      const limit = filters?.limit && filters.limit > 0 ? filters.limit : 100;

      const rows = await db
        .select()
        .from(requestLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(requestLogs.timestamp))
        .limit(limit);

      return rows.map((row) => ({
        traceId: row.traceId,
        timestamp: row.timestamp.toISOString(),
        apiKeyHash: row.apiKeyHash,
        model: row.model,
        provider: row.provider,
        status: row.status as 'success' | 'error',
        httpStatus: row.httpStatus,
        latencyMs: row.latencyMs,
        promptTokens: row.promptTokens ?? undefined,
        completionTokens: row.completionTokens ?? undefined,
        totalTokens: row.totalTokens ?? undefined,
        isStream: row.isStream === 1,
        errorType: row.errorType ?? undefined,
        errorMessage: row.errorMessage ?? undefined,
        diagnostic: row.diagnostic ?? undefined,
      }));
    } catch (err) {
      console.error('[PostgresRequestLogStore] list failed:', err);
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await ensureReadyDb();
      if (!db) return;
      await db.delete(requestLogs);
    } catch (err) {
      console.error('[PostgresRequestLogStore] clear failed:', err);
    }
  }

  async isCaptureEnabled(): Promise<boolean> {
    try {
      const db = await ensureReadyDb();
      if (!db) return false;
      const { configFlags } = await import('../../db/schema');
      const { eq, and, gt, sql } = await import('drizzle-orm');

      const flag = await db
        .select()
        .from(configFlags)
        .where(
          and(
            eq(configFlags.key, 'request_logs_capture_enabled'),
            gt(configFlags.expiresAt, sql`NOW()`)
          )
        )
        .limit(1);

      return flag.length > 0 && flag[0].value === '1';
    } catch {
      return false;
    }
  }

  async enableCapture(ttlSeconds: number): Promise<void> {
    try {
      const db = await ensureReadyDb();
      if (!db) return;
      const { configFlags } = await import('../../db/schema');
      const { sql } = await import('drizzle-orm');

      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      // Upsert the flag
      await db.execute(sql`
        INSERT INTO config_flags (key, value, expires_at, updated_at)
        VALUES ('request_logs_capture_enabled', '1', ${expiresAt}, NOW())
        ON CONFLICT (key) DO UPDATE
        SET value = '1', expires_at = ${expiresAt}, updated_at = NOW()
      `);
    } catch (err) {
      console.error('[PostgresRequestLogStore] enableCapture failed:', err);
    }
  }

  private async pruneIfNeeded(db: any): Promise<void> {
    try {
      // Count total entries
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(requestLogs);

      if (count <= this.maxEntries) return;

      // Delete oldest entries beyond maxEntries
      const toDelete = count - this.maxEntries;
      await db.execute(sql`
        DELETE FROM ${requestLogs}
        WHERE id IN (
          SELECT id FROM ${requestLogs}
          ORDER BY timestamp ASC
          LIMIT ${toDelete}
        )
      `);
    } catch {
      // Best-effort pruning
    }
  }
}
