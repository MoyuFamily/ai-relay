// ============================================================
// AI API Relay — Admin Auth Helper
// ============================================================
// Uses RELAY_ADMIN_KEY for admin authentication (falls back to RELAY_API_KEY).

import { getRelayApiKeys, constantTimeEqual, constantTimeIncludes } from '../relay/auth';

export { getRelayApiKeys };

/**
 * Get all configured admin API keys.
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
 * Returns null if valid, 503 if the server has no admin/relay keys configured,
 * or 401 if the provided token is missing/invalid.
 */
export function requireAdminAuth(request: Request): Response | null {
  const validKeys = getRelayAdminKeys();
  if (validKeys.length === 0) {
    return Response.json(
      {
        error: {
          message:
            'Server authentication is not configured. Set RELAY_API_KEY (or RELAY_ADMIN_KEY) in environment variables and redeploy.',
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
 * 2. Standard admin bearer authentication (`RELAY_ADMIN_KEY` / `RELAY_API_KEY`).
 *
 * Note: Bare `x-vercel-cron: 1` is intentionally NEVER trusted because Vercel does
 * not strip client-supplied `x-vercel-cron` headers when `CRON_SECRET` is unset.
 */
export function requireCronOrAdminAuth(request: Request): Response | null {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const headerSecret = request.headers.get('x-cron-secret')?.trim() || '';
    if (headerSecret && constantTimeEqual(headerSecret, cronSecret)) {
      return null;
    }
    const authHeader = request.headers.get('authorization');
    const bearer = authHeader?.replace(/^Bearer\s+/i, '').trim() || '';
    if (bearer && constantTimeEqual(bearer, cronSecret)) {
      return null;
    }
  }

  return requireAdminAuth(request);
}
