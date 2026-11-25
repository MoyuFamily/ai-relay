// ============================================================
// AI API Relay — Admin Runtime Settings (Zero-Redeploy Config)
// ============================================================
// Persists operational settings in KV / D1 / Disk / Postgres so users
// never need to edit platform env vars (Vercel / CF / GitHub Secrets)
// or redeploy to adjust timeouts, concurrency, request logs, client keys,
// cron secrets, local key sync, user-agent, or public base URL.
//
// Precedence: Admin Runtime Settings (when explicitly set) > Environment Variables > Platform Defaults.

import { getCFEnv, getCFEnvSync, isCloudflareSync } from '@/lib/cf-env';
import { ensureD1Schema } from '@/lib/db/d1-schema';
import { getKV } from './admin-config';

export const RUNTIME_SETTINGS_KEY = 'admin:runtime:settings';
const RUNTIME_SETTINGS_TTL_MS = 60_000;

export interface RuntimeSettings {
  /** Additional client API keys accepted by `/v1/*` (managed in Admin UI). */
  extraClientKeys?: string[];
  /** Override `CRON_SECRET` for `/api/cron/*`. */
  cronSecret?: string | null;
  /** Override `RELAY_UPSTREAM_TIMEOUT_MS` (0 = disabled, >= 1000ms). */
  upstreamTimeoutMs?: number | null;
  /** Override `RELAY_FALLBACK_ON_TIMEOUT` (try fallback provider on timeout instead of immediate 504). */
  fallbackOnTimeout?: boolean | null;
  /** Override `RELAY_MAX_CONCURRENT` (>= 1). */
  maxConcurrent?: number | null;
  /** Override `RELAY_MAX_QUEUE` (>= 0). */
  maxQueue?: number | null;
  /** Override `RELAY_MAX_REQUEST_BYTES` (0 = disabled, >= 1024). */
  maxRequestBytes?: number | null;
  /** Override `ENABLE_REQUEST_LOGS`. */
  enableRequestLogs?: boolean | null;
  /** Override `REQUEST_LOGS_MAX_ENTRIES` (1..5000). */
  requestLogsMaxEntries?: number | null;
  /** Override `ALLOW_LOCAL_KEY_SYNC`. */
  allowLocalKeySync?: boolean | null;
  /** Override `RELAY_DEFAULT_USER_AGENT`. */
  defaultUserAgent?: string | null;
  /** Override `DEPLOY_URL` (public base URL behind reverse proxies). */
  deployUrl?: string | null;
  /** Override `RELAY_KV_USAGE_SAMPLE_RATE` (0..1, for Vercel/Upstash KV command savings). */
  kvUsageSampleRate?: number | null;
  /** Override `RELAY_KV_KEY_USAGE_MODE` ('off' | 'sampled' | 'full'). */
  kvKeyUsageMode?: 'off' | 'sampled' | 'full' | null;
  /** Override `RELAY_KV_KEY_USAGE_SAMPLE_RATE` (0..1). */
  kvKeyUsageSampleRate?: number | null;
  /** Override `RELAY_KV_ERROR_DETAIL_SAMPLE_RATE` (0..1). */
  kvErrorDetailSampleRate?: number | null;
  /** Override `RELAY_STREAM_BYTES_PER_TOKEN` (1..1000, CF stream byte estimator). */
  streamBytesPerToken?: number | null;
  /** Override `RELAY_KEY_POOL_VERSION_CHECK_TTL_MS` (1000..600000). */
  keyPoolVersionCheckTtlMs?: number | null;
  /** Override `SELF_HOSTED_PROBE_INTERVAL_MINUTES` (0 = disabled, 1..1440). */
  selfHostedProbeIntervalMinutes?: number | null;
  /** Override `RELAY_API_KEY_MIN_LENGTH` (4..128). */
  apiKeyMinLength?: number | null;
  updatedAt?: string;
}

interface SettingsCacheEntry {
  data: RuntimeSettings;
  expiresAt: number;
}

type GlobalWithSettingsCache = typeof globalThis & {
  __aiRelayRuntimeSettingsCache?: SettingsCacheEntry | null;
};

export function getCachedRuntimeSettingsSync(): RuntimeSettings {
  const g = globalThis as GlobalWithSettingsCache;
  const entry = g.__aiRelayRuntimeSettingsCache;
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  return {};
}

function setSettingsCache(data: RuntimeSettings, ttlMs = RUNTIME_SETTINGS_TTL_MS): void {
  const g = globalThis as GlobalWithSettingsCache;
  g.__aiRelayRuntimeSettingsCache = {
    data,
    expiresAt: Date.now() + ttlMs,
  };
}

export function __resetRuntimeSettingsCacheForTests(): void {
  const g = globalThis as GlobalWithSettingsCache;
  g.__aiRelayRuntimeSettingsCache = null;
}

function parseSettings(raw: unknown): RuntimeSettings {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const obj = parsed as Record<string, unknown>;
    const out: RuntimeSettings = {};

    if (Array.isArray(obj.extraClientKeys)) {
      out.extraClientKeys = Array.from(
        new Set(
          obj.extraClientKeys
            .filter((k): k is string => typeof k === 'string')
            .map((k) => k.trim())
            .filter(Boolean)
        )
      );
    }
    if (typeof obj.cronSecret === 'string' && obj.cronSecret.trim()) {
      out.cronSecret = obj.cronSecret.trim();
    }
    if (typeof obj.upstreamTimeoutMs === 'number' && Number.isFinite(obj.upstreamTimeoutMs)) {
      out.upstreamTimeoutMs = obj.upstreamTimeoutMs <= 0 ? 0 : Math.max(1_000, Math.floor(obj.upstreamTimeoutMs));
    }
    if (typeof obj.fallbackOnTimeout === 'boolean') {
      out.fallbackOnTimeout = obj.fallbackOnTimeout;
    }
    if (typeof obj.maxConcurrent === 'number' && Number.isFinite(obj.maxConcurrent) && obj.maxConcurrent >= 1) {
      out.maxConcurrent = Math.floor(obj.maxConcurrent);
    }
    if (typeof obj.maxQueue === 'number' && Number.isFinite(obj.maxQueue) && obj.maxQueue >= 0) {
      out.maxQueue = Math.floor(obj.maxQueue);
    }
    if (typeof obj.maxRequestBytes === 'number' && Number.isFinite(obj.maxRequestBytes) && obj.maxRequestBytes >= 0) {
      out.maxRequestBytes = obj.maxRequestBytes === 0 ? 0 : Math.max(1_024, Math.floor(obj.maxRequestBytes));
    }
    if (typeof obj.enableRequestLogs === 'boolean') {
      out.enableRequestLogs = obj.enableRequestLogs;
    }
    if (typeof obj.requestLogsMaxEntries === 'number' && Number.isFinite(obj.requestLogsMaxEntries) && obj.requestLogsMaxEntries >= 1) {
      out.requestLogsMaxEntries = Math.min(5_000, Math.floor(obj.requestLogsMaxEntries));
    }
    if (typeof obj.allowLocalKeySync === 'boolean') {
      out.allowLocalKeySync = obj.allowLocalKeySync;
    }
    if (typeof obj.defaultUserAgent === 'string' && obj.defaultUserAgent.trim()) {
      out.defaultUserAgent = obj.defaultUserAgent.trim();
    }
    if (typeof obj.deployUrl === 'string' && obj.deployUrl.trim()) {
      out.deployUrl = obj.deployUrl.trim().replace(/\/+$/, '');
    }
    if (typeof obj.kvUsageSampleRate === 'number' && Number.isFinite(obj.kvUsageSampleRate)) {
      out.kvUsageSampleRate = Math.min(1, Math.max(0, obj.kvUsageSampleRate));
    }
    if (obj.kvKeyUsageMode === 'off' || obj.kvKeyUsageMode === 'sampled' || obj.kvKeyUsageMode === 'full') {
      out.kvKeyUsageMode = obj.kvKeyUsageMode;
    }
    if (typeof obj.kvKeyUsageSampleRate === 'number' && Number.isFinite(obj.kvKeyUsageSampleRate)) {
      out.kvKeyUsageSampleRate = Math.min(1, Math.max(0, obj.kvKeyUsageSampleRate));
    }
    if (typeof obj.kvErrorDetailSampleRate === 'number' && Number.isFinite(obj.kvErrorDetailSampleRate)) {
      out.kvErrorDetailSampleRate = Math.min(1, Math.max(0, obj.kvErrorDetailSampleRate));
    }
    if (typeof obj.streamBytesPerToken === 'number' && Number.isFinite(obj.streamBytesPerToken) && obj.streamBytesPerToken >= 1) {
      out.streamBytesPerToken = Math.min(1_000, obj.streamBytesPerToken);
    }
    if (typeof obj.keyPoolVersionCheckTtlMs === 'number' && Number.isFinite(obj.keyPoolVersionCheckTtlMs) && obj.keyPoolVersionCheckTtlMs >= 1_000) {
      out.keyPoolVersionCheckTtlMs = Math.min(600_000, Math.floor(obj.keyPoolVersionCheckTtlMs));
    }
    if (typeof obj.selfHostedProbeIntervalMinutes === 'number' && Number.isFinite(obj.selfHostedProbeIntervalMinutes) && obj.selfHostedProbeIntervalMinutes >= 0) {
      out.selfHostedProbeIntervalMinutes = Math.min(1_440, Math.floor(obj.selfHostedProbeIntervalMinutes));
    }
    if (typeof obj.apiKeyMinLength === 'number' && Number.isFinite(obj.apiKeyMinLength) && obj.apiKeyMinLength >= 4) {
      out.apiKeyMinLength = Math.min(128, Math.floor(obj.apiKeyMinLength));
    }
    if (typeof obj.updatedAt === 'string') {
      out.updatedAt = obj.updatedAt;
    }
    return out;
  } catch {
    return {};
  }
}

export async function getRuntimeSettings(forceRefresh = false): Promise<RuntimeSettings> {
  if (!forceRefresh) {
    const g = globalThis as GlobalWithSettingsCache;
    const entry = g.__aiRelayRuntimeSettingsCache;
    if (entry && Date.now() < entry.expiresAt) {
      return entry.data;
    }
  }

  // Prefer strongly-consistent Cloudflare D1 when bound
  if (isCloudflareSync()) {
    try {
      const cfEnv = getCFEnvSync() || (await getCFEnv());
      if (cfEnv?.DB) {
        await ensureD1Schema(cfEnv.DB);
        const row = await cfEnv.DB.prepare('SELECT value FROM config_flags WHERE key = ?')
          .bind(RUNTIME_SETTINGS_KEY)
          .first<{ value: string }>();
        if (row?.value) {
          const parsed = parseSettings(row.value);
          setSettingsCache(parsed);
          return parsed;
        }
      }
    } catch {
      // Fall through to KV
    }
  }

  try {
    const kv = await getKV();
    if (kv) {
      const raw = await kv.get(RUNTIME_SETTINGS_KEY);
      const parsed = parseSettings(raw);
      const isEmpty = Object.keys(parsed).length === 0;
      setSettingsCache(parsed, isEmpty ? 3_000 : RUNTIME_SETTINGS_TTL_MS);
      return parsed;
    }
  } catch {
    // Non-fatal: fall back to empty overrides (env defaults)
  }

  setSettingsCache({}, 3_000);
  return {};
}

export function validateRuntimeSettingsPatch(input: Record<string, unknown>): RuntimeSettings {
  const patch: RuntimeSettings = {};

  if ('extraClientKeys' in input) {
    if (input.extraClientKeys === null) {
      patch.extraClientKeys = [];
    } else if (!Array.isArray(input.extraClientKeys)) {
      throw new Error('extraClientKeys must be an array of strings.');
    } else {
      const cleaned: string[] = [];
      for (const item of input.extraClientKeys) {
        if (typeof item !== 'string') throw new Error('Each client key must be a string.');
        const trimmed = item.trim();
        if (!trimmed) continue;
        if (trimmed.length < 8 || trimmed.length > 128) {
          throw new Error('Each client key must be between 8 and 128 characters.');
        }
        if (/[\s,]/.test(trimmed)) {
          throw new Error('Client keys cannot contain whitespace or commas.');
        }
        cleaned.push(trimmed);
      }
      if (cleaned.length > 50) {
        throw new Error('At most 50 managed client keys are allowed.');
      }
      patch.extraClientKeys = Array.from(new Set(cleaned));
    }
  }

  if ('cronSecret' in input) {
    if (input.cronSecret === null || input.cronSecret === '') {
      patch.cronSecret = null;
    } else if (typeof input.cronSecret !== 'string') {
      throw new Error('cronSecret must be a string or null.');
    } else {
      const trimmed = input.cronSecret.trim();
      if (trimmed.length < 8 || trimmed.length > 128) {
        throw new Error('cronSecret must be between 8 and 128 characters.');
      }
      patch.cronSecret = trimmed;
    }
  }

  if ('upstreamTimeoutMs' in input) {
    if (input.upstreamTimeoutMs === null || input.upstreamTimeoutMs === '') {
      patch.upstreamTimeoutMs = null;
    } else {
      const n = Number(input.upstreamTimeoutMs);
      if (!Number.isFinite(n) || n < 0 || n > 600_000) {
        throw new Error('upstreamTimeoutMs must be 0 (disabled) or between 1000 and 600000.');
      }
      if (n > 0 && n < 1_000) {
        throw new Error('upstreamTimeoutMs must be 0 (disabled) or at least 1000 ms.');
      }
      patch.upstreamTimeoutMs = n === 0 ? 0 : Math.floor(n);
    }
  }

  if ('maxConcurrent' in input) {
    if (input.maxConcurrent === null || input.maxConcurrent === '') {
      patch.maxConcurrent = null;
    } else {
      const n = Number(input.maxConcurrent);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        throw new Error('maxConcurrent must be an integer between 1 and 1000.');
      }
      patch.maxConcurrent = n;
    }
  }

  if ('maxQueue' in input) {
    if (input.maxQueue === null || input.maxQueue === '') {
      patch.maxQueue = null;
    } else {
      const n = Number(input.maxQueue);
      if (!Number.isInteger(n) || n < 0 || n > 5000) {
        throw new Error('maxQueue must be an integer between 0 and 5000.');
      }
      patch.maxQueue = n;
    }
  }

  if ('enableRequestLogs' in input) {
    if (input.enableRequestLogs === null) {
      patch.enableRequestLogs = null;
    } else if (typeof input.enableRequestLogs !== 'boolean') {
      throw new Error('enableRequestLogs must be a boolean or null.');
    } else {
      patch.enableRequestLogs = input.enableRequestLogs;
    }
  }

  if ('allowLocalKeySync' in input) {
    if (input.allowLocalKeySync === null) {
      patch.allowLocalKeySync = null;
    } else if (typeof input.allowLocalKeySync !== 'boolean') {
      throw new Error('allowLocalKeySync must be a boolean or null.');
    } else {
      patch.allowLocalKeySync = input.allowLocalKeySync;
    }
  }

  if ('defaultUserAgent' in input) {
    if (input.defaultUserAgent === null || input.defaultUserAgent === '') {
      patch.defaultUserAgent = null;
    } else if (typeof input.defaultUserAgent !== 'string') {
      throw new Error('defaultUserAgent must be a string or null.');
    } else {
      patch.defaultUserAgent = input.defaultUserAgent.trim().slice(0, 256);
    }
  }

  if ('deployUrl' in input) {
    if (input.deployUrl === null || input.deployUrl === '') {
      patch.deployUrl = null;
    } else if (typeof input.deployUrl !== 'string') {
      throw new Error('deployUrl must be a string or null.');
    } else {
      const trimmed = input.deployUrl.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error('deployUrl must start with http:// or https://.');
      }
      patch.deployUrl = trimmed;
    }
  }

  if ('fallbackOnTimeout' in input) {
    if (input.fallbackOnTimeout === null) {
      patch.fallbackOnTimeout = null;
    } else if (typeof input.fallbackOnTimeout !== 'boolean') {
      throw new Error('fallbackOnTimeout must be a boolean or null.');
    } else {
      patch.fallbackOnTimeout = input.fallbackOnTimeout;
    }
  }

  if ('maxRequestBytes' in input) {
    if (input.maxRequestBytes === null || input.maxRequestBytes === '') {
      patch.maxRequestBytes = null;
    } else {
      const n = Number(input.maxRequestBytes);
      if (!Number.isFinite(n) || n < 0 || n > 100 * 1024 * 1024) {
        throw new Error('maxRequestBytes must be 0 (disabled) or between 1024 and 104857600.');
      }
      if (n > 0 && n < 1_024) {
        throw new Error('maxRequestBytes must be 0 (disabled) or at least 1024 bytes.');
      }
      patch.maxRequestBytes = n === 0 ? 0 : Math.floor(n);
    }
  }

  if ('requestLogsMaxEntries' in input) {
    if (input.requestLogsMaxEntries === null || input.requestLogsMaxEntries === '') {
      patch.requestLogsMaxEntries = null;
    } else {
      const n = Number(input.requestLogsMaxEntries);
      if (!Number.isInteger(n) || n < 1 || n > 5_000) {
        throw new Error('requestLogsMaxEntries must be an integer between 1 and 5000.');
      }
      patch.requestLogsMaxEntries = n;
    }
  }

  for (const rateField of ['kvUsageSampleRate', 'kvKeyUsageSampleRate', 'kvErrorDetailSampleRate'] as const) {
    if (rateField in input) {
      const val = input[rateField];
      if (val === null || val === '') {
        patch[rateField] = null;
      } else {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0 || n > 1) {
          throw new Error(`${rateField} must be a number between 0 and 1.`);
        }
        patch[rateField] = n;
      }
    }
  }

  if ('kvKeyUsageMode' in input) {
    if (input.kvKeyUsageMode === null || input.kvKeyUsageMode === '') {
      patch.kvKeyUsageMode = null;
    } else if (input.kvKeyUsageMode !== 'off' && input.kvKeyUsageMode !== 'sampled' && input.kvKeyUsageMode !== 'full') {
      throw new Error('kvKeyUsageMode must be "off", "sampled", "full", or null.');
    } else {
      patch.kvKeyUsageMode = input.kvKeyUsageMode;
    }
  }

  if ('streamBytesPerToken' in input) {
    if (input.streamBytesPerToken === null || input.streamBytesPerToken === '') {
      patch.streamBytesPerToken = null;
    } else {
      const n = Number(input.streamBytesPerToken);
      if (!Number.isFinite(n) || n < 1 || n > 1_000) {
        throw new Error('streamBytesPerToken must be a number between 1 and 1000.');
      }
      patch.streamBytesPerToken = n;
    }
  }

  if ('keyPoolVersionCheckTtlMs' in input) {
    if (input.keyPoolVersionCheckTtlMs === null || input.keyPoolVersionCheckTtlMs === '') {
      patch.keyPoolVersionCheckTtlMs = null;
    } else {
      const n = Number(input.keyPoolVersionCheckTtlMs);
      if (!Number.isInteger(n) || n < 1_000 || n > 600_000) {
        throw new Error('keyPoolVersionCheckTtlMs must be an integer between 1000 and 600000.');
      }
      patch.keyPoolVersionCheckTtlMs = n;
    }
  }

  if ('selfHostedProbeIntervalMinutes' in input) {
    if (input.selfHostedProbeIntervalMinutes === null || input.selfHostedProbeIntervalMinutes === '') {
      patch.selfHostedProbeIntervalMinutes = null;
    } else {
      const n = Number(input.selfHostedProbeIntervalMinutes);
      if (!Number.isInteger(n) || n < 0 || n > 1_440) {
        throw new Error('selfHostedProbeIntervalMinutes must be an integer between 0 and 1440.');
      }
      patch.selfHostedProbeIntervalMinutes = n;
    }
  }

  if ('apiKeyMinLength' in input) {
    if (input.apiKeyMinLength === null || input.apiKeyMinLength === '') {
      patch.apiKeyMinLength = null;
    } else {
      const n = Number(input.apiKeyMinLength);
      if (!Number.isInteger(n) || n < 4 || n > 128) {
        throw new Error('apiKeyMinLength must be an integer between 4 and 128.');
      }
      patch.apiKeyMinLength = n;
    }
  }

  return patch;
}

export async function saveRuntimeSettings(patchInput: Record<string, unknown>): Promise<RuntimeSettings> {
  const patch = validateRuntimeSettingsPatch(patchInput);
  const current = await getRuntimeSettings(true);
  const merged: RuntimeSettings = { ...current };

  for (const [key, val] of Object.entries(patch) as Array<[keyof RuntimeSettings, unknown]>) {
    if (val === null || val === undefined) {
      delete merged[key];
    } else {
      (merged as Record<string, unknown>)[key] = val;
    }
  }
  merged.updatedAt = new Date().toISOString();

  const serialized = JSON.stringify(merged);
  let persisted = false;

  if (isCloudflareSync()) {
    const cfEnv = getCFEnvSync() || (await getCFEnv());
    if (cfEnv?.DB) {
      await ensureD1Schema(cfEnv.DB);
      await cfEnv.DB.prepare(
        `INSERT INTO config_flags (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      )
        .bind(RUNTIME_SETTINGS_KEY, serialized)
        .run();
      persisted = true;
    }
  }

  const kv = await getKV();
  if (kv) {
    await kv.set(RUNTIME_SETTINGS_KEY, serialized);
    persisted = true;
  }

  if (!persisted) {
    throw new Error('KV storage not configured — cannot persist runtime settings');
  }

  setSettingsCache(merged);
  return merged;
}
