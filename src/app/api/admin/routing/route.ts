// ============================================================
// AI Relay v2.5 — Smart Routing Admin API
// ============================================================
// GET  /api/admin/routing  → get routing status + config
// PUT  /api/admin/routing  → update routing config
// POST /api/admin/routing  → reset provider failures

import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getAllProviders } from '@/lib/providers';
import {
  getRoutingConfig,
  saveRoutingConfig,
  getRoutingStatus,
  resetProviderFailures,
} from '@/lib/smart-routing';
import type { RoutingConfig, RoutingStrategy } from '@/lib/smart-routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;

  try {
    const [config, providers] = await Promise.all([
      getRoutingConfig(),
      getAllProviders(),
    ]);

    const providerNames = Object.keys(providers);
    const displayNames: Record<string, string> = {};
    for (const [id, p] of Object.entries(providers)) {
      displayNames[id] = p.displayName;
    }

    const status = await getRoutingStatus(providerNames, displayNames);

    return Response.json({
      config,
      status,
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to fetch routing data' } },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;

  try {
    const body = await request.json();

    // Validate strategy
    const validStrategies: RoutingStrategy[] = ['latency', 'cost', 'availability'];
    if (body.strategy && !validStrategies.includes(body.strategy)) {
      return Response.json(
        { error: { message: `Invalid strategy: ${body.strategy}. Must be one of: ${validStrategies.join(', ')}` } },
        { status: 400 }
      );
    }

    // Validate numeric fields
    const partial: Partial<RoutingConfig> = {};
    if (typeof body.enabled === 'boolean') partial.enabled = body.enabled;
    if (body.strategy) partial.strategy = body.strategy;
    if (typeof body.preferredProviderTolerancePercent === 'number') {
      partial.preferredProviderTolerancePercent = Math.max(0, Math.min(100, body.preferredProviderTolerancePercent));
    }
    if (typeof body.maxLatencyMs === 'number') partial.maxLatencyMs = Math.max(100, Math.min(60000, body.maxLatencyMs));
    if (typeof body.failureThreshold === 'number') partial.failureThreshold = Math.max(1, Math.min(20, body.failureThreshold));
    if (typeof body.recoverySeconds === 'number') partial.recoverySeconds = Math.max(5, Math.min(300, body.recoverySeconds));
    if (typeof body.stickySession === 'boolean') partial.stickySession = body.stickySession;
    if (typeof body.maxRetries === 'number') partial.maxRetries = Math.max(1, Math.min(10, body.maxRetries));
    if (body.costWeights && Array.isArray(body.costWeights)) {
      partial.costWeights = body.costWeights;
    }
    if (body.providerTimeoutMs && typeof body.providerTimeoutMs === 'object') {
      partial.providerTimeoutMs = body.providerTimeoutMs;
    }

    const updated = await saveRoutingConfig(partial);

    return Response.json({ config: updated });
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to update routing config' } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;

  try {
    const body = await request.json();

    if (body.action === 'reset_failures' && body.provider) {
      resetProviderFailures(body.provider);
      return Response.json({ success: true, message: `Reset failure counter for ${body.provider}` });
    }

    return Response.json(
      { error: { message: 'Invalid action. Use { action: "reset_failures", provider: "..." }' } },
      { status: 400 }
    );
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to process request' } },
      { status: 500 }
    );
  }
}
