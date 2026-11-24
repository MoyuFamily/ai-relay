// ============================================================
// AI API Relay — Admin Runtime Settings API
// GET/PUT /api/admin/settings
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin/auth';
import { getRuntimeSettings, saveRuntimeSettings } from '@/lib/admin/runtime-settings';
import { isCloudflareSync } from '@/lib/cf-env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getPlatformDefaultTimeoutMs(): number {
  if (process.env.VERCEL || process.env.VERCEL_ENV || process.env.CF_PAGES || isCloudflareSync()) {
    return 50_000;
  }
  return 300_000;
}

function getEnvDefaults() {
  const rawTimeout = Number(process.env.RELAY_UPSTREAM_TIMEOUT_MS);
  const rawConcurrent = parseInt(process.env.RELAY_MAX_CONCURRENT || '', 10);
  const rawQueue = parseInt(process.env.RELAY_MAX_QUEUE || '', 10);

  return {
    upstreamTimeoutMs:
      process.env.RELAY_UPSTREAM_TIMEOUT_MS && Number.isFinite(rawTimeout)
        ? rawTimeout <= 0
          ? 0
          : Math.max(1_000, Math.floor(rawTimeout))
        : getPlatformDefaultTimeoutMs(),
    maxConcurrent: Number.isFinite(rawConcurrent) && rawConcurrent >= 1 ? rawConcurrent : 3,
    maxQueue: Number.isFinite(rawQueue) && rawQueue >= 0 ? rawQueue : 10,
    enableRequestLogs: process.env.ENABLE_REQUEST_LOGS === 'true',
    allowLocalKeySync: process.env.ALLOW_LOCAL_KEY_SYNC !== 'false',
    defaultUserAgent: process.env.RELAY_DEFAULT_USER_AGENT?.trim() || '',
    deployUrl: process.env.DEPLOY_URL?.trim() || '',
    hasEnvCronSecret: Boolean(process.env.CRON_SECRET?.trim()),
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
