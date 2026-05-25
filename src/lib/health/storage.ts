// ============================================================
// AI Relay — Provider Health Probe Storage
// ============================================================

import { withTimeout } from '@/lib/utils/timeout';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ProviderHealthRecord {
  id: string;
  name: string;
  status: ProviderHealthStatus;
  responseTimeMs: number | null;
  statusCode?: number | null;
  consecutiveFailures: number;
  lastCheckedAt: string;
  error?: string;
}

export interface ProviderHealthHistoryRecord extends ProviderHealthRecord {
  checkedAt: string;
}

export interface ProbeResultInput {
  providerId: string;
  providerName: string;
  ok: boolean;
  statusCode?: number | null;
  responseTimeMs?: number | null;
  checkedAt?: string;
  error?: string;
  skipped?: boolean;
}

interface CacheEntry<T> { data: T; expiresAt: number }

let _kv: any = null;
const CACHE_TTL_MS = 60_000;
const HISTORY_TTL_SECONDS = 7 * 24 * 60 * 60;
const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  if (entry) cache.delete(key);
  return null;
}

function setCached(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function clearHealthCache(): void {
  cache.clear();
}

export const healthKeys = {
  last: (provider: string) => `relay:health:last:${provider}`,
  log: (provider: string, ts: string) => `relay:health:log:${provider}:${ts}`,
  consecutive: (provider: string) => `relay:health:consecutive:${provider}`,
};

async function getKV() {
  const g = global as any;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    if (_kv && !_kv._isMock) return _kv;
    try {
      const mod = await import('@vercel/kv');
      _kv = mod.kv || mod.createClient({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
      return _kv;
    } catch {
      return null;
    }
  }

  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    if (!g._mockKVInstance) return null;
    _kv = g._mockKVInstance;
    return _kv;
  }

  return null;
}

function parseRecord(raw: unknown): ProviderHealthRecord | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as ProviderHealthRecord; } catch { return null; }
  }
  if (typeof raw === 'object') return raw as ProviderHealthRecord;
  return null;
}

function statusFor(input: ProbeResultInput, previous: ProviderHealthRecord | null): { status: ProviderHealthStatus; failures: number } {
  if (input.skipped) return { status: 'unknown', failures: 0 };
  const statusCode = input.statusCode ?? 0;
  if (input.ok) {
    if ((input.responseTimeMs ?? 0) > 5000 || statusCode === 429) {
      return { status: 'degraded', failures: 0 };
    }
    return { status: 'healthy', failures: 0 };
  }

  if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
    return { status: 'degraded', failures: previous?.consecutiveFailures ?? 0 };
  }

  const failures = (previous?.consecutiveFailures ?? 0) + 1;
  return { status: failures >= 2 ? 'down' : 'degraded', failures };
}

export async function recordHealthProbeResult(input: ProbeResultInput): Promise<ProviderHealthRecord> {
  const kv = await getKV();
  const checkedAt = input.checkedAt || new Date().toISOString();
  const previous = kv ? parseRecord(await withTimeout(kv.get(healthKeys.last(input.providerId)), 1000, null, 'health:last')) : null;
  const nextState = statusFor(input, previous);
  const record: ProviderHealthRecord = {
    id: input.providerId,
    name: input.providerName,
    status: nextState.status,
    responseTimeMs: input.responseTimeMs ?? null,
    statusCode: input.statusCode ?? null,
    consecutiveFailures: nextState.failures,
    lastCheckedAt: checkedAt,
    ...(input.error ? { error: input.error } : {}),
  };

  if (kv) {
    const logKey = healthKeys.log(input.providerId, checkedAt);
    await withTimeout(Promise.all([
      kv.set(healthKeys.last(input.providerId), record),
      kv.set(healthKeys.consecutive(input.providerId), nextState.failures),
      kv.set(logKey, { ...record, checkedAt }),
      kv.expire(logKey, HISTORY_TTL_SECONDS),
    ]), 2000, null, 'health:write');
  }
  clearHealthCache();
  return record;
}

export async function getProviderHealthSnapshot(providerIds: string[] = []): Promise<{ timestamp: string; providers: Array<ProviderHealthRecord & { history: ProviderHealthHistoryRecord[] }> }> {
  const cacheKey = `snapshot:${providerIds.join(',')}`;
  const cached = getCached<{ timestamp: string; providers: Array<ProviderHealthRecord & { history: ProviderHealthHistoryRecord[] }> }>(cacheKey);
  if (cached) return cached;

  const kv = await getKV();
  if (!kv) return { timestamp: new Date().toISOString(), providers: [] };

  const ids = providerIds.length > 0 ? providerIds : [];
  const providers: Array<ProviderHealthRecord & { history: ProviderHealthHistoryRecord[] }> = [];
  for (const id of ids) {
    const last = parseRecord(await withTimeout(kv.get(healthKeys.last(id)), 1000, null, 'health:snapshot:last'));
    const rawScan = await withTimeout(kv.scan(0, { match: `relay:health:log:${id}:*`, count: 200 }), 1000, [0, []] as [number, string[]], 'health:snapshot:scan');
    const scanKeys = Array.isArray(rawScan?.[1]) ? rawScan[1] as string[] : [];
    const keys = scanKeys.sort().reverse().slice(0, 336);
    const values = keys.length ? await withTimeout(kv.mget(keys), 1500, [], 'health:snapshot:mget') : [];
    const history = values
      .map((v: unknown) => parseRecord(v) as ProviderHealthHistoryRecord | null)
      .filter((v: ProviderHealthHistoryRecord | null): v is ProviderHealthHistoryRecord => Boolean(v));
    if (last) providers.push({ ...last, history });
  }

  const result = { timestamp: new Date().toISOString(), providers };
  setCached(cacheKey, result);
  return result;
}

export const __healthStoreForTests = {
  clearCache(): void {
    clearHealthCache();
    _kv = null;
  },
};
