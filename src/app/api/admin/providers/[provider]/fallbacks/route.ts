// ============================================================
// AI API Relay — Admin: Provider Fallback Management
// GET/PUT /api/admin/providers/:provider/fallbacks
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, getFallbackChain, setFallbackChain, clearFallbackChain } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = Promise<{ provider: string }>;

/**
 * GET /api/admin/providers/:provider/fallbacks
 *
 * Returns the current fallback chain for a provider.
 */
export async function GET(request: NextRequest, { params }: { params: Params }) {
  const authErr = await requireAdminAuth(request);
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

  const staticFallbacks = config.fallbackProviders || (config.fallbackProvider ? [config.fallbackProvider] : []);
  const chain = await getFallbackChain(provider, staticFallbacks);
  const isOverride = chain.length !== staticFallbacks.length || chain.some((val, idx) => val !== staticFallbacks[idx]);

  // Build available models per provider for the UI
  const availableModels: Record<string, { id: string; displayName: string }[]> = {};
  for (const [name, provConfig] of Object.entries(allProviders)) {
    if (name === provider) continue; // skip self
    availableModels[name] = (provConfig.models || []).map(m => ({ id: m.id, displayName: m.displayName }));
  }

  return Response.json({
    provider,
    fallbacks: chain,
    staticDefault: config.fallbackProvider || (config.fallbackProviders && config.fallbackProviders[0]) || null,
    staticDefaults: staticFallbacks,
    isOverride,
    availableModels,
  }, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    }
  });
}

/**
 * PUT /api/admin/providers/:provider/fallbacks
 *
 * Set the fallback chain for a provider.
 * Body: { fallbacks: ["provider1", "provider2"] }
 * Pass empty array to clear all fallbacks.
 */
export async function PUT(request: NextRequest, { params }: { params: Params }) {
  const authErr = await requireAdminAuth(request);
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

  let body: { fallbacks?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.fallbacks)) {
    return Response.json(
      { error: { message: 'body.fallbacks must be an array of provider names', code: 400 } },
      { status: 400 }
    );
  }

  // Validate all fallback entries — supports both "provider" and "provider:model" format
  for (const fb of body.fallbacks) {
    if (typeof fb !== 'string') {
      return Response.json(
        { error: { message: `Invalid fallback entry: ${fb}. Must be a string.`, code: 400 } },
        { status: 400 }
      );
    }
    const colonIdx = fb.indexOf(':');
    const providerName = colonIdx >= 0 ? fb.slice(0, colonIdx) : fb;
    const modelId = colonIdx >= 0 ? fb.slice(colonIdx + 1) : null;

    if (!allProviders[providerName]) {
      return Response.json(
        { error: { message: `Invalid fallback provider: ${providerName}. Valid: ${Object.keys(allProviders).join(', ')}`, code: 400 } },
        { status: 400 }
      );
    }
    // If a model is specified, validate it exists in the target provider's model list
    if (modelId) {
      const targetModels = allProviders[providerName].models || [];
      if (!targetModels.some(m => m.id === modelId)) {
        return Response.json(
          { error: { message: `Invalid model '${modelId}' for provider '${providerName}'. Valid: ${targetModels.map(m => m.id).join(', ')}`, code: 400 } },
          { status: 400 }
        );
      }
    }
  }

  try {
    await setFallbackChain(provider, body.fallbacks as string[]);
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message || 'Failed to update fallback chain', code: 400 } },
      { status: 400 }
    );
  }

  return Response.json({
    provider,
    fallbacks: body.fallbacks,
    message: 'Fallback chain updated',
  });
}

/**
 * DELETE /api/admin/providers/:provider/fallbacks
 *
 * Reset fallback chain to static defaults.
 */
export async function DELETE(request: NextRequest, { params }: { params: Params }) {
  const authErr = await requireAdminAuth(request);
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

  await clearFallbackChain(provider);

  const staticFallbacks = config.fallbackProviders || (config.fallbackProvider ? [config.fallbackProvider] : []);

  return Response.json({
    provider,
    fallbacks: staticFallbacks,
    message: 'Fallback chain reset to static default',
  });
}
