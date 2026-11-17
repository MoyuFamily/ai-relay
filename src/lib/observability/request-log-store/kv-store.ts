// ============================================================
// AI API Relay — KV Request Log Store (Vercel KV & Cloudflare KV)
// ============================================================
// Backs request logs with Vercel KV (on Vercel) or Cloudflare KV via
// CFKVAdapter (on CF Pages). Reuses admin-config's getKV() for environment
// detection and unified access.

import type { RequestLogStore, RequestLogEntry, RequestLogFilters } from './types';
import { getKV } from '@/lib/admin/admin-config';

const PREFIX = 'request_log:';
const CAPTURE_FLAG_KEY = 'request_log_capture_enabled';
const DEFAULT_MAX_ENTRIES = 100;
const PRUNE_INTERVAL = 10; // Prune every N appends instead of every append

async function scanLogKeys(kv: any): Promise<string[]> {
  const seen = new Set<string>();
  let cursor: number | string = 0;
  let guard = 0;

  do {
    const result: [number | string, unknown] = await kv.scan(cursor, { match: `${PREFIX}*`, count: 100 });
    if (!Array.isArray(result) || result.length < 2) break;
    const [nextCursor, batch] = result;
    if (Array.isArray(batch)) {
      for (const item of batch) {
        if (typeof item === 'string' && item.startsWith(PREFIX)) {
          seen.add(item);
        }
      }
    }
    cursor = nextCursor;
    guard++;
  } while (cursor !== 0 && cursor !== '0' && guard < 50);

  return Array.from(seen);
}

export class KVRequestLogStore implements RequestLogStore {
  private defaultMaxEntries: number;
  private appendCount: number = 0;

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

    const kv = await getKV();
    if (!kv) return;

    try {
      // Pad epoch ms to 13 digits so lexicographical key order == chronological order
      const ts = String(Date.now()).padStart(13, '0');
      const key = `${PREFIX}${ts}:${log.traceId}`;
      // Store with 7-day TTL
      await kv.set(key, JSON.stringify(log), { ex: 7 * 24 * 60 * 60 });

      // Prune old entries every PRUNE_INTERVAL appends (or immediately when cap is small)
      this.appendCount++;
      const maxEntries = this.getMaxEntries();
      if (maxEntries <= PRUNE_INTERVAL || this.appendCount % PRUNE_INTERVAL === 0) {
        await this.pruneIfNeeded(kv, maxEntries);
      }
    } catch (err) {
      // Non-critical: log append failures don't block the request
      console.error('[RequestLogStore] append failed:', err);
    }
  }

  async list(filters?: RequestLogFilters): Promise<RequestLogEntry[]> {
    const kv = await getKV();
    if (!kv) return [];

    try {
      const keys = await scanLogKeys(kv);
      if (keys.length === 0) return [];

      // Keys embed zero-padded epoch ms; sort newest-first before reading values
      keys.sort().reverse();

      const hasFieldFilter = Boolean(
        (filters?.status && filters.status !== 'all') || filters?.provider
      );
      const targetKeys =
        !hasFieldFilter && filters?.limit && filters.limit > 0
          ? keys.slice(0, filters.limit)
          : keys;

      // Batch fetch via mget when available (1 Upstash HTTP call instead of N,
      // and concurrency-bounded on CFKVAdapter).
      const values: unknown[] =
        typeof kv.mget === 'function'
          ? await kv.mget(targetKeys)
          : await Promise.all(targetKeys.map((k) => kv.get(k).catch(() => null)));

      let logs: RequestLogEntry[] = values
        .filter((v) => v !== null && v !== undefined)
        .map((v) => {
          try {
            return typeof v === 'string' ? JSON.parse(v) : (v as RequestLogEntry);
          } catch {
            return null;
          }
        })
        .filter((log): log is RequestLogEntry => log !== null && typeof log === 'object');

      // Sort by timestamp DESC (newest first)
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Apply filters
      if (filters?.status && filters.status !== 'all') {
        logs = logs.filter((log) => log.status === filters.status);
      }
      if (filters?.provider) {
        logs = logs.filter((log) => log.provider === filters.provider);
      }
      if (filters?.limit && filters.limit > 0) {
        logs = logs.slice(0, filters.limit);
      }

      return logs;
    } catch (err) {
      console.error('[RequestLogStore] list failed:', err);
      return [];
    }
  }

  async clear(): Promise<void> {
    const kv = await getKV();
    if (!kv) return;

    try {
      const keys = await scanLogKeys(kv);
      if (keys.length > 0) {
        await kv.del(...keys);
      }
      await kv.del(CAPTURE_FLAG_KEY);
      this.appendCount = 0;
    } catch (err) {
      console.error('[RequestLogStore] clear failed:', err);
    }
  }

  async isCaptureEnabled(): Promise<boolean> {
    const kv = await getKV();
    if (!kv) return false;

    try {
      const flag = await kv.get(CAPTURE_FLAG_KEY);
      // Both @vercel/kv and CFKVAdapter auto-deserialize JSON `'1'` into `1`
      return flag === '1' || flag === 1 || flag === true;
    } catch {
      return false;
    }
  }

  async enableCapture(ttlSeconds: number): Promise<void> {
    const kv = await getKV();
    if (!kv) return;

    try {
      await kv.set(CAPTURE_FLAG_KEY, '1', { ex: ttlSeconds });
    } catch (err) {
      console.error('[RequestLogStore] enableCapture failed:', err);
    }
  }

  private async pruneIfNeeded(kv: any, maxEntries = this.getMaxEntries()): Promise<void> {
    try {
      const keys = await scanLogKeys(kv);
      if (keys.length <= maxEntries) return;

      // Sort keys ascending (oldest first) and delete excess
      const sorted = keys.sort();
      const toDelete = sorted.slice(0, keys.length - maxEntries);
      if (toDelete.length > 0) {
        await kv.del(...toDelete);
      }
    } catch {
      // Best-effort pruning
    }
  }
}
