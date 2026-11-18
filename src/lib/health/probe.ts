// ============================================================
// AI Relay — Shared Provider Health Probe Runner
// ============================================================

import { getAllProviders } from '@/lib/providers';
import { normalizeUpstreamBase } from '@/lib/providers/resolver';
import type { ProviderConfig } from '@/lib/providers';
import { getKeyPool } from '@/lib/relay/key-pool';
import { buildHeaders } from '@/lib/relay/transform';
import { recordHealthProbeResult, type ProviderHealthRecord } from '@/lib/health/storage';

export interface ProviderProbeResult {
  ok: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  error?: string;
  skipped?: boolean;
}

export async function probeProvider(provider: ProviderConfig): Promise<ProviderProbeResult> {
  const pool = await getKeyPool(provider);
  const key = pool.keys[0];
  if (!key) {
    return { ok: false, statusCode: null, responseTimeMs: null, skipped: true, error: 'no_available_key' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const started = Date.now();
  const rawBase = (provider.envBaseUrlField ? process.env[provider.envBaseUrlField] : undefined) || provider.baseUrl;
  const normalizedBase = provider.headerFormat === 'anthropic'
    ? normalizeUpstreamBase(rawBase)
    : rawBase.trim().replace(/\/+$/, '');
  try {
    const res = await fetch(`${normalizedBase}/models`, {
      method: 'GET',
      headers: buildHeaders(provider.headerFormat, key.key, false, undefined, provider.userAgent),
      signal: controller.signal,
    });
    const responseTimeMs = Date.now() - started;
    // Release the outbound stream immediately (Cloudflare Workers 6-socket cap)
    res.body?.cancel?.().catch(() => {});
    return {
      ok: res.ok,
      statusCode: res.status,
      responseTimeMs,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: null,
      responseTimeMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeAllProviders(
  forceRefresh = false,
  timestamp = new Date().toISOString()
): Promise<{ timestamp: string; providers: ProviderHealthRecord[] }> {
  const providers = await getAllProviders(forceRefresh);
  const results: ProviderHealthRecord[] = [];

  for (const [id, provider] of Object.entries(providers)) {
    const probe = await probeProvider(provider);
    const record = await recordHealthProbeResult({
      providerId: id,
      providerName: provider.displayName,
      ok: probe.ok,
      statusCode: probe.statusCode,
      responseTimeMs: probe.responseTimeMs,
      checkedAt: timestamp,
      error: probe.error,
      skipped: probe.skipped,
    });
    results.push(record);
  }

  return { timestamp, providers: results };
}
