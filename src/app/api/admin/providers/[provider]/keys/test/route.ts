// ============================================================
// AI API Relay — Admin: Test API Key Connectivity
// POST /api/admin/providers/:provider/keys/test
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, getManagedKeys, tryDecodeBase64 } from '@/lib/admin';
import { hashKey } from '@/lib/relay';
import { getAllProviders } from '@/lib/providers';
import { buildHeaders, transformToAnthropic } from '@/lib/relay/transform';
import { getUpstreamUrl, resolveFallbackModel, resolveUpstreamModel } from '@/lib/providers/resolver';
import type { ChatCompletionRequest } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 15; // Max 15s duration for API route

type Params = Promise<{ provider: string }>;

/**
 * POST /api/admin/providers/:provider/keys/test
 *
 * Body: { key: "sk-..." } or { hash: "djb2hash" }
 */
export async function POST(request: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const { provider: providerName } = await params;
  let body: { key?: string; hash?: string; model?: string; providerConfig?: any };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  const allProviders = await getAllProviders(true);
  const provider = allProviders[providerName] ?? body.providerConfig;
  if (!provider || provider.name !== providerName) {
    return Response.json(
      { error: { message: `Unknown provider: ${providerName}`, code: 404 } },
      { status: 404 }
    );
  }

  let testKey = '';
  if (body.key && typeof body.key === 'string' && body.key.trim().length > 0) {
    testKey = tryDecodeBase64(body.key.trim());
  } else if (body.hash && typeof body.hash === 'string' && body.hash.trim().length > 0) {
    // Locate plaintext key from managed KV or static env keys by matching hash
    const managed = await getManagedKeys(providerName);
    const envKeys = provider.envKeyField
      ? (process.env[provider.envKeyField] || '').split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    const currentKeys = managed ?? envKeys;
    const match = currentKeys.find((k) => hashKey(k) === body.hash);
    if (!match) {
      return Response.json(
        { error: { message: `No key found with hash: ${body.hash}`, code: 404 } },
        { status: 404 }
      );
    }
    testKey = match;
  } else {
    // Default to the first configured key in the provider's key pool
    const managed = await getManagedKeys(providerName);
    const envKeys = provider.envKeyField
      ? (process.env[provider.envKeyField] || '').split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    const currentKeys = managed ?? envKeys;
    if (currentKeys.length > 0) {
      testKey = currentKeys[0];
    }
  }

  if (!testKey) {
    return Response.json(
      { error: { message: `No configured API keys found for provider: ${provider.displayName}`, code: 400 } },
      { status: 400 }
    );
  }

  // Construct upstream request parameters
  const url = getUpstreamUrl(provider);
  const isAnthropic = provider.headerFormat === 'anthropic';
  const targetModel = (body.model && typeof body.model === 'string' && body.model.trim().length > 0)
    ? body.model.trim()
    : await resolveFallbackModel('gpt-3.5-turbo', providerName);
  const upstreamModel = resolveUpstreamModel(targetModel, provider);

  const testBody: ChatCompletionRequest = {
    model: upstreamModel,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
  };
  const requestBody = isAnthropic ? transformToAnthropic(testBody) : testBody;

  // Use AbortController for a strict 10s upstream response timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const upstreamResponse = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(provider.headerFormat, testKey, false),
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (upstreamResponse.status === 200) {
      return Response.json({ valid: true });
    }

    // Capture precise error details from upstream if possible
    let errorMessage = '';
    try {
      const errJson = await upstreamResponse.json();
      errorMessage = errJson.error?.message || errJson.error || JSON.stringify(errJson);
    } catch {
      errorMessage = await upstreamResponse.text();
    }

    return Response.json({
      valid: false,
      status: upstreamResponse.status,
      error: errorMessage || upstreamResponse.statusText,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    return Response.json({
      valid: false,
      error: err.name === 'AbortError' ? 'Timeout (10s)' : err.message,
    });
  }
}
