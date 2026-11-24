// ============================================================
// AI Relay — Local Device Authentication (Multi-Platform)
// ============================================================

import { getKV } from '@/lib/admin/admin-config';
import { getBootstrappedApiKey } from '@/lib/admin/bootstrap-auth';
import { validateAuth } from '@/lib/relay/auth';
import { requireAdminAuth } from '@/lib/admin/auth';

async function resolveDeviceTokenSecret(): Promise<string | null> {
  const explicit = process.env.DEVICE_TOKEN_SECRET?.trim();
  if (explicit) return explicit;

  // Domain-separated fallback derived from configured relay secrets so
  // Cloudflare/Vercel deployments that only set RELAY_API_KEY work out of the box.
  const signing = process.env.RELAY_SIGNING_SECRET?.trim();
  if (signing) return `ai-relay:device-token:v1:${signing}`;

  const adminKey = (process.env.RELAY_ADMIN_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)[0];
  if (adminKey) return `ai-relay:device-token:v1:${adminKey}`;

  const apiKey = (process.env.RELAY_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)[0];
  if (apiKey) return `ai-relay:device-token:v1:${apiKey}`;

  const bootstrapped = await getBootstrappedApiKey();
  if (bootstrapped) return `ai-relay:device-token:v1:${bootstrapped}`;

  return null;
}

/**
 * Hash a device token using HMAC-SHA256.
 * Used for storing device credentials securely in KV/database.
 */
export async function hashDeviceToken(token: string): Promise<string> {
  const secret = await resolveDeviceTokenSecret();

  if (!secret) {
    throw new Error(
      'Device token secret is not configured. Set DEVICE_TOKEN_SECRET, RELAY_SIGNING_SECRET, RELAY_ADMIN_KEY, or RELAY_API_KEY.'
    );
  }

  const encoder = new TextEncoder();
  const secretData = encoder.encode(secret);
  const tokenData = encoder.encode(token);

  const key = await crypto.subtle.importKey(
    'raw',
    secretData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, tokenData);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a bearer device token against the KV reverse index (`device_token:{hash}`).
 * Returns the bound `deviceId` if valid, or `null` otherwise.
 */
export async function verifyDeviceToken(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const kv = await getKV();
    if (!kv) return null;
    const tokenHash = await hashDeviceToken(token);
    const deviceId = await kv.get(`device_token:${tokenHash}`);
    return typeof deviceId === 'string' && deviceId.length > 0 ? deviceId : null;
  } catch {
    return null;
  }
}

/**
 * Authenticate requests to `/api/local/config/*`.
 * Accepts a verified device token (`Bearer dt_...`), a valid admin token,
 * or a valid relay API key. Returns a 401 Response if unauthenticated.
 */
export async function requireLocalSyncAuth(request: Request): Promise<Response | null> {
  const authHeader = request.headers.get('authorization');
  const bearerToken = authHeader?.replace(/^Bearer\s+/i, '').trim() || '';

  if (bearerToken.startsWith('dt_')) {
    const deviceId = await verifyDeviceToken(bearerToken);
    if (deviceId) return null;
  }

  if ((await requireAdminAuth(request)) === null) {
    return null;
  }

  if (await validateAuth(request)) {
    return null;
  }

  return Response.json(
    {
      error: {
        message: 'Unauthorized. Provide a valid device token or API key.',
        type: 'authentication_error',
        code: 401,
      },
    },
    { status: 401 }
  );
}
