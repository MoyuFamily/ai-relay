// ============================================================
// AI Relay v2.1 — Request Logs with KV + memory fallback
// ============================================================

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
    .replace(/(api[_-]?key|token|secret|password)=([^\s&]+)/gi, '$1=[REDACTED]')
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

export async function recordRequestLog(input: RequestLogEntry): Promise<void> {
  const entry = sanitizeEntry(input);
  remember(entry);
  const kv = await getKV();
  if (!kv) {
    kvUnavailable = true;
    return;
  }
  try {
    const key = kvKeys.requestLog(entry.traceId);
    const indexKey = kvKeys.requestLogsIndex();
    await Promise.all([
      kv.set(key, entry, { ex: 60 * 60 * 24 * 7 }),
      kv.lpush(indexKey, entry.traceId),
      kv.ltrim(indexKey, 0, 499),
      kv.expire(indexKey, 60 * 60 * 24 * 7),
    ]);
  } catch {
    kvUnavailable = true;
  }
}

export async function listRequestLogs(filters: RequestLogFilters = {}): Promise<RequestLogListResult> {
  const kv = await getKV();
  if (!kv || kvUnavailable) {
    return { items: applyFilters(requestLogStore, filters), degraded: true, source: 'memory' };
  }
  try {
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
    kvUnavailable = false;
  },
  items(): RequestLogEntry[] {
    return [...requestLogStore];
  },
};
