// ============================================================
// AI API Relay — Latency Tracker
// ============================================================
// Tracks per-provider latency using a sliding window.
// Data stored in KV (relay:route:latency:{provider}) with in-memory cache.
// Designed for Edge Runtime — uses Web Crypto API compatible patterns.

import type { LatencyRecord, LatencyStats } from './types';
import { getKV } from './kv-client';
import { getCFEnv, getCFEnvSync, isCloudflareSync, runAfterResponse } from '../cf-env';
import { ensureD1Schema } from '../db/d1-schema';

interface SharedLatencyState {
  latencyCache: Map<string, LatencyRecord[]>;
  cacheTimestamps: Map<string, number>;
  lastWriteAt: Map<string, number>;
  dirtyCount: Map<string, number>;
}

const sharedLatencyState: SharedLatencyState = ((globalThis as any).__aiRelayLatencyTrackerState ??= {
  latencyCache: new Map<string, LatencyRecord[]>(),
  cacheTimestamps: new Map<string, number>(),
  lastWriteAt: new Map<string, number>(),
  dirtyCount: new Map<string, number>(),
});

/** In-memory latency cache: provider → records[] (shared across route bundles) */
const latencyCache = sharedLatencyState.latencyCache;

/** Cache TTL */
const CACHE_TTL_MS = 30_000; // 30s
const cacheTimestamps = sharedLatencyState.cacheTimestamps;

/** Write debounce: minimum interval between KV/D1 writes per provider */
const WRITE_INTERVAL_MS = 60_000; // 60s (Redis/Upstash/File/Postgres)
const CF_D1_WRITE_INTERVAL_MS = 120_000; // 2m when persisting to Cloudflare D1
const CF_KV_WRITE_INTERVAL_MS = 10 * 60_000; // 10m fallback when CF has KV-only (1,000 writes/day cap)
const lastWriteAt = sharedLatencyState.lastWriteAt;
/** Dirty record count since last write — flush early if enough accumulate */
const dirtyCount = sharedLatencyState.dirtyCount;
const DIRTY_FLUSH_THRESHOLD = 5;
const CF_D1_DIRTY_FLUSH_THRESHOLD = 20;
const CF_KV_DIRTY_FLUSH_THRESHOLD = 50;

/** Max samples per provider (sliding window) */
const MAX_SAMPLES = 100;

/** KV / D1 config_flags key prefix */
const KV_PREFIX = 'relay:route:latency:';

/** How long to keep samples in KV (24h) */
const KV_TTL_SECONDS = 86400;

/**
 * Get cached latency records for a provider.
 * Returns null if cache is stale or missing.
 */
function getCachedRecords(provider: string): LatencyRecord[] | null {
  const cached = latencyCache.get(provider);
  const ts = cacheTimestamps.get(provider);
  if (cached && ts && Date.now() - ts < CACHE_TTL_MS) {
    return cached;
  }
  return null;
}

/**
 * Load latency records from D1 (on Cloudflare when bound) or KV.
 */
async function loadFromKV(provider: string): Promise<LatencyRecord[]> {
  try {
    if (isCloudflareSync()) {
      const cfEnv = getCFEnvSync() || (await getCFEnv());
      if (cfEnv?.DB) {
        await ensureD1Schema(cfEnv.DB);
        const row = await cfEnv.DB
          .prepare('SELECT value FROM config_flags WHERE key = ?')
          .bind(`${KV_PREFIX}${provider}`)
          .first<{ value?: string }>();
        if (row?.value) {
          const parsed = JSON.parse(row.value);
          if (Array.isArray(parsed)) {
            latencyCache.set(provider, parsed as LatencyRecord[]);
            cacheTimestamps.set(provider, Date.now());
            return parsed as LatencyRecord[];
          }
        }
        return [];
      }
    }

    const kv = await getKV();
    if (!kv) return [];
    const data = await kv.get(`${KV_PREFIX}${provider}`);
    if (Array.isArray(data)) {
      latencyCache.set(provider, data as LatencyRecord[]);
      cacheTimestamps.set(provider, Date.now());
      return data as LatencyRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Save latency records to D1 (on Cloudflare when bound) or KV (debounced).
 * On Cloudflare Workers, avoids burning CF KV's 1,000 writes/day Free Tier limit
 * by persisting into D1 `config_flags` (100,000 rows written/day) via `ctx.waitUntil`,
 * and throttling aggressively if only CF KV is bound.
 */
function saveToKV(provider: string, records: LatencyRecord[]): void {
  const now = Date.now();
  const lastWrite = lastWriteAt.get(provider) || 0;
  const dirty = (dirtyCount.get(provider) || 0) + 1;
  dirtyCount.set(provider, dirty);

  const onCf = isCloudflareSync();
  const cfEnv = onCf ? getCFEnvSync() : null;
  const useCfD1 = Boolean(onCf && cfEnv?.DB);

  const writeInterval = useCfD1
    ? CF_D1_WRITE_INTERVAL_MS
    : onCf
      ? CF_KV_WRITE_INTERVAL_MS
      : WRITE_INTERVAL_MS;
  const dirtyThreshold = useCfD1
    ? CF_D1_DIRTY_FLUSH_THRESHOLD
    : onCf
      ? CF_KV_DIRTY_FLUSH_THRESHOLD
      : DIRTY_FLUSH_THRESHOLD;

  if (now - lastWrite < writeInterval && dirty < dirtyThreshold) return;

  lastWriteAt.set(provider, now);
  dirtyCount.set(provider, 0);

  if (useCfD1 && cfEnv?.DB) {
    const db = cfEnv.DB;
    const serialized = JSON.stringify(records);
    const expiresAt = new Date(now + KV_TTL_SECONDS * 1000).toISOString();
    runAfterResponse(async () => {
      await ensureD1Schema(db);
      await db
        .prepare(
          `INSERT INTO config_flags (key, value, expires_at, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             expires_at = excluded.expires_at,
             updated_at = CURRENT_TIMESTAMP`
        )
        .bind(`${KV_PREFIX}${provider}`, serialized, expiresAt)
        .run();
    });
    return;
  }

  runAfterResponse(async () => {
    const kv: any = await getKV();
    if (kv) {
      await kv.set(`${KV_PREFIX}${provider}`, records, { ex: KV_TTL_SECONDS });
    }
  });
}

/**
 * Record a latency sample for a provider.
 * Updates in-memory cache and asynchronously persists to KV.
 */
export function recordLatency(
  provider: string,
  latencyMs: number,
  success: boolean,
  statusCode?: number
): void {
  const record: LatencyRecord = {
    provider,
    latencyMs,
    timestamp: Date.now(),
    success,
    statusCode,
  };

  let records = latencyCache.get(provider) || [];
  records.push(record);

  // Keep only the most recent MAX_SAMPLES
  if (records.length > MAX_SAMPLES) {
    records = records.slice(records.length - MAX_SAMPLES);
  }

  latencyCache.set(provider, records);
  cacheTimestamps.set(provider, Date.now());

  // Async persist to KV
  saveToKV(provider, records);
}

/**
 * Get latency stats for a provider.
 * Uses cache first, falls back to KV, returns empty stats if nothing found.
 */
export async function getLatencyStats(provider: string): Promise<LatencyStats> {
  let records = getCachedRecords(provider);
  if (!records) {
    records = await loadFromKV(provider);
  }

  if (records.length === 0) {
    return {
      provider,
      avgLatencyMs: Infinity,
      p50LatencyMs: Infinity,
      p95LatencyMs: Infinity,
      sampleCount: 0,
      lastUpdated: 0,
    };
  }

  // Only consider successful requests for latency stats
  const successRecords = records.filter((r) => r.success);
  if (successRecords.length === 0) {
    return {
      provider,
      avgLatencyMs: Infinity,
      p50LatencyMs: Infinity,
      p95LatencyMs: Infinity,
      sampleCount: 0,
      lastUpdated: records[records.length - 1].timestamp,
    };
  }

  const latencies = successRecords.map((r) => r.latencyMs).sort((a, b) => a - b);
  const avg = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  return {
    provider,
    avgLatencyMs: Math.round(avg),
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    sampleCount: successRecords.length,
    lastUpdated: records[records.length - 1].timestamp,
  };
}

/**
 * Get all latency stats (for admin dashboard).
 */
export async function getAllLatencyStats(): Promise<Record<string, LatencyStats>> {
  try {
    if (isCloudflareSync()) {
      const cfEnv = getCFEnvSync() || (await getCFEnv());
      if (cfEnv?.DB) {
        await ensureD1Schema(cfEnv.DB);
        const rows = await cfEnv.DB
          .prepare('SELECT key FROM config_flags WHERE key LIKE ?')
          .bind(`${KV_PREFIX}%`)
          .all();
        const stats: Record<string, LatencyStats> = {};
        for (const row of (rows.results || []) as Array<{ key?: string }>) {
          if (typeof row.key === 'string' && row.key.startsWith(KV_PREFIX)) {
            const provider = row.key.slice(KV_PREFIX.length);
            stats[provider] = await getLatencyStats(provider);
          }
        }
        return stats;
      }
    }

    const kv = await getKV();
    if (!kv) return {};

    const keys: string[] = [];
    let cursor: string | number = 0;
    do {
      const result: [string | number, string[]] = await kv.scan(cursor, { match: `${KV_PREFIX}*`, count: 100 });
      keys.push(...result[1]);
      cursor = result[0];
    } while (cursor !== 0 && cursor !== '0');

    const stats: Record<string, LatencyStats> = {};
    for (const key of keys) {
      const provider = key.replace(KV_PREFIX, '');
      stats[provider] = await getLatencyStats(provider);
    }

    return stats;
  } catch {
    return {};
  }
}

/**
 * Get success rate for a provider from recent samples.
 */
export async function getSuccessRate(provider: string): Promise<number> {
  let records = getCachedRecords(provider);
  if (!records) {
    records = await loadFromKV(provider);
  }

  if (records.length === 0) return 1; // Assume healthy if no data

  const recentRecords = records.slice(-20); // Last 20 samples
  const successCount = recentRecords.filter((r) => r.success).length;
  return successCount / recentRecords.length;
}
