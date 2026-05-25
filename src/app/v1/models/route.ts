// ============================================================
// AI API Relay — GET /v1/models
//
// Lists all available models in OpenAI-compatible format.
// Spec: https://platform.openai.com/docs/api-reference/models
// ============================================================

import { NextRequest } from 'next/server';
import { getAllProviders } from '@/lib/providers';
import { getModelAliasConfig } from '@/lib/admin/admin-config';
import { getKeyPoolStats, initAllKeyPools, validateAuth } from '@/lib/relay';
import type { ModelInfo } from '@/lib/providers/types';

export const runtime = 'edge';

/** Timestamp when this relay was started (used as model creation date) */
const RELAY_CREATED = Math.floor(Date.now() / 1000);

/**
 * Build the full models list from provider registry.
 */
async function getAllModels(): Promise<Array<ModelInfo & { owned_by: string; configured: boolean }>> {
  const allProviders = await getAllProviders();
  await initAllKeyPools(allProviders);
  const poolStats = getKeyPoolStats();

  const models: Array<ModelInfo & { owned_by: string; configured: boolean }> = [];

  for (const [providerId, config] of Object.entries(allProviders)) {
    const configured = config.envKeyField ? (!!process.env[config.envKeyField] || (poolStats[providerId]?.total > 0)) : (poolStats[providerId]?.total > 0);
    const hasKeys = (poolStats[providerId]?.available || 0) > 0;

    if (config.models && config.models.length > 0) {
      // Use explicit model list
      for (const model of config.models) {
        models.push({
          ...model,
          owned_by: providerId,
          configured: configured && hasKeys,
        });
      }
    } else {
      // Fallback: generate placeholder models from prefixes
      for (const prefix of config.modelPrefixes) {
        models.push({
          id: `${prefix}default`,
          displayName: `${config.displayName} (${prefix}*)`,
          contextWindow: 128000,
          owned_by: providerId,
          configured: configured && hasKeys,
        });
      }
    }
  }

  return models;
}

/**
 * GET /v1/models
 *
 * Returns all available models in OpenAI-compatible format.
 */
export async function GET(request: NextRequest) {
  // Optional: auth check (some clients expect /v1/models to be public)
  const authHeader = request.headers.get('authorization');

  // If auth is provided, validate it; otherwise allow unauthenticated access
  if (authHeader) {
    const isValid = await validateAuth(request);
    if (!isValid) {
      return Response.json(
        { error: { message: 'Invalid API key.', type: 'invalid_request_error', code: 401 } },
        { status: 401 }
      );
    }
  }

  const allModels = await getAllModels();
  const aliasConfig = await getModelAliasConfig();
  const hiddenModels = new Set(aliasConfig.hidden);
  const visibleModels = allModels.filter((model) => !hiddenModels.has(model.id));

  // OpenAI-compatible response format
  return Response.json({
    object: 'list',
    data: visibleModels.map((model) => ({
      id: model.id,
      object: 'model',
      created: RELAY_CREATED,
      owned_by: model.owned_by,
      // Extended fields (non-standard but useful)
      display_name: model.displayName,
      context_window: model.contextWindow,
      max_output: model.maxOutput || null,
      supports_stream: model.supportsStream ?? true,
      supports_vision: model.supportsVision ?? false,
      supports_tools: model.supportsTools ?? false,
      pricing: model.pricing || null,
      configured: model.configured,
    })),
  });
}
