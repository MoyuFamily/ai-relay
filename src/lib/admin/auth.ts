// ============================================================
// AI API Relay — Admin Auth Helper
// ============================================================
// Uses RELAY_ADMIN_KEY for admin authentication (falls back to RELAY_API_KEY).

import { getRelayApiKeys, constantTimeIncludes } from '../relay/auth';

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
 * Returns null if valid, or a 401 Response if invalid.
 */
export function requireAdminAuth(request: Request): Response | null {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim() || '';

  if (!token) {
    return Response.json(
      { error: { message: 'Missing Authorization header. Use: Bearer <token>', code: 401 } },
      { status: 401 }
    );
  }

  const validKeys = getRelayAdminKeys();
  if (validKeys.length === 0 || !constantTimeIncludes(validKeys, token)) {
    return Response.json(
      { error: { message: 'Unauthorized. Invalid admin token.', code: 401 } },
      { status: 401 }
    );
  }

  return null; // valid
}
