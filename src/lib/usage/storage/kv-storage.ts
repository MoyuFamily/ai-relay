// ============================================================
// AI API Relay — KV-backed Usage Storage (Vercel KV)
// ============================================================

import type {
  UsageStorage,
  UsageEvent,
  TrendPoint,
  ProviderTrendPoint,
  QuotaStatus,
} from '../sdk';
import { withTimeout } from '@/lib/utils/timeout';
import { getAllProviders } from '@/lib/providers';
import type { DailyReportData } from '@/lib/webhooks/types';
import { kvKeys } from './kv-keys';
import { getLegacyKeyUsage } from './legacy-key-usage';
import { isCloudflareSync } from '@/lib/cf-env';
import { getCachedRuntimeSettingsSync } from '@/lib/admin/runtime-settings';

function getBeijingDate(d: Date = new Date()): Date {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000);
}

function today(): string {
  return getBeijingDate().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return getBeijingDate().toISOString().slice(0, 7);
}

function dateRange(days: number): string[] {
  const dates: string[] = [];
  const nowBeijing = getBeijingDate();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(nowBeijing);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function previousDate(date: string): string {
  return new Date(new Date(date + 'T00:00:00Z').getTime() - 86400000)
    .toISOString()
    .slice(0, 10);
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / 86400000) + 1;
  const weekNum = Math.ceil((dayOfYear + jan4.getDay()) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonthLabel(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function aggregatePoints(points: TrendPoint[], labelFn: (date: string) => string): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>();
  for (const p of points) {
    const label = labelFn(p.date);
    const existing = buckets.get(label);
    if (existing) {
      existing.requests += p.requests;
      existing.promptTokens += p.promptTokens;
      existing.completionTokens += p.completionTokens;
      existing.totalTokens += p.totalTokens;
    } else {
      buckets.set(label, {
        date: label,
        requests: p.requests,
        promptTokens: p.promptTokens,
        completionTokens: p.completionTokens,
        totalTokens: p.totalTokens,
      });
    }
  }
  return Array.from(buckets.values());
}

function parseDailyPoint(date: string, raw: Record<string, unknown> | null): TrendPoint {
  return {
    date,
    requests: Number(raw?.requests || 0),
    promptTokens: Number(raw?.promptTokens || 0),
    completionTokens: Number(raw?.completionTokens || 0),
    totalTokens: Number(raw?.tokens || 0),
  };
}

async function getKV() {
  // Cloudflare Pages: usage is handled by D1UsageStorage, not this file.
  // Return null so KVUsageStorage gracefully no-ops on CF.
  if (isCloudflareSync()) return null;

  const { getKV: getSharedKV } = await import('@/lib/admin/admin-config');
  return getSharedKV();
}

interface AdminCacheEntry {
  data: unknown;
  expiresAt: number;
}

const _adminCache = new Map<string, AdminCacheEntry>();
const ADMIN_CACHE_TTL_MS = 30_000;
const TREND_CACHE_TTL_MS = 120_000;
const QUOTA_CACHE_TTL_MS = 30_000;
const ADMIN_CACHE_CLEANUP_INTERVAL_MS = 60_000;
const ADMIN_CACHE_MAX_ENTRIES = 500;
let lastAdminCacheCleanup = 0;

function pruneAdminCache(now = Date.now(), force = false): void {
  if (
    !force &&
    now - lastAdminCacheCleanup < ADMIN_CACHE_CLEANUP_INTERVAL_MS &&
    _adminCache.size <= ADMIN_CACHE_MAX_ENTRIES
  ) {
    return;
  }

  lastAdminCacheCleanup = now;
  for (const [key, entry] of _adminCache.entries()) {
    if (now >= entry.expiresAt) {
      _adminCache.delete(key);
    }
  }

  if (_adminCache.size <= ADMIN_CACHE_MAX_ENTRIES) return;

  const overflow = _adminCache.size - ADMIN_CACHE_MAX_ENTRIES;
  let removed = 0;
  for (const key of _adminCache.keys()) {
    _adminCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function getCached<T>(key: string): T | null {
  const now = Date.now();
  const entry = _adminCache.get(key);
  if (entry) {
    if (now < entry.expiresAt) {
      pruneAdminCache(now);
      return entry.data as T;
    }
    _adminCache.delete(key);
  }
  pruneAdminCache(now);
  return null;
}

function setCache(key: string, data: unknown, ttlMs = ADMIN_CACHE_TTL_MS): void {
  const now = Date.now();
  pruneAdminCache(now);
  _adminCache.set(key, { data, expiresAt: now + ttlMs });
  if (_adminCache.size > ADMIN_CACHE_MAX_ENTRIES) {
    pruneAdminCache(now, true);
  }
}

function clearUsageReadCaches(): void {
  const now = Date.now();
  pruneAdminCache(now, true);
  for (const [key, entry] of _adminCache.entries()) {
    if (now >= entry.expiresAt) {
      _adminCache.delete(key);
      continue;
    }
    if (
      key.startsWith('globalUsage:') ||
      key.startsWith('usageTrend:') ||
      key.startsWith('quota:') ||
      key.startsWith('errorStats:') ||
      key.startsWith('keyErrors:') ||
      key.startsWith('keyUsage:')
    ) {
      _adminCache.delete(key);
    }
  }
}

export const __usageStorageCacheForTests = {
  clear(): void {
    _adminCache.clear();
    lastAdminCacheCleanup = 0;
  },
  set(key: string, data: unknown, ttlMs = ADMIN_CACHE_TTL_MS): void {
    setCache(key, data, ttlMs);
  },
  size(): number {
    return _adminCache.size;
  },
};

const QUOTA_CRITICAL_RATIO = 0.85;
const QUOTA_CRITICAL_REMAINING = 500;

function getMode(): 'off' | 'sampled' | 'full' {
  const configured = getCachedRuntimeSettingsSync().kvKeyUsageMode;
  if (configured === 'off' || configured === 'sampled' || configured === 'full') {
    return configured;
  }
  const raw = (process.env.RELAY_KV_KEY_USAGE_MODE || 'off').toLowerCase();
  if (raw === 'sampled' || raw === 'full') return raw;
  return 'off';
}

const SAMPLE_RATE_SETTING_MAP: Record<string, 'kvUsageSampleRate' | 'kvKeyUsageSampleRate' | 'kvErrorDetailSampleRate'> = {
  RELAY_KV_USAGE_SAMPLE_RATE: 'kvUsageSampleRate',
  RELAY_KV_KEY_USAGE_SAMPLE_RATE: 'kvKeyUsageSampleRate',
  RELAY_KV_ERROR_DETAIL_SAMPLE_RATE: 'kvErrorDetailSampleRate',
};

export function getSampleRate(envName: string, fallback: number): number {
  const settingField = SAMPLE_RATE_SETTING_MAP[envName];
  if (settingField) {
    const configured = getCachedRuntimeSettingsSync()[settingField];
    if (typeof configured === 'number' && Number.isFinite(configured)) {
      return Math.min(1, Math.max(0, configured));
    }
  }
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function getUsageSamplingInfo(): { sampleRate: number; estimated: boolean } {
  const sampleRate = getSampleRate('RELAY_KV_USAGE_SAMPLE_RATE', 1);
  return { sampleRate, estimated: sampleRate < 1 };
}

export function shouldSample(rate: number): boolean {
  return rate >= 1 || (rate > 0 && Math.random() < rate);
}

const RECORD_USAGE_SCRIPT = `
local requests = tonumber(ARGV[1]) or 1
local tokens = tonumber(ARGV[2]) or 0
local promptTokens = tonumber(ARGV[3]) or 0
local completionTokens = tonumber(ARGV[4]) or 0
local writeProvider = ARGV[5] == "1"
local writeKeyUsage = ARGV[6] == "1"
local keyRequests = tonumber(ARGV[7]) or 0
local keyTokens = tonumber(ARGV[8]) or 0
local writeGlobal = ARGV[9] ~= "0"

if writeGlobal then
  redis.call("HINCRBY", KEYS[1], "requests", requests)
  redis.call("HINCRBY", KEYS[1], "tokens", tokens)
  redis.call("HINCRBY", KEYS[1], "promptTokens", promptTokens)
  redis.call("HINCRBY", KEYS[1], "completionTokens", completionTokens)
  redis.call("EXPIRE", KEYS[1], 2592000)
end

if writeProvider then
  redis.call("HINCRBY", KEYS[2], "requests", requests)
  redis.call("HINCRBY", KEYS[2], "tokens", tokens)
  redis.call("HINCRBY", KEYS[2], "promptTokens", promptTokens)
  redis.call("HINCRBY", KEYS[2], "completionTokens", completionTokens)
  redis.call("EXPIRE", KEYS[2], 2592000)
end

if writeKeyUsage then
  redis.call("HINCRBY", KEYS[3], "requests", keyRequests)
  redis.call("HINCRBY", KEYS[3], "tokens", keyTokens)
  redis.call("EXPIRE", KEYS[3], 604800)
  redis.call("HINCRBY", KEYS[4], "requests", keyRequests)
  redis.call("HINCRBY", KEYS[4], "tokens", keyTokens)
end

return 1
`;

const RECORD_ERROR_SCRIPT = `
local status = ARGV[1]
local reason = ARGV[2]
local keyHash = ARGV[3]
local writeDetail = ARGV[4] == "1"

redis.call("HINCRBY", KEYS[1], status, 1)
redis.call("EXPIRE", KEYS[1], 604800)

if writeDetail then
  redis.call("HINCRBY", KEYS[2], status, 1)
  redis.call("HSET", KEYS[2], "reason:" .. status, reason)
  redis.call("EXPIRE", KEYS[2], 604800)
  redis.call("SADD", KEYS[3], keyHash)
  redis.call("EXPIRE", KEYS[3], 604800)
end

return 1
`;

const CHECK_QUOTA_SCRIPT = `
local dailyLimit = tonumber(ARGV[1]) or 0
local monthlyLimit = tonumber(ARGV[2]) or 0
local reserve = ARGV[3] == "1"

local dailyUsed = tonumber(redis.call("GET", KEYS[1]) or "0")
local monthlyUsed = tonumber(redis.call("GET", KEYS[2]) or "0")

if dailyLimit > 0 and dailyUsed >= dailyLimit then
  return {0, dailyUsed, monthlyUsed}
end
if monthlyLimit > 0 and monthlyUsed >= monthlyLimit then
  return {0, dailyUsed, monthlyUsed}
end

if reserve then
  dailyUsed = redis.call("INCRBY", KEYS[1], 1)
  redis.call("EXPIRE", KEYS[1], 172800)
  monthlyUsed = redis.call("INCRBY", KEYS[2], 1)
  redis.call("EXPIRE", KEYS[2], 3024000)
end

return {1, dailyUsed, monthlyUsed}
`;

async function recordUsageFallback(kv: any, keys: string[], args: string[]): Promise<void> {
  const requests = Number(args[0] || 1);
  const tokens = Number(args[1] || 0);
  const promptTokens = Number(args[2] || 0);
  const completionTokens = Number(args[3] || 0);
  const writeProvider = args[4] === '1';
  const writeKeyUsage = args[5] === '1';
  const keyRequests = Number(args[6] || 0);
  const keyTokens = Number(args[7] || 0);
  const writeGlobal = args[8] !== '0';
  const promises: Promise<unknown>[] = [];
  if (writeGlobal) {
    promises.push(
      kv.hincrby(keys[0], 'requests', requests),
      kv.hincrby(keys[0], 'tokens', tokens),
      kv.hincrby(keys[0], 'promptTokens', promptTokens),
      kv.hincrby(keys[0], 'completionTokens', completionTokens),
      kv.expire(keys[0], 86400 * 30)
    );
  }
  if (writeProvider) {
    promises.push(
      kv.hincrby(keys[1], 'requests', requests),
      kv.hincrby(keys[1], 'tokens', tokens),
      kv.hincrby(keys[1], 'promptTokens', promptTokens),
      kv.hincrby(keys[1], 'completionTokens', completionTokens),
      kv.expire(keys[1], 86400 * 30)
    );
  }
  if (writeKeyUsage) {
    promises.push(
      kv.hincrby(keys[2], 'requests', keyRequests),
      kv.hincrby(keys[2], 'tokens', keyTokens),
      kv.expire(keys[2], 86400 * 7),
      kv.hincrby(keys[3], 'requests', keyRequests),
      kv.hincrby(keys[3], 'tokens', keyTokens)
    );
  }
  await Promise.all(promises);
}

async function recordErrorFallback(kv: any, keys: string[], args: string[]): Promise<void> {
  const [status, reason, keyHash, writeDetail] = args;
  const promises: Promise<unknown>[] = [
    kv.hincrby(keys[0], status, 1),
    kv.expire(keys[0], 86400 * 7),
  ];
  if (writeDetail === '1') {
    promises.push(
      kv.hincrby(keys[1], status, 1),
      kv.hset(keys[1], `reason:${status}`, reason),
      kv.expire(keys[1], 86400 * 7),
      kv.sadd(keys[2], keyHash),
      kv.expire(keys[2], 86400 * 7)
    );
  }
  await Promise.all(promises);
}

async function runUsageScript(kv: any, keys: string[], args: string[]): Promise<void> {
  if (typeof kv.eval === 'function') {
    await kv.eval(RECORD_USAGE_SCRIPT, keys, args);
    return;
  }
  await recordUsageFallback(kv, keys, args);
}

async function runErrorScript(kv: any, keys: string[], args: string[]): Promise<void> {
  if (typeof kv.eval === 'function') {
    await kv.eval(RECORD_ERROR_SCRIPT, keys, args);
    return;
  }
  await recordErrorFallback(kv, keys, args);
}

async function mgetNumbers(kv: any, keys: string[]): Promise<number[]> {
  if (typeof kv.mget === 'function') {
    const values = await kv.mget(...keys);
    return (values as unknown[]).map((v) => Number(v || 0));
  }
  return Promise.all(keys.map(async (key) => Number(await kv.get(key) || 0)));
}

async function reserveOrReadQuota(
  kv: any,
  dailyKey: string,
  monthlyKey: string,
  dailyLimit: number,
  monthlyLimit: number,
  reserve: boolean
): Promise<{ allowed: boolean; dailyUsed: number; monthlyUsed: number }> {
  if (reserve && typeof kv.eval === 'function') {
    const raw = await kv.eval(CHECK_QUOTA_SCRIPT, [dailyKey, monthlyKey], [
      String(dailyLimit),
      String(monthlyLimit),
      '1',
    ]);
    const values = Array.isArray(raw) ? raw.map(Number) : [0, 0, 0];
    return { allowed: values[0] === 1, dailyUsed: values[1] || 0, monthlyUsed: values[2] || 0 };
  }

  const [dailyUsed, monthlyUsed] = await mgetNumbers(kv, [dailyKey, monthlyKey]);
  if (!reserve) {
    return { allowed: true, dailyUsed, monthlyUsed };
  }
  if ((dailyLimit > 0 && dailyUsed >= dailyLimit) || (monthlyLimit > 0 && monthlyUsed >= monthlyLimit)) {
    return { allowed: false, dailyUsed, monthlyUsed };
  }

  const [nextDaily, nextMonthly] = await Promise.all([
    (typeof kv.incrby === 'function' ? kv.incrby(dailyKey, 1) : kv.incr(dailyKey)).then(async (v: unknown) => {
      await kv.expire(dailyKey, 86400 * 2);
      return Number(v || dailyUsed + 1);
    }),
    (typeof kv.incrby === 'function' ? kv.incrby(monthlyKey, 1) : kv.incr(monthlyKey)).then(async (v: unknown) => {
      await kv.expire(monthlyKey, 86400 * 35);
      return Number(v || monthlyUsed + 1);
    }),
  ]);
  return { allowed: true, dailyUsed: nextDaily, monthlyUsed: nextMonthly };
}

function buildQuotaResult(
  dailyUsed: number,
  dailyLimit: number,
  monthlyUsed: number,
  monthlyLimit: number,
  isOverride: boolean
): QuotaStatus {
  if (dailyLimit > 0 && dailyUsed >= dailyLimit) {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(16, 0, 0, 0);
    if (now.getUTCHours() >= 16) {
      midnight.setUTCDate(midnight.getUTCDate() + 1);
    }
    const retryAfter = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
    return { allowed: false, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, retryAfter, isOverride };
  }
  if (monthlyLimit > 0 && monthlyUsed >= monthlyLimit) {
    const now = new Date();
    const nextMonthBeijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    nextMonthBeijing.setUTCHours(0, 0, 0, 0);
    nextMonthBeijing.setUTCDate(1);
    nextMonthBeijing.setUTCMonth(nextMonthBeijing.getUTCMonth() + 1);
    const nextMonthAbsolute = new Date(nextMonthBeijing.getTime() - 8 * 60 * 60 * 1000);
    const retryAfter = Math.ceil((nextMonthAbsolute.getTime() - now.getTime()) / 1000);
    return { allowed: false, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, retryAfter, isOverride };
  }
  return { allowed: true, dailyUsed, dailyLimit, monthlyUsed, monthlyLimit, isOverride };
}

function shouldRecheckQuota(dailyUsed: number, dailyLimit: number, monthlyUsed: number, monthlyLimit: number): boolean {
  const dailyCritical = dailyLimit > 0 && (
    dailyUsed / dailyLimit >= QUOTA_CRITICAL_RATIO ||
    dailyLimit - dailyUsed <= QUOTA_CRITICAL_REMAINING
  );
  const monthlyCritical = monthlyLimit > 0 && (
    monthlyUsed / monthlyLimit >= QUOTA_CRITICAL_RATIO ||
    monthlyLimit - monthlyUsed <= QUOTA_CRITICAL_REMAINING
  );
  return dailyCritical || monthlyCritical;
}

export class KVUsageStorage implements UsageStorage {
  /**
   * On self-hosted persistent file storage (`FileKVAdapter`), in-memory writes
   * are sub-microsecond and free (disk writes are coalesced inside FileKVAdapter),
   * so bypass BatchUsageRecorder's 60s Upstash-saving ring buffer for real-time stats.
   */
  get shouldRecordDirect(): boolean {
    if (isCloudflareSync()) return false;
    if (
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
      (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
    ) {
      return false;
    }
    if (process.env.RELAY_STORAGE_PATH?.trim() || process.env.RELAY_DATA_DIR?.trim()) return true;
    return (
      process.env.NODE_ENV === 'production' &&
      !process.env.VERCEL &&
      !process.env.CF_PAGES &&
      !process.env.VITEST
    );
  }

  /**
   * Record a usage event with per-request KV write.
   * Used for low-traffic paths or when batching is not desired.
   */
  async record(event: UsageEvent): Promise<void> {
    try {
      const kv = await getKV();
      if (!kv) return;

      const usageSampleRate = getUsageSamplingInfo().sampleRate;
      if (!shouldSample(usageSampleRate)) return;
      const usageScale = usageSampleRate > 0 && usageSampleRate < 1
        ? Math.max(1, Math.round(1 / usageSampleRate))
        : 1;

      const date = today();
      const requestCount = usageScale;
      const totalTokens = event.totalTokens * usageScale;
      const promptTokens = event.promptTokens * usageScale;
      const completionTokens = event.completionTokens * usageScale;
      let writeKeyUsage = false;
      let keyRequests = 0;
      let keyTokens = 0;
      const configuredMode = getCachedRuntimeSettingsSync().kvKeyUsageMode;
      const mode =
        configuredMode ??
        (kv._isFileKV && !process.env.RELAY_KV_KEY_USAGE_MODE ? 'full' : getMode());
      if (mode === 'full') {
        writeKeyUsage = true;
        keyRequests = requestCount;
        keyTokens = totalTokens;
      } else if (mode === 'sampled') {
        const rate = getSampleRate('RELAY_KV_KEY_USAGE_SAMPLE_RATE', 0.1);
        if (shouldSample(rate)) {
          const scale = Math.max(1, Math.round(1 / rate));
          writeKeyUsage = true;
          keyRequests = requestCount * scale;
          keyTokens = totalTokens * scale;
        }
      }

      await withTimeout(
        runUsageScript(
          kv,
          [
            kvKeys.usageDaily(date),
            event.provider ? kvKeys.usageProviderDaily(event.provider, date) : kvKeys.usageDaily(date),
            kvKeys.legacyKeyDaily(event.apiKeyHash, date),
            kvKeys.legacyKeyTotal(event.apiKeyHash),
          ],
          [
            String(requestCount),
            String(totalTokens),
            String(promptTokens),
            String(completionTokens),
            event.provider ? '1' : '0',
            writeKeyUsage ? '1' : '0',
            String(keyRequests),
            String(keyTokens),
            '1',
          ]
        ),
        1000,
        undefined,
        'recordUsage:eval'
      );
      clearUsageReadCaches();
    } catch {
      // Non-critical — never break the request
    }
  }

  /**
   * Direct KV write for batched usage data (called by BatchUsageRecorder on flush).
   * Skips per-event sampling — sampling is handled at the caller level.
   * Writes global + per-provider aggregated counters.
   */
  async recordDirect(event: UsageEvent, requestCount?: number, options: { includeGlobal?: boolean } = {}): Promise<void> {
    try {
      const kv = await getKV();
      if (!kv) return;

      const includeGlobal = options.includeGlobal ?? true;
      const date = today();
      const count = requestCount ?? (event.promptTokens > 0 || event.completionTokens > 0 ? 1 : 0);
      const totalTokens = event.totalTokens;
      const promptTokens = event.promptTokens;
      const completionTokens = event.completionTokens;

      await withTimeout(
        runUsageScript(
          kv,
          [
            kvKeys.usageDaily(date),
            event.provider ? kvKeys.usageProviderDaily(event.provider, date) : kvKeys.usageDaily(date),
            kvKeys.legacyKeyDaily(event.apiKeyHash || 'batch', date),
            kvKeys.legacyKeyTotal(event.apiKeyHash || 'batch'),
          ],
          [
            String(count || 1),
            String(totalTokens),
            String(promptTokens),
            String(completionTokens),
            event.provider ? '1' : '0',
            '0', // no per-key writes for batch
            '0',
            '0',
            includeGlobal ? '1' : '0',
          ]
        ),
        1000,
        undefined,
        'recordDirect:eval'
      );
      clearUsageReadCaches();
    } catch {
      // Non-critical
    }
  }

  async recordError(event: {
    provider: string;
    keyHash: string;
    statusCode: number;
    reason: string;
  }): Promise<void> {
    try {
      const kv = await getKV();
      if (!kv) return;

      const date = today();
      const status = String(event.statusCode);
      const defaultDetailRate = kv._isFileKV ? 1 : 0.2;
      const detailRate = getSampleRate('RELAY_KV_ERROR_DETAIL_SAMPLE_RATE', defaultDetailRate);
      const writeDetail = shouldSample(detailRate);

      await withTimeout(
        runErrorScript(
          kv,
          [
            kvKeys.errorProviderDaily(event.provider, date),
            kvKeys.legacyErrorKeyDaily(event.keyHash, date),
            kvKeys.errorKeyIndex(date),
          ],
          [status, event.reason.slice(0, 200), event.keyHash, writeDetail ? '1' : '0']
        ),
        1000,
        undefined,
        'recordError:eval'
      );
      clearUsageReadCaches();
    } catch {
      // Non-critical
    }
  }

  /**
   * Direct KV write for batched error data (called by BatchUsageRecorder on flush).
   * Skips per-event sampling. Uses direct hincrby with count for efficiency.
   */
  async recordErrorDirect(event: {
    provider: string;
    keyHash: string;
    statusCode: number;
    reason: string;
    count?: number;
  }): Promise<void> {
    try {
      const kv = await getKV();
      if (!kv) return;

      const date = today();
      const status = String(event.statusCode);
      const count = event.count || 1;
      const key = kvKeys.errorProviderDaily(event.provider, date);

      await withTimeout(
        Promise.all([
          kv.hincrby(key, status, count),
          kv.expire(key, 604800),
        ]),
        1000,
        undefined,
        'recordErrorDirect:hincrby'
      );
      clearUsageReadCaches();
    } catch {
      // Non-critical
    }
  }

  async getErrorStats(): Promise<Record<string, Record<string, number>>> {
    const cacheKey = `errorStats:${today()}`;
    const cached = getCached<Record<string, Record<string, number>>>(cacheKey);
    if (cached) return cached;

    try {
      const kv = await getKV();
      if (!kv) return {};

      const date = today();
      const result: Record<string, Record<string, number>> = {};
      const allProviders = await getAllProviders();
      const providerNames = Object.keys(allProviders);

      const p = kv.pipeline();
      for (const provider of providerNames) {
        p.hgetall(kvKeys.errorProviderDaily(provider, date));
      }
      const rawResults = await withTimeout(
        p.exec(),
        1000,
        [],
        'getErrorStats:pipeline'
      );

      for (let i = 0; i < providerNames.length; i++) {
        const provider = providerNames[i];
        const raw = rawResults[i] as Record<string, unknown> | null;
        if (raw && Object.keys(raw).length > 0) {
          result[provider] = {};
          for (const [code, count] of Object.entries(raw)) {
            result[provider][code] = Number(count);
          }
        }
      }
      setCache(cacheKey, result);
      return result;
    } catch {
      return {};
    }
  }

  async getKeyErrors(): Promise<Array<{
    keyHash: string;
    errors: Record<string, { count: number; reason: string }>;
  }>> {
    const cacheKey = `keyErrors:${today()}`;
    const cached = getCached<Array<{ keyHash: string; errors: Record<string, { count: number; reason: string }> }>>(cacheKey);
    if (cached) return cached;

    try {
      const kv = await getKV();
      if (!kv) return [];

      const date = today();
      const indexKey = kvKeys.errorKeyIndex(date);
      const keyHashes: string[] = await withTimeout(
        kv.smembers(indexKey),
        1000,
        [],
        'getKeyErrors:smembers'
      );
      if (!keyHashes || keyHashes.length === 0) return [];

      const p = kv.pipeline();
      for (const keyHash of keyHashes) {
        p.hgetall(kvKeys.legacyErrorKeyDaily(keyHash, date));
      }
      const rawResults = await withTimeout(
        p.exec(),
        1000,
        [],
        'getKeyErrors:pipeline'
      );

      const results: Array<{
        keyHash: string;
        errors: Record<string, { count: number; reason: string }>;
      }> = [];

      for (let i = 0; i < keyHashes.length; i++) {
        const keyHash = keyHashes[i];
        const raw = rawResults[i] as Record<string, unknown> | null;
        if (!raw) continue;
        const errors: Record<string, { count: number; reason: string }> = {};
        for (const [field, value] of Object.entries(raw)) {
          if (String(field).startsWith('reason:')) continue;
          errors[String(field)] = {
            count: Number(value),
            reason: String(raw[`reason:${String(field)}`] || ''),
          };
        }
        if (Object.keys(errors).length > 0) {
          results.push({ keyHash: String(keyHash), errors });
        }
      }

      setCache(cacheKey, results);
      return results;
    } catch {
      return [];
    }
  }

  async getKeyUsage(keyHash: string): Promise<{
    daily: { requests: number; tokens: number };
    total: { requests: number; tokens: number };
  } | null> {
    const cacheKey = `keyUsage:${keyHash}:${today()}`;
    const cached = getCached<{ daily: { requests: number; tokens: number }; total: { requests: number; tokens: number } }>(cacheKey);
    if (cached) return cached;

    try {
      const kv = await getKV();
      if (!kv) return null;

      const date = today();
      const result = await getLegacyKeyUsage(kv, keyHash, date);
      setCache(cacheKey, result);
      return result;
    } catch {
      return null;
    }
  }

  async getGlobalUsage(): Promise<{
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    providers: Record<string, { requests: number; tokens: number; promptTokens: number; completionTokens: number }>;
  } | null> {
    const cacheKey = `globalUsage:${today()}`;
    const cached = getCached<{
      requests: number;
      tokens: number;
      promptTokens: number;
      completionTokens: number;
      providers: Record<string, { requests: number; tokens: number; promptTokens: number; completionTokens: number }>;
    }>(cacheKey);
    if (cached) return cached;

    try {
      const kv = await getKV();
      if (!kv) return null;

      const date = today();
      const allProviders = await getAllProviders();
      const providerNames = Object.keys(allProviders);

      const p = kv.pipeline();
      p.hgetall(kvKeys.usageDaily(date));
      for (const provider of providerNames) {
        p.hgetall(kvKeys.usageProviderDaily(provider, date));
      }

      const rawResults = await withTimeout(
        p.exec(),
        1000,
        [],
        'getGlobalUsage:pipeline'
      );

      const raw = rawResults[0] as Record<string, unknown> | null;
      const providers: Record<string, { requests: number; tokens: number; promptTokens: number; completionTokens: number }> = {};
      for (let i = 0; i < providerNames.length; i++) {
        const provider = providerNames[i];
        const pRaw = rawResults[i + 1] as Record<string, unknown> | null;
        const req = Number(pRaw?.requests || 0);
        if (req > 0) {
          providers[provider] = {
            requests: req,
            tokens: Number(pRaw?.tokens || 0),
            promptTokens: Number(pRaw?.promptTokens || 0),
            completionTokens: Number(pRaw?.completionTokens || 0),
          };
        }
      }

      const result = {
        requests: Number(raw?.requests || 0),
        tokens: Number(raw?.tokens || 0),
        promptTokens: Number(raw?.promptTokens || 0),
        completionTokens: Number(raw?.completionTokens || 0),
        providers,
      };
      setCache(cacheKey, result);
      return result;
    } catch {
      return null;
    }
  }

  async getMonthlyUsage(): Promise<{
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
  } | null> {
    const month = thisMonth();
    const cacheKey = `monthlyUsage:${month}:${today()}`;
    const cached = getCached<{
      requests: number;
      tokens: number;
      promptTokens: number;
      completionTokens: number;
    }>(cacheKey);
    if (cached) return cached;

    try {
      const kv = await getKV();
      if (!kv) return null;

      const nowBeijing = getBeijingDate();
      const dayOfMonth = nowBeijing.getUTCDate();
      const dates = dateRange(dayOfMonth);

      const p = kv.pipeline();
      for (const date of dates) {
        p.hgetall(kvKeys.usageDaily(date));
      }

      const rawResults = await withTimeout(
        p.exec(),
        1000,
        [],
        'getMonthlyUsage:pipeline'
      );

      const result = {
        requests: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
      };
      for (const raw of rawResults as Array<Record<string, unknown> | null>) {
        result.requests += Number(raw?.requests || 0);
        result.tokens += Number(raw?.tokens || 0);
        result.promptTokens += Number(raw?.promptTokens || 0);
        result.completionTokens += Number(raw?.completionTokens || 0);
      }

      setCache(cacheKey, result);
      return result;
    } catch {
      return null;
    }
  }

  async getUsageTrend(
    range: string,
    granularity: 'day' | 'week' | 'month' = 'day'
  ): Promise<{ global: TrendPoint[]; providers: ProviderTrendPoint[] }> {
    const cacheKey = `usageTrend:${range}:${granularity}:${today()}`;
    const cached = getCached<{ global: TrendPoint[]; providers: ProviderTrendPoint[] }>(cacheKey);
    if (cached) return cached;

    const kv = await getKV();
    if (!kv) return { global: [], providers: [] };

    let days: number;
    if (granularity === 'day') {
      days = range === '30d' ? 30 : 7;
    } else if (granularity === 'week') {
      days = range === '12w' ? 84 : 28;
    } else {
      days = range === '12m' ? 365 : 180;
    }

    const dates = dateRange(days);

    try {
      const allProviders = await getAllProviders();
      const providerNames = Object.keys(allProviders);

      const p = kv.pipeline();
      for (const date of dates) {
        p.hgetall(kvKeys.usageDaily(date));
      }
      for (const provider of providerNames) {
        for (const date of dates) {
          p.hgetall(kvKeys.usageProviderDaily(provider, date));
        }
      }

      const rawResults = await withTimeout(
        p.exec(),
        2000,
        [],
        'getUsageTrend:pipeline'
      );

      const globalDaily: TrendPoint[] = [];
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const raw = rawResults[i] as Record<string, unknown> | null;
        globalDaily.push(parseDailyPoint(date, raw));
      }

      const providersDaily: Array<{ provider: string; data: TrendPoint[] }> = [];
      let offset = dates.length;
      for (const provider of providerNames) {
        const data: TrendPoint[] = [];
        for (let i = 0; i < dates.length; i++) {
          const date = dates[i];
          const raw = rawResults[offset + i] as Record<string, unknown> | null;
          data.push(parseDailyPoint(date, raw));
        }
        offset += dates.length;
        providersDaily.push({ provider, data });
      }

      if (granularity === 'day') {
        const activeProviders = providersDaily.filter((p) => p.data.some((d) => d.totalTokens > 0));
        const result = { global: globalDaily, providers: activeProviders };
        setCache(cacheKey, result, TREND_CACHE_TTL_MS);
        return result;
      }

      const labelFn = granularity === 'week' ? getWeekLabel : getMonthLabel;
      const global = aggregatePoints(globalDaily, labelFn);
      const providers = providersDaily
        .map((p) => ({ provider: p.provider, data: aggregatePoints(p.data, labelFn) }))
        .filter((p) => p.data.some((d) => d.totalTokens > 0));

      const result = { global, providers };
      setCache(cacheKey, result, TREND_CACHE_TTL_MS);
      return result;
    } catch {
      return { global: [], providers: [] };
    }
  }

  async checkQuota(reserve = false): Promise<QuotaStatus> {
    const date = today();
    const month = thisMonth();
    const cacheKey = `quota:${date}`;
    const cached = reserve ? null : getCached<QuotaStatus>(cacheKey);
    if (cached) {
      return cached;
    }

    let dailyLimit = parseInt(process.env.RELAY_DAILY_LIMIT || '0', 10) || 0;
    let monthlyLimit = parseInt(process.env.RELAY_MONTHLY_LIMIT || '0', 10) || 0;
    let isOverride = false;

    try {
      const { getCustomQuota } = await import('@/lib/admin/admin-config');
      const customQuota = await getCustomQuota();
      if (customQuota) {
        dailyLimit = customQuota.dailyLimit || 0;
        monthlyLimit = customQuota.monthlyLimit || 0;
        isOverride = true;
      }
    } catch {
      // Ignore config loading errors, fall back to env variables.
    }

    const kv = await getKV();
    if (!kv || (!dailyLimit && !monthlyLimit)) {
      return { allowed: true, dailyUsed: 0, dailyLimit, monthlyUsed: 0, monthlyLimit, isOverride };
    }

    try {
      const dailyKey = kvKeys.quotaDaily(date);
      const monthlyKey = kvKeys.quotaMonthly(month);
      const quota = await withTimeout(
        reserveOrReadQuota(kv, dailyKey, monthlyKey, dailyLimit, monthlyLimit, reserve),
        1000,
        { allowed: true, dailyUsed: 0, monthlyUsed: 0 },
        reserve ? 'checkQuota:reserve' : 'checkQuota:mget'
      );
      const result = reserve && quota.allowed
        ? { allowed: true, dailyUsed: quota.dailyUsed, dailyLimit, monthlyUsed: quota.monthlyUsed, monthlyLimit, isOverride }
        : buildQuotaResult(quota.dailyUsed, dailyLimit, quota.monthlyUsed, monthlyLimit, isOverride);

      if (reserve && quota.allowed) {
        clearUsageReadCaches();
      } else if (!reserve && result.allowed && !shouldRecheckQuota(result.dailyUsed, dailyLimit, result.monthlyUsed, monthlyLimit)) {
        setCache(cacheKey, result, QUOTA_CACHE_TTL_MS);
      }
      return result;
    } catch {
      return { allowed: true, dailyUsed: 0, dailyLimit, monthlyUsed: 0, monthlyLimit, isOverride };
    }
  }

  async flush(): Promise<void> {
    // Kept for callers that previously asked the buffered implementation to flush.
    // Usage writes now land synchronously through Redis scripts, so there is no buffer.
  }

  async getDailyReport(date: string): Promise<DailyReportData | null> {
    const kv = await getKV();
    if (!kv) return null;

    const allProviders = await getAllProviders();
    const providerNames = Object.keys(allProviders);

    const p = kv.pipeline();
    p.hgetall(kvKeys.usageDaily(date));
    for (const provider of providerNames) {
      p.hgetall(kvKeys.usageProviderDaily(provider, date));
    }
    p.hgetall(kvKeys.usageDaily(previousDate(date)));

    const rawResults = await withTimeout(
      p.exec(),
      2000,
      [],
      'getDailyReport:pipeline'
    );

    const globalRaw = rawResults[0] as Record<string, unknown> | null;
    if (!globalRaw || Object.keys(globalRaw).length === 0) return null;

    const totalRequests = Number(globalRaw.requests ?? 0);
    const totalTokens = Number(globalRaw.tokens ?? 0);
    const providers: DailyReportData['providers'] = {};
    for (let i = 0; i < providerNames.length; i++) {
      const provider = providerNames[i];
      const raw = rawResults[i + 1] as Record<string, unknown> | null;
      if (!raw || Object.keys(raw).length === 0) continue;
      providers[provider] = {
        requests: Number(raw.requests ?? 0),
        tokens: Number(raw.tokens ?? 0),
        promptTokens: Number(raw.promptTokens ?? 0),
        completionTokens: Number(raw.completionTokens ?? 0),
      };
    }

    const yesterdayRaw = rawResults[1 + providerNames.length] as Record<string, unknown> | null;
    const yesterdayComparison = yesterdayRaw && Object.keys(yesterdayRaw).length > 0
      ? {
          requestsChange: totalRequests > 0 && Number(yesterdayRaw.requests ?? 0) > 0
            ? ((totalRequests - Number(yesterdayRaw.requests ?? 0)) / Number(yesterdayRaw.requests ?? 1)) * 100
            : 0,
          tokensChange: totalTokens > 0 && Number(yesterdayRaw.tokens ?? 0) > 0
            ? ((totalTokens - Number(yesterdayRaw.tokens ?? 0)) / Number(yesterdayRaw.tokens ?? 1)) * 100
            : 0,
        }
      : undefined;

    return {
      date,
      totalRequests,
      totalTokens,
      promptTokens: Number(globalRaw.promptTokens ?? 0),
      completionTokens: Number(globalRaw.completionTokens ?? 0),
      providers,
      topModels: [],
      yesterdayComparison,
    };
  }

  async clearKeyErrors(keyHash: string): Promise<void> {
    try {
      const kv = await getKV();
      if (!kv) return;

      const date = today();
      const indexKey = kvKeys.errorKeyIndex(date);
      const errorKey = kvKeys.legacyErrorKeyDaily(keyHash, date);

      await Promise.all([
        kv.del(errorKey),
        kv.srem(indexKey, keyHash)
      ]);

      clearUsageReadCaches();
    } catch {
      // Non-critical
    }
  }
}
