// ============================================================
// AI API Relay — Admin Runtime Settings API
// GET/PUT /api/admin/settings
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin/auth';
import { getRuntimeSettings, saveRuntimeSettings } from '@/lib/admin/runtime-settings';
import { getDefaultUpstreamTimeoutMs } from '@/lib/relay/relay';
import { getDefaultMaxConcurrent, getDefaultMaxQueue } from '@/lib/relay/concurrency';
import { getDefaultMaxRequestBytes } from '@/lib/relay/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBoundedRate(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function getEnvDefaults() {
  const rawTimeout = Number(process.env.RELAY_UPSTREAM_TIMEOUT_MS);
  const rawConcurrent = parseInt(process.env.RELAY_MAX_CONCURRENT || '', 10);
  const rawQueue = parseInt(process.env.RELAY_MAX_QUEUE || '', 10);
  const rawMaxBytes = Number(process.env.RELAY_MAX_REQUEST_BYTES);
  const rawLogEntries = parseInt(process.env.REQUEST_LOGS_MAX_ENTRIES || '', 10);
  const rawStreamBytes = Number(process.env.RELAY_STREAM_BYTES_PER_TOKEN);
  const rawKeyPoolTtl = parseInt(process.env.RELAY_KEY_POOL_VERSION_CHECK_TTL_MS || '', 10);
  const rawProbeInterval = parseInt(process.env.SELF_HOSTED_PROBE_INTERVAL_MINUTES || '', 10);
  const rawMinKeyLen = parseInt(process.env.RELAY_API_KEY_MIN_LENGTH || '', 10);
  const rawFallbackTimeout = process.env.RELAY_FALLBACK_ON_TIMEOUT?.trim().toLowerCase();
  const rawKeyUsageMode = (process.env.RELAY_KV_KEY_USAGE_MODE || 'off').trim().toLowerCase();

  return {
    upstreamTimeoutMs:
      process.env.RELAY_UPSTREAM_TIMEOUT_MS && Number.isFinite(rawTimeout)
        ? rawTimeout <= 0
          ? 0
          : Math.max(1_000, Math.floor(rawTimeout))
        : getDefaultUpstreamTimeoutMs(),
    fallbackOnTimeout: rawFallbackTimeout === 'true' || rawFallbackTimeout === '1',
    maxConcurrent: Number.isFinite(rawConcurrent) && rawConcurrent >= 1 ? rawConcurrent : getDefaultMaxConcurrent(),
    maxQueue: Number.isFinite(rawQueue) && rawQueue >= 0 ? rawQueue : getDefaultMaxQueue(),
    maxRequestBytes:
      process.env.RELAY_MAX_REQUEST_BYTES !== undefined &&
      process.env.RELAY_MAX_REQUEST_BYTES.trim() !== '' &&
      Number.isFinite(rawMaxBytes) &&
      rawMaxBytes >= 0
        ? Math.floor(rawMaxBytes)
        : getDefaultMaxRequestBytes(),
    enableRequestLogs: process.env.ENABLE_REQUEST_LOGS === 'true',
    requestLogsMaxEntries: Number.isFinite(rawLogEntries) && rawLogEntries >= 1 ? rawLogEntries : 100,
    allowLocalKeySync: process.env.ALLOW_LOCAL_KEY_SYNC !== 'false',
    defaultUserAgent: process.env.RELAY_DEFAULT_USER_AGENT?.trim() || '',
    deployUrl: process.env.DEPLOY_URL?.trim() || '',
    hasEnvCronSecret: Boolean(process.env.CRON_SECRET?.trim()),
    kvUsageSampleRate: parseBoundedRate(process.env.RELAY_KV_USAGE_SAMPLE_RATE, 1),
    kvKeyUsageMode: (rawKeyUsageMode === 'sampled' || rawKeyUsageMode === 'full' ? rawKeyUsageMode : 'off') as
      | 'off'
      | 'sampled'
      | 'full',
    kvKeyUsageSampleRate: parseBoundedRate(process.env.RELAY_KV_KEY_USAGE_SAMPLE_RATE, 0.1),
    kvErrorDetailSampleRate: parseBoundedRate(process.env.RELAY_KV_ERROR_DETAIL_SAMPLE_RATE, 0.2),
    streamBytesPerToken:
      process.env.RELAY_STREAM_BYTES_PER_TOKEN && Number.isFinite(rawStreamBytes) && rawStreamBytes >= 1
        ? rawStreamBytes
        : 20,
    keyPoolVersionCheckTtlMs:
      Number.isFinite(rawKeyPoolTtl) && rawKeyPoolTtl >= 1_000 ? rawKeyPoolTtl : 30_000,
    selfHostedProbeIntervalMinutes:
      process.env.SELF_HOSTED_PROBE_INTERVAL_MINUTES !== undefined &&
      process.env.SELF_HOSTED_PROBE_INTERVAL_MINUTES.trim() !== '' &&
      Number.isFinite(rawProbeInterval) &&
      rawProbeInterval >= 0
        ? rawProbeInterval
        : 60,
    apiKeyMinLength: Number.isFinite(rawMinKeyLen) && rawMinKeyLen >= 4 ? rawMinKeyLen : 20,
  };
}

export async function GET(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  const settings = await getRuntimeSettings(true);
  return Response.json(
    {
      settings,
      defaults: getEnvDefaults(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}

export async function PUT(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return Response.json(
        { error: { message: 'Request body must be a JSON object.', code: 400 } },
        { status: 400 }
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body.', code: 400 } },
      { status: 400 }
    );
  }

  try {
    const updated = await saveRuntimeSettings(body);
    return Response.json(
      {
        success: true,
        settings: updated,
        defaults: getEnvDefaults(),
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save runtime settings';
    const isStorageUnavailable = /KV storage not configured/i.test(message);
    const isValidation = !isStorageUnavailable && /must (?:be|start)|cannot contain|At most/i.test(message);
    const status = isStorageUnavailable ? 503 : isValidation ? 400 : 500;
    return Response.json(
      {
        error: {
          message,
          type: isStorageUnavailable ? 'storage_not_configured' : isValidation ? 'invalid_request' : 'server_error',
          code: status,
        },
      },
      { status }
    );
  }
}
