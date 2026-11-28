// ============================================================
// AI API Relay — Web Search Config Store
// Persists web search engine settings to the shared KV backend
// (Cloudflare KV / Vercel KV / Postgres / local file), mirroring
// the getWebhookSettings/saveWebhookSettings pattern in admin-config.
// ============================================================

import { getKV } from '../admin/admin-config';
import { WEB_SEARCH_ENGINES, isWebSearchEngine, type WebSearchEngine } from './types';

const WEB_SEARCH_PREFIX = 'admin:websearch';
const CACHE_TTL_MS = 30_000;

export interface WebSearchEngineConfig {
  apiKey: string;
  /** Optional per-engine price per request; falls back to the global default. */
  pricePerRequest?: number;
}

export interface WebSearchSettings {
  activeEngine: WebSearchEngine;
  engines: Partial<Record<WebSearchEngine, WebSearchEngineConfig>>;
  /** Default price per request in the configured billing currency. */
  defaultPrice: number;
}

export const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  activeEngine: 'tavily',
  engines: {},
  defaultPrice: 0.001,
};

interface WebSearchCacheEntry {
  data: WebSearchSettings;
  at: number;
}

// Keep the cache on globalThis so it is shared across route bundles in
// OpenNext / Next.js (a module-level variable would be duplicated per bundle).
// Mirrors the __aiRelayAdminConfigCache pattern in admin-config.ts.
const cacheStore = ((globalThis as any).__aiRelayWebSearchCache ??= {
  entry: null as WebSearchCacheEntry | null,
});

export function __resetWebSearchConfigCache(): void {
  cacheStore.entry = null;
}

function normalize(raw: unknown): WebSearchSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_WEB_SEARCH_SETTINGS };
  const rec = raw as Record<string, unknown>;
  const active = typeof rec.activeEngine === 'string' && isWebSearchEngine(rec.activeEngine)
    ? rec.activeEngine
    : DEFAULT_WEB_SEARCH_SETTINGS.activeEngine;
  const engines: Partial<Record<WebSearchEngine, WebSearchEngineConfig>> = {};
  if (rec.engines && typeof rec.engines === 'object' && !Array.isArray(rec.engines)) {
    for (const [key, value] of Object.entries(rec.engines as Record<string, unknown>)) {
      if (!isWebSearchEngine(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const v = value as Record<string, unknown>;
      if (typeof v.apiKey !== 'string' || !v.apiKey.trim()) continue;
      const cfg: WebSearchEngineConfig = { apiKey: v.apiKey.trim() };
      if (typeof v.pricePerRequest === 'number' && Number.isFinite(v.pricePerRequest) && v.pricePerRequest >= 0) {
        cfg.pricePerRequest = v.pricePerRequest;
      }
      engines[key] = cfg;
    }
  }
  const defaultPrice = typeof rec.defaultPrice === 'number' && Number.isFinite(rec.defaultPrice) && rec.defaultPrice >= 0
    ? rec.defaultPrice
    : DEFAULT_WEB_SEARCH_SETTINGS.defaultPrice;
  return { activeEngine: active, engines, defaultPrice };
}

/** Read settings. API keys are included — caller must be admin-authenticated. */
export async function getWebSearchSettings(forceRefresh = false): Promise<WebSearchSettings> {
  const cached = cacheStore.entry as WebSearchCacheEntry | null;
  if (!forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  try {
    const kv = await getKV();
    if (kv) {
      const raw = await kv.get(WEB_SEARCH_PREFIX);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const settings = normalize(parsed);
        cacheStore.entry = { data: settings, at: Date.now() };
        return settings;
      }
    }
  } catch {
    // fall through to defaults
  }
  const settings = { ...DEFAULT_WEB_SEARCH_SETTINGS, engines: {} };
  cacheStore.entry = { data: settings, at: Date.now() };
  return settings;
}

/** Save full settings (replaces existing). */
export async function saveWebSearchSettings(settings: WebSearchSettings): Promise<WebSearchSettings> {
  const kv = await getKV();
  if (!kv) throw new Error('KV storage not configured — cannot persist web search settings');
  const normalized = normalize(settings);
  await kv.set(WEB_SEARCH_PREFIX, JSON.stringify(normalized));
  cacheStore.entry = { data: normalized, at: Date.now() };
  return normalized;
}

/** Resolve the active engine + key, or null when not configured. */
export async function resolveActiveWebSearch(): Promise<{ engine: WebSearchEngine; apiKey: string; pricePerRequest: number } | null> {
  const settings = await getWebSearchSettings();
  const engine = settings.activeEngine;
  const cfg = settings.engines[engine];
  if (!cfg?.apiKey) return null;
  return {
    engine,
    apiKey: cfg.apiKey,
    pricePerRequest: cfg.pricePerRequest ?? settings.defaultPrice,
  };
}

/** Configured engines (id + whether a key is present), safe for UI display (no key value). */
export async function listWebSearchEngineStatus(): Promise<Array<{ id: WebSearchEngine; configured: boolean; active: boolean }>> {
  const settings = await getWebSearchSettings();
  return WEB_SEARCH_ENGINES.map((id) => ({
    id,
    configured: Boolean(settings.engines[id]?.apiKey),
    active: id === settings.activeEngine,
  }));
}
