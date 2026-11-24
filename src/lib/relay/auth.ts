// ============================================================
// AI API Relay — Auth Validation (Edge / CF Workers / Node)
// ============================================================

/**
 * Constant-time string comparison compatible with Edge, Cloudflare Workers,
 * and Node.js without requiring `node:crypto`.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function constantTimeIncludes(candidates: string[], token: string): boolean {
  let matched = false;
  for (const candidate of candidates) {
    if (constantTimeEqual(candidate, token)) {
      matched = true;
    }
  }
  return matched;
}

function base64urlEncode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64url');
  }
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'base64url').toString('utf8');
  }
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

import { getBootstrappedApiKey, getEffectiveRelayApiKeys } from '../admin/bootstrap-auth';

/**
 * Get the signing secret for generating/validating temporary keys.
 * Falls back to the bootstrapped storage key when env vars are unset.
 * Returns null if no secret is configured — never falls back to a hardcoded
 * public constant, preventing forged temporary tokens on misconfigured instances.
 */
async function getSigningSecret(): Promise<string | null> {
  const secret = process.env.RELAY_SIGNING_SECRET?.trim();
  if (secret) return secret;

  // Fallback to first admin key
  const adminKeys = (process.env.RELAY_ADMIN_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (adminKeys.length > 0) return adminKeys[0];

  // Fallback to first api key
  const apiKeys = (process.env.RELAY_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (apiKeys.length > 0) return apiKeys[0];

  // Fallback to one-time bootstrapped key stored in KV/D1/Disk/Postgres
  const bootstrapped = await getBootstrappedApiKey();
  if (bootstrapped) return bootstrapped;

  return null;
}

/**
 * Sign payload using HMAC-SHA256. Works in Edge, Cloudflare Workers, and Node.js.
 */
async function signPayload(payloadStr: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const secretData = encoder.encode(secret);
  const payloadData = encoder.encode(payloadStr);

  const key = await crypto.subtle.importKey(
    'raw',
    secretData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, payloadData);

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a cryptographically signed temporary request key.
 */
export async function generateTempKey(durationSeconds: number): Promise<{ key: string; expiresAt: string }> {
  const secret = await getSigningSecret();
  if (!secret) {
    throw new Error(
      'Signing secret is not configured. Set RELAY_SIGNING_SECRET, RELAY_ADMIN_KEY, or RELAY_API_KEY.'
    );
  }
  const exp = Date.now() + durationSeconds * 1000;
  const payload = {
    exp,
    created: Date.now(),
  };
  const payloadStr = JSON.stringify(payload);
  const payloadBase64 = base64urlEncode(payloadStr);
  const signature = await signPayload(payloadBase64, secret);
  const key = `sk-relay-temp-${payloadBase64}.${signature}`;
  return {
    key,
    expiresAt: new Date(exp).toISOString(),
  };
}

/**
 * Validate a temporary request key.
 */
export async function validateTempKey(token: string): Promise<boolean> {
  try {
    const secret = await getSigningSecret();
    if (!secret) return false;

    const prefix = 'sk-relay-temp-';
    if (!token.startsWith(prefix)) return false;

    const parts = token.slice(prefix.length).split('.');
    if (parts.length !== 2) return false;

    const [payloadBase64, signature] = parts;
    if (!payloadBase64 || !signature) return false;

    const expectedSignature = await signPayload(payloadBase64, secret);
    if (!constantTimeEqual(signature, expectedSignature)) {
      return false;
    }

    const payloadStr = base64urlDecode(payloadBase64);
    const payload = JSON.parse(payloadStr);

    if (typeof payload.exp !== 'number') return false;
    if (Date.now() > payload.exp) {
      return false; // Expired
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the relay API key from the Authorization or x-api-key header.
 * Returns true if valid, false otherwise.
 */
export async function validateAuth(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization');
  const anthropicKeyHeader = request.headers.get('x-api-key');
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim() || anthropicKeyHeader?.trim() || '';
  if (!token) return false;

  if (token.startsWith('sk-relay-temp-')) {
    return await validateTempKey(token);
  }

  const validKeys = await getEffectiveRelayApiKeys();
  if (validKeys.length === 0) return false;
  return constantTimeIncludes(validKeys, token);
}

/**
 * Get all configured relay API keys.
 */
export function getRelayApiKeys(): string[] {
  return (process.env.RELAY_API_KEY || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/**
 * Validate auth and return error response if invalid.
 * Returns null if auth is valid.
 */
export async function requireAuth(request: Request): Promise<Response | null> {
  if (!(await validateAuth(request))) {
    return new Response(
      JSON.stringify({
        error: {
          message: 'Invalid API key. Provide a valid key in the Authorization header.',
          type: 'authentication_error',
          code: 401,
        },
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return null;
}
