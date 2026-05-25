// ============================================================
// AI Relay v2.1 — Request Logs with KV + memory fallback
// ============================================================
//
// Optimization: entries are buffered in memory and flushed to KV
// in batches via pipeline, reducing per-request KV commands from 4 to ~0.

import { kvKeys } from '@/lib/usage/storage/kv-keys';

export type RequestLogStatus = 'success' | 'error';

export interface RequestLogEntry {
  traceId: string;
  timestamp: string;
  apiKeyHash?: string;
  model?: string;
  provider?: string;
  status: RequestLogStatus;
  httpStatus: number;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  isStream?: boolean;
  errorType?: string;
  errorMessage?: string;
  diagnostic?: string;
}

export interface RequestLogFilters {
  provider?: string;
  status?: RequestLogStatus | 'all';
  traceId?: string;
  limit?: number;
}

export interface RequestLogListResult {
  items: RequestLogEntry[];
  degraded: boolean;
  source: 'kv' | 'memory';
}

const MAX_MEMORY_LOGS = 500;
const DEFAULT_LIMIT = 50;
const requestLogStore: RequestLogEntry[] = [];
let kvUnavailable = false;

// ── Batch buffer for KV writes ──────────────────────────────
const FLUSH_INTERVAL_MS = 30_000; // flush every 30s
const FLUSH_BATCH_SIZE = 50;      // or when buffer hits 50 entries
const _pendingLogs: RequestLogEntry[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _flushInFlight = false;

async function getKV(): Promise<any | null> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    const mod = await import('@vercel/kv');
    return mod.kv || mod.createClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
  } catch {
    return null;
  }
}

export function sanitizeDiagnosticText(input?: string): string | undefined {
  if (!input) return input;
  return input
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9._-]{6,}/g, '[REDACTED]')
    .replace(/(api[_-]?key|token|secret|password)=([^&]+)/gi, '$1=[REDACTED]')
    .replace(/\*{3,}/g, '[REDACTED]')
    .slice(0, 1200);
}

function sanitizeEntry(entry: RequestLogEntry): RequestLogEntry {
  return {
    ...entry,
    apiKeyHash: entry.apiKeyHash ? entry.apiKeyHash.slice(0, 12) : undefined,
    errorMessage: sanitizeDiagnosticText(entry.errorMessage),
    diagnostic: sanitizeDiagnosticText(entry.diagnostic),
  };
}

function applyFilters(items: RequestLogEntry[], filters: RequestLogFilters = {}): RequestLogEntry[] {
  const limit = Math.min(Math.max(filters.limit || DEFAULT_LIMIT, 1), 200);
  return items
    .filter((item) => !filters.status || filters.status === 'all' || item.status === filters.status)
    .filter((item) => !filters.provider || item.provider === filters.provider)
    .filter((item) => !filters.traceId || item.traceId.includes(filters.traceId))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

function remember(entry: RequestLogEntry): void {
  requestLogStore.unshift(entry);
  if (requestLogStore.length > MAX_MEMORY_LOGS) requestLogStore.length = MAX_MEMORY_LOGS;
}

/**
 * Flush pending log entries to KV in a single pipeline call.
 * This replaces the old per-request 4-command KV write pattern.
 */
async function flushPendingLogs(): Promise<void> {
  if (_flushInFlight || _pendingLogs.length === 0 || kvUnavailable) return;
  _flushInFlight = true;

  const batch = _pendingLogs.splice(0, FLUSH_BATCH_SIZE);
  try {
    const kv = await getKV();
    if (!kv) {
      kvUnavailable = true;
      // Re-add entries back so they aren't lost (best-effort)
      _pendingLogs.unshift(...batch);
      return;
    }

    const indexKey = kvKeys.requestLogsIndex();
    const p = kv.pipeline();

    for (const entry of batch) {
      const key = kvKeys.requestLog(entry.traceId);
      p.set(key, entry, { ex: 60 * 60 * 24 * 7 });
    }
    // Push all trace IDs to the index in one go
    for (const entry of batch) {
      p.lpush(indexKey, entry.traceId);
    }
    // Single trim + expire for the index
    p.ltrim(indexKey, 0, 499);
    p.expire(indexKey, 60 * 60 * 24 * 7);

    await p.exec();
  } catch {
    kvUnavailable = true;
    // Re-add on failure
    _pendingLogs.unshift(...batch);
  } finally {
    _flushInFlight = false;
  }
}

function ensureFlushTimer(): void {
  if (_flushTimer) return;
  _flushTimer = setInterval(() => {
    flushPendingLogs().catch(() => {});
  }, FLUSH_INTERVAL_MS);
  // Don't prevent Node from exiting
  if (_flushTimer && typeof _flushTimer === 'object' && 'unref' in _flushTimer) {
    _flushTimer.unref();
  }
}

/**
 * Record a request log entry.
 * Writes to memory immediately; buffers for KV batch flush.
 * Previously: 4 KV commands per request. Now: 0 KV commands per request (deferred to batch).
 */
export async function recordRequestLog(input: RequestLogEntry): Promise<void> {
  const entry = sanitizeEntry(input);
  remember(entry);

  // Buffer for batched KV write
  _pendingLogs.push(entry);
  ensureFlushTimer();

  // If buffer is large enough, trigger an immediate flush (don't await)
  if (_pendingLogs.length >= FLUSH_BATCH_SIZE) {
    flushPendingLogs().catch(() => {});
  }
}

export async function listRequestLogs(filters: RequestLogFilters = {}): Promise<RequestLogListResult> {
  const kv = await getKV();
  if (!kv || kvUnavailable) {
    return { items: applyFilters(requestLogStore, filters), degraded: true, source: 'memory' };
  }
  try {
    // Flush pending before reading to ensure consistency
    await flushPendingLogs();

    const ids: string[] = await kv.lrange(kvKeys.requestLogsIndex(), 0, 499);
    const entries = (await Promise.all(ids.map((id) => kv.get(kvKeys.requestLog(id)))))
      .filter(Boolean) as RequestLogEntry[];
    return { items: applyFilters(entries, filters), degraded: false, source: 'kv' };
  } catch {
    kvUnavailable = true;
    return { items: applyFilters(requestLogStore, filters), degraded: true, source: 'memory' };
  }
}

export const __requestLogStoreForTests = {
  clear(): void {
    requestLogStore.length = 0;
    _pendingLogs.length = 0;
    kvUnavailable = false;
    if (_flushTimer) {
      clearInterval(_flushTimer);
      _flushTimer = null;
    }
  },
  items(): RequestLogEntry[] {
    return [...requestLogStore];
  },
  pendingCount(): number {
    return _pendingLogs.length;
  },
  async forceFlush(): Promise<void> {
    await flushPendingLogs();
  },
};
