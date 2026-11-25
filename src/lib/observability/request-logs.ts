// ============================================================
// AI Relay v2.1 — Request Logs (unified storage)
// ============================================================
//
// Request log with unified storage backend (Postgres/KV/D1/Memory).
// Supports on-demand capture: logs are only written when the admin tab is open.
// Configure via env vars:
//   ENABLE_REQUEST_LOGS=true    to enable (default: disabled)
//   REQUEST_LOGS_MAX_ENTRIES=50 max entries per backend (default: varies by backend)

import {
  getDefaultRequestLogStore,
  __resetDefaultRequestLogStore,
  type RequestLogEntry as StoreEntry,
  type RequestLogFilters as StoreFilters,
} from './request-log-store';

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
  source: 'd1' | 'postgres' | 'kv' | 'memory';
}

import { getRuntimeSettings } from '@/lib/admin/runtime-settings';

// ── Configuration ────────────────────────────────────────────
async function isRequestLogsEnabled(): Promise<boolean> {
  const settings = await getRuntimeSettings().catch(() => ({} as { enableRequestLogs?: boolean | null }));
  if (typeof settings.enableRequestLogs === 'boolean') return settings.enableRequestLogs;
  return process.env.ENABLE_REQUEST_LOGS === 'true';
}

const DEFAULT_LIMIT = 50;

// ── Helpers ──────────────────────────────────────────────────

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

function toStoreEntry(entry: RequestLogEntry): StoreEntry {
  return {
    traceId: entry.traceId,
    timestamp: entry.timestamp,
    apiKeyHash: entry.apiKeyHash || '',
    model: entry.model || '',
    provider: entry.provider || '',
    status: entry.status,
    httpStatus: entry.httpStatus,
    latencyMs: entry.latencyMs,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    isStream: entry.isStream,
    errorType: entry.errorType,
    errorMessage: entry.errorMessage,
    diagnostic: entry.diagnostic,
  };
}

function fromStoreEntry(entry: StoreEntry): RequestLogEntry {
  return {
    traceId: entry.traceId,
    timestamp: entry.timestamp,
    apiKeyHash: entry.apiKeyHash || undefined,
    model: entry.model || undefined,
    provider: entry.provider || undefined,
    status: entry.status,
    httpStatus: entry.httpStatus,
    latencyMs: entry.latencyMs,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    totalTokens: entry.totalTokens,
    isStream: entry.isStream,
    errorType: entry.errorType,
    errorMessage: entry.errorMessage,
    diagnostic: entry.diagnostic,
  };
}

function applyTraceIdFilter(items: RequestLogEntry[], traceId?: string): RequestLogEntry[] {
  if (!traceId) return items;
  return items.filter((item) => item.traceId.includes(traceId));
}

// ── Public API ───────────────────────────────────────────────

/**
 * Record a request log entry (persistent backend: Postgres/KV/D1/Memory).
 */
export async function recordRequestLog(input: RequestLogEntry): Promise<void> {
  if (!(await isRequestLogsEnabled())) return;

  const store = getDefaultRequestLogStore();
  const sanitized = sanitizeEntry(input);
  await store.append(toStoreEntry(sanitized));
}

/**
 * List request logs from persistent backend.
 */
export async function listRequestLogs(filters: RequestLogFilters = {}): Promise<RequestLogListResult> {
  if (!(await isRequestLogsEnabled())) {
    return { items: [], degraded: false, source: 'memory' };
  }

  const store = getDefaultRequestLogStore();
  const limit = Math.min(Math.max(filters.limit || DEFAULT_LIMIT, 1), 200);

  const storeFilters: StoreFilters = {
    status: filters.status === 'all' ? undefined : filters.status,
    provider: filters.provider,
    limit,
  };

  const items = await store.list(storeFilters);
  const converted = items.map(fromStoreEntry);

  // Apply client-side traceId filter (not all backends support it natively)
  const filtered = applyTraceIdFilter(converted, filters.traceId);

  // Detect backend type for source label
  const storeName = store.constructor.name;
  const source: RequestLogListResult['source'] = storeName.includes('D1')
    ? 'd1'
    : storeName.includes('Postgres')
      ? 'postgres'
      : storeName.includes('KV')
        ? 'kv'
        : 'memory';

  return { items: filtered, degraded: false, source };
}

/**
 * Enable on-demand capture for a short TTL window (e.g., when admin opens the logs tab).
 */
export async function enableRequestLogCapture(ttlSeconds = 300): Promise<void> {
  if (!(await isRequestLogsEnabled())) return;
  const store = getDefaultRequestLogStore();
  await store.enableCapture(ttlSeconds);
}

/**
 * Check if capture is currently enabled.
 */
export async function isRequestLogCaptureEnabled(): Promise<boolean> {
  if (!(await isRequestLogsEnabled())) return false;
  const store = getDefaultRequestLogStore();
  return await store.isCaptureEnabled();
}

// ── Test helpers ─────────────────────────────────────────────

export const __requestLogStoreForTests = {
  async clear(): Promise<void> {
    const store = getDefaultRequestLogStore();
    await store.clear();
    // Reset the singleton so the next store re-reads env (e.g. stubbed
    // REQUEST_LOGS_MAX_ENTRIES) and starts with capture disabled.
    __resetDefaultRequestLogStore();
  },
  async items(): Promise<RequestLogEntry[]> {
    const result = await listRequestLogs({ limit: 500 });
    return result.items;
  },
};

