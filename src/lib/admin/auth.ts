// ============================================================
// AI API Relay — Admin Auth Helper
// ============================================================
// Uses RELAY_ADMIN_KEY for admin authentication (falls back to RELAY_API_KEY,
// and finally to the one-time bootstrapped key stored in persistent storage).

import { getRelayApiKeys, constantTimeEqual, constantTimeIncludes } from '../relay/auth';
import { getEffectiveRelayAdminKeys } from './bootstrap-auth';
import { getRuntimeSettings } from './runtime-settings';

export { getRelayApiKeys };

/**
 * Get all configured admin API keys from environment variables.
 * Falls back to RELAY_API_KEY if RELAY_ADMIN_KEY is not defined.
 */
export function getRelayAdminKeys(): string[] {
  const adminKeys = (process.env.RELAY_ADMIN_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (adminKeys.length > 0) {
    return adminKeys;
  }
  return getRelayApiKeys();
}

/**
 * Validate admin authorization.
 * Returns null if valid, 503 if the server has no admin/relay keys configured
 * (neither env nor bootstrapped storage), or 401 if the provided token is missing/invalid.
 */
export async function requireAdminAuth(request: Request): Promise<Response | null> {
  const validKeys = await getEffectiveRelayAdminKeys();
  if (validKeys.length === 0) {
    return Response.json(
      {
        error: {
          message:
            'Server authentication is not configured. Visit /admin to complete first-time setup, or set RELAY_API_KEY (or RELAY_ADMIN_KEY) in environment variables.',
          type: 'server_not_configured',
          code: 503,
        },
      },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim() || '';

  if (!token) {
    return Response.json(
      { error: { message: 'Missing Authorization header. Use: Bearer <token>', code: 401 } },
      { status: 401 }
    );
  }

  if (!constantTimeIncludes(validKeys, token)) {
    return Response.json(
      { error: { message: 'Unauthorized. Invalid admin token.', code: 401 } },
      { status: 401 }
    );
  }

  return null; // valid
}

/**
 * Validate cron or admin authorization for `/api/cron/*`.
 * Accepts:
 * 1. `CRON_SECRET` via `Authorization: Bearer <CRON_SECRET>` (Vercel Cron standard)
 *    or `x-cron-secret: <CRON_SECRET>` (GitHub Actions / external schedulers),
 *    compared in constant time.
 * 2. Standard admin bearer authentication (`RELAY_ADMIN_KEY` / `RELAY_API_KEY` / bootstrapped key).
 *
 * Note: Bare `x-vercel-cron: 1` is intentionally NEVER trusted because Vercel does
 * not strip client-supplied `x-vercel-cron` headers when `CRON_SECRET` is unset.
 */
export async function requireCronOrAdminAuth(request: Request): Promise<Response | null> {
  const headerSecret = request.headers.get('x-cron-secret')?.trim() || '';
  const authHeader = request.headers.get('authorization');
  const bearer = authHeader?.replace(/^Bearer\s+/i, '').trim() || '';

  const matchesSecret = (secret: string | undefined): boolean => {
    if (!secret) return false;
    return Boolean(
      (headerSecret && constantTimeEqual(headerSecret, secret)) ||
        (bearer && constantTimeEqual(bearer, secret))
    );
  };

  const envCronSecret = process.env.CRON_SECRET?.trim();
  if (matchesSecret(envCronSecret)) {
    return null;
  }

  if (!envCronSecret && (headerSecret || bearer)) {
    const cachedSecret = (await getRuntimeSettings()).cronSecret?.trim();
    if (matchesSecret(cachedSecret)) {
      return null;
    }
    // Cross-isolate safety: if a token was supplied and didn't match cached settings,
    // force-refresh once from strongly-consistent storage (D1/Redis) before rejecting.
    const freshSecret = (await getRuntimeSettings(true)).cronSecret?.trim();
    if (matchesSecret(freshSecret)) {
      return null;
    }
  }

  return await requireAdminAuth(request);
}
