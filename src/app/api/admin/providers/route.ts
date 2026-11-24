// ============================================================
// AI API Relay — Admin: Custom Provider Management API
// POST/DELETE /api/admin/providers
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, saveCustomProvider, deleteCustomProvider } from '@/lib/admin';
import { clearProvidersCache } from '@/lib/providers';

export const runtime = 'nodejs';

/**
 * POST /api/admin/providers
 * Create or update a custom provider.
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  // Validate ProviderConfig
  const { name, displayName, baseUrl, headerFormat, modelPrefixes, models } = body;
  if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9_]+$/.test(name)) {
    return Response.json(
      { error: { message: 'Invalid provider ID/name. Alphanumeric and underscore only.', code: 400 } },
      { status: 400 }
    );
  }
  if (!displayName || typeof displayName !== 'string' || displayName.trim().length === 0) {
    return Response.json(
      { error: { message: 'Display name is required', code: 400 } },
      { status: 400 }
    );
  }
  if (!baseUrl || typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) {
    return Response.json(
      { error: { message: 'Base URL is required and must start with https://', code: 400 } },
      { status: 400 }
    );
  }
  if (!headerFormat || !['openai', 'anthropic', 'azure'].includes(headerFormat)) {
    return Response.json(
      { error: { message: 'Invalid header format. Must be openai, anthropic, or azure.', code: 400 } },
      { status: 400 }
    );
  }
  if (!Array.isArray(modelPrefixes) || modelPrefixes.length === 0) {
    return Response.json(
      { error: { message: 'At least one model prefix is required', code: 400 } },
      { status: 400 }
    );
  }

  const providerConfig = {
    name,
    displayName,
    baseUrl,
    headerFormat,
    modelPrefixes: modelPrefixes.map(p => p.trim()).filter(Boolean),
    envKeyField: body.envKeyField || `${name.toUpperCase()}_KEYS`,
    envBaseUrlField: body.envBaseUrlField || undefined,
    userAgent: typeof body.userAgent === 'string' && body.userAgent.trim() ? body.userAgent.trim() : undefined,
    models: Array.isArray(models) ? models : [],
    isCustom: true,
  };

  try {
    await saveCustomProvider(providerConfig);
    clearProvidersCache();
    return Response.json({ success: true, provider: providerConfig });
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message, code: 500 } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/providers
 * Delete a custom provider.
 */
export async function DELETE(request: NextRequest) {
  const authErr = await requireAdminAuth(request);
  if (authErr) return authErr;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { message: 'Invalid JSON body', code: 400 } },
      { status: 400 }
    );
  }

  const { name } = body;
  if (!name || typeof name !== 'string') {
    return Response.json(
      { error: { message: 'Provider name is required', code: 400 } },
      { status: 400 }
    );
  }

  try {
    await deleteCustomProvider(name);
    clearProvidersCache();
    return Response.json({ success: true });
  } catch (err: any) {
    return Response.json(
      { error: { message: err.message, code: 500 } },
      { status: 500 }
    );
  }
}
