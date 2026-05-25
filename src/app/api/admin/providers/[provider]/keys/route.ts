// ============================================================
// AI API Relay — Admin: Provider API Key Management
// GET/POST/DELETE /api/admin/providers/:provider/keys
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, getManagedKeys, removeManagedKey, setManagedKeys, tryDecodeBase64 } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';
import { hashKey, updateMemoryKeyPool } from '@/lib/relay';
import { KVUsageStorage } from '@/lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = Promise<{ provider: string }>;

/** Mask an API key for safe display: show first 4 and last 4 chars */
function maskKey(key: string): string {
  if (key.length <= 12) return key.slice(0, 4) + '***';
  return key.slice(0, 4) + '***' + key.slice(-4);
}

/**
 * GET /api/admin/providers/:provider/keys
 *
 * Lists API keys for a provider (masked).
 * Returns managed keys from KV if set, otherwise shows env var keys.
 */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const { provider } = await params;
  const allProviders = await getAllProviders(true);
  const config = allProviders[provider];
  if (!config) {
    return Response.json(
      { error: { message: `Unknown provider: ${provider}. Valid: ${Object.keys(allProviders).join(', ')}`, code: 404 } },
      { status: 404 }
    );
  }

  const managedKeys = await getManagedKeys(provider);
  const envKeys = config.envKeyField
    ? (process.env[config.envKeyField] || '').split(',').map((k) => k.trim()).filter(Boolean)
    : [];

  // If managed keys exist, those are authoritative; otherwise use env keys
  const source = managedKeys ? 'managed' : 'env';
  const keys = managedKeys ?? envKeys;

  const keyList = keys.map((key) => ({
    hash: hashKey(key),
    masked: maskKey(key),
    source,
  }));

  return Response.json({
    provider,
    source,
    count: keyList.length,
    keys: keyList,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    }
  });
}

/**
 * POST /api/admin/providers/:provider/keys
 *
 * Add one or more API keys for a provider.
 * Body: { key: "sk-..." } or { keys: ["sk-...", "sk-..."] }
 */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const { provider } = await params;
  const allProviders = await getAllProviders(true);
  const config = allProviders[provider];
  if (!config) {
    return Response.json(
      { error: { message: `Unknown provider: ${provider}`, code: 404 } },
      { status: 404 }
    );
  }

  let body: { key?: unknown; keys?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  const rawKeys = Array.isArray(body.keys)
    ? body.keys
    : typeof body.key === 'string'
      ? [body.key]
      : [];

  if (rawKeys.length === 0) {
    return Response.json(
      { error: { message: 'Provide body.key as a non-empty string or body.keys as an array', code: 400 } },
      { status: 400 }
    );
  }

  const decodedKeys = rawKeys
    .filter((key): key is string => typeof key === 'string')
    .map((key) => tryDecodeBase64(key.trim()))
    .filter(Boolean);

  if (decodedKeys.length === 0) {
    return Response.json(
      { error: { message: 'No valid keys provided', code: 400 } },
      { status: 400 }
    );
  }

  const envKeys = config.envKeyField
    ? (process.env[config.envKeyField] || '').split(',').map((k) => k.trim()).filter(Boolean)
    : [];
  const existing = await getManagedKeys(provider);
  const current = existing ? [...existing] : [...envKeys];
  const initialCount = current.length;
  const addedKeys: string[] = [];
  const duplicateKeys: string[] = [];
  const results: Array<{ hash: string; masked: string; added: boolean; duplicate: boolean }> = [];

  for (const newKey of decodedKeys) {
    if (current.includes(newKey)) {
      duplicateKeys.push(newKey);
      results.push({
        hash: hashKey(newKey),
        masked: maskKey(newKey),
        added: false,
        duplicate: true,
      });
      continue;
    }
    current.push(newKey);
    addedKeys.push(newKey);
    results.push({
      hash: hashKey(newKey),
      masked: maskKey(newKey),
      added: true,
      duplicate: false,
    });
  }

  if (addedKeys.length > 0) {
    await setManagedKeys(provider, current);
    updateMemoryKeyPool(provider, current);
  }

  return Response.json({
    provider,
    keyHash: addedKeys.length === 1 ? hashKey(addedKeys[0]) : null,
    masked: addedKeys.length === 1 ? maskKey(addedKeys[0]) : null,
    totalCount: current.length,
    addedCount: addedKeys.length,
    duplicateCount: duplicateKeys.length,
    submittedCount: decodedKeys.length,
    message: addedKeys.length === 0
      ? 'Keys already exist'
      : addedKeys.length === 1
        ? 'Key added'
        : `${addedKeys.length} keys added`,
    added: current.length > initialCount,
    results,
  });
}

/**
 * DELETE /api/admin/providers/:provider/keys
 *
 * Remove an API key from a provider.
 * Body: { key: "full-key-value" } or { hash: "djb2hash" }
 */
export async function DELETE(request: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const { provider } = await params;
  const allProviders = await getAllProviders(true);
  const config = allProviders[provider];
  if (!config) {
    return Response.json(
      { error: { message: `Unknown provider: ${provider}`, code: 404 } },
      { status: 404 }
    );
  }

  let body: { key?: string; hash?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  if (!body.key && !body.hash) {
    return Response.json(
      { error: { message: 'Provide either body.key (full value) or body.hash (djb2 hash)', code: 400 } },
      { status: 400 }
    );
  }

  try {
    const envKeys = config.envKeyField
      ? (process.env[config.envKeyField] || '').split(',').map((k) => k.trim()).filter(Boolean)
      : [];

    // If hash is provided, we need to find the actual key first
    if (body.hash && !body.key) {
      const managed = await getManagedKeys(provider);
      const currentKeys = managed ?? envKeys;
      const match = currentKeys.find((k) => hashKey(k) === body.hash);
      if (!match) {
        return Response.json(
          { error: { message: `No key with hash ${body.hash}`, code: 404 } },
          { status: 404 }
        );
      }
      body.key = match;
    }

    const keyHash = hashKey(body.key!);
    const remaining = await removeManagedKey(provider, body.key!, envKeys);
    updateMemoryKeyPool(provider, remaining);

    // Clear key errors from storage when a key is deleted
    const usageStorage = new KVUsageStorage();
    await usageStorage.clearKeyErrors(keyHash);

    return Response.json({
      provider,
      removedHash: keyHash,
      remainingCount: remaining.length,
      message: 'Key removed',
    });
  } catch (err) {
    return Response.json(
      { error: { message: (err as Error).message, code: 404 } },
      { status: 404 }
    );
  }
}
