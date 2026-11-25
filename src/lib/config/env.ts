// ============================================================
// AI API Relay — Environment Variable Configuration & Audit
// ============================================================

/**
 * Centralized env var access with type safety.
 * All environment variables used by the application are documented here.
 *
 * === ENVIRONMENT VARIABLE AUDIT ===
 *
 * [Required]
 *   RELAY_API_KEY        — Comma-separated API keys for relay auth (also used for admin auth)
 *
 * [Provider Keys] (at least one required)
 *   OPENAI_KEYS                — Comma-separated OpenAI API keys
 *   CLAUDE_KEYS                — Comma-separated Anthropic API keys
 *   DEEPSEEK_KEYS              — Comma-separated DeepSeek API keys
 *   XIAOMIMIMO_SGP_CODING_KEYS — Comma-separated Xiaomi MiMo SGP Coding API keys
 *   XIAOMI_KEYS                — Comma-separated Xiaomi MiMo CN API keys (legacy compat)
 *   XIAOMI_CODING_KEYS         — Comma-separated Xiaomi MiMo CN Coding API keys
 *
 * [Provider Base URLs] (optional — override defaults)
 *   OPENAI_BASE_URL            — Custom OpenAI API base URL
 *   CLAUDE_BASE_URL            — Custom Anthropic API base URL
 *   DEEPSEEK_BASE_URL          — Custom DeepSeek API base URL
 *   XIAOMIMIMO_SGP_CODING_BASE_URL — Custom Xiaomi MiMo SGP Coding API base URL
 *   XIAOMI_BASE_URL            — Custom Xiaomi MiMo CN API base URL
 *   XIAOMI_CODING_BASE_URL     — Custom Xiaomi MiMo CN Coding API base URL
 *
 * [Vercel KV] (optional — graceful degradation if missing)
 *   KV_REST_API_URL      — Vercel KV REST API URL
 *   KV_REST_API_TOKEN    — Vercel KV REST API token
 *
 * [Rate Limiting] (optional)
 *   RELAY_DAILY_LIMIT    — Max requests per day (0 = unlimited)
 *   RELAY_MONTHLY_LIMIT  — Max requests per month (0 = unlimited)
 *
 * [Upstream Request] (optional)
 *   RELAY_DEFAULT_USER_AGENT — User-Agent presented to upstream when the client
 *                              UA is missing or a blocked generic script UA
 *                              (e.g. python-requests). Defaults to a neutral SDK
 *                              UA matching the upstream format; never reveals the relay.
 *
 * [Admin UI] (optional)
 *   RELAY_API_KEY_MIN_LENGTH — Minimum length for API keys added via the admin UI (default: 20)
 *
 * [Postgres] (optional — for S1+ when Drizzle is active)
 *   DATABASE_URL         — Postgres connection string (e.g. postgres://user:pass@host:5432/db)
 *
 * [Vercel Auto-injected]
 *   VERCEL               — "1" when running on Vercel
 *   VERCEL_ENV           — "production" | "preview" | "development"
 *   VERCEL_REGION        — Deployment region (e.g. "iad1")
 */

// ── Config Accessor ──────────────────────────────────────────

export function getEnv(key: string, fallback?: string): string | undefined {
  return process.env[key] ?? fallback;
}

export function getEnvRequired(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function getEnvInt(key: string, fallback: number = 0): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? fallback : parsed;
}

// ── Typed Config ─────────────────────────────────────────────

export interface RelayConfig {
  apiKeys: string[];
  dailyLimit: number;
  monthlyLimit: number;
  vercelEnv: string | undefined;
  vercelRegion: string | undefined;
}

export function getRelayConfig(): RelayConfig {
  const rawKeys = process.env.RELAY_API_KEY || '';
  return {
    apiKeys: rawKeys.split(',').map(k => k.trim()).filter(Boolean),
    dailyLimit: getEnvInt('RELAY_DAILY_LIMIT'),
    monthlyLimit: getEnvInt('RELAY_MONTHLY_LIMIT'),
    vercelEnv: getEnv('VERCEL_ENV'),
    vercelRegion: getEnv('VERCEL_REGION'),
  };
}

// ── Provider Key Config ──────────────────────────────────────

export interface ProviderEnvConfig {
  keys: string[];
  baseUrl?: string;
}

export const PROVIDER_ENV_MAP: Record<string, { keyField: string; baseUrlField: string }> = {
  openai: { keyField: 'OPENAI_KEYS', baseUrlField: 'OPENAI_BASE_URL' },
  anthropic: { keyField: 'CLAUDE_KEYS', baseUrlField: 'CLAUDE_BASE_URL' },
  google: { keyField: 'GEMINI_KEYS', baseUrlField: 'GEMINI_BASE_URL' },
  deepseek: { keyField: 'DEEPSEEK_KEYS', baseUrlField: 'DEEPSEEK_BASE_URL' },
  openrouter: { keyField: 'OPENROUTER_KEYS', baseUrlField: 'OPENROUTER_BASE_URL' },
  xiaomi_sgp_coding: { keyField: 'XIAOMIMIMO_SGP_CODING_KEYS', baseUrlField: 'XIAOMIMIMO_SGP_CODING_BASE_URL' },
  xiaomi: { keyField: 'XIAOMI_KEYS', baseUrlField: 'XIAOMI_BASE_URL' },
  xiaomi_coding: { keyField: 'XIAOMI_CODING_KEYS', baseUrlField: 'XIAOMI_CODING_BASE_URL' },
};

export function getProviderEnv(providerName: string): ProviderEnvConfig | null {
  const mapping = PROVIDER_ENV_MAP[providerName];
  if (!mapping) return null;

  const rawKeys = process.env[mapping.keyField];
  if (!rawKeys) return null;

  return {
    keys: rawKeys.split(',').map(k => k.trim()).filter(Boolean),
    baseUrl: getEnv(mapping.baseUrlField),
  };
}

// ── Database Config ──────────────────────────────────────────

export function getDatabaseUrl(): string | undefined {
  return getEnv('DATABASE_URL');
}

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

// ── KV / Redis Config ────────────────────────────────────────

export interface RedisRestConfig {
  url: string;
  token: string;
  source: 'vercel-kv' | 'upstash-redis';
}

/**
 * Resolve Redis REST credentials from either legacy Vercel KV variables
 * (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) or the current Vercel Marketplace
 * Upstash integration defaults (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
 */
export function getRedisRestConfig(): RedisRestConfig | null {
  const kvUrl = process.env.KV_REST_API_URL?.trim();
  const kvToken = process.env.KV_REST_API_TOKEN?.trim();
  if (kvUrl && kvToken) {
    return { url: kvUrl, token: kvToken, source: 'vercel-kv' };
  }

  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && upstashToken) {
    return { url: upstashUrl, token: upstashToken, source: 'upstash-redis' };
  }

  return null;
}

export function hasKv(): boolean {
  return getRedisRestConfig() !== null;
}

/**
 * Whether self-hosted PostgreSQL (`DATABASE_URL`) should be selected.
 *
 * Precedence:
 * 1. Never on Cloudflare/Vercel/Next build phase or when Redis KV is configured.
 * 2. Explicit `RELAY_STORAGE_BACKEND=file` or explicit `RELAY_STORAGE_PATH` file override
 *    forces persistent disk storage (unless `RELAY_STORAGE_BACKEND=postgres`).
 * 3. Otherwise a valid `postgres://` / `postgresql://` `DATABASE_URL` takes precedence
 *    over the container's default `RELAY_DATA_DIR=/app/data`, so Docker Compose
 *    `--profile postgres` and PaaS deployments with `DATABASE_URL` actually use PostgreSQL.
 */
export function shouldUseSelfHostedPostgres(): boolean {
  if (process.env.NEXT_PHASE === 'phase-production-build') return false;
  if (process.env.VERCEL || process.env.CF_PAGES) return false;
  if (hasKv()) return false;
  if (process.env.VITEST && process.env.RELAY_ENABLE_POSTGRES_IN_TEST !== '1') return false;

  const backend = process.env.RELAY_STORAGE_BACKEND?.trim().toLowerCase();
  if (backend === 'file') return false;
  if (process.env.RELAY_STORAGE_PATH?.trim() && backend !== 'postgres') return false;

  const url = process.env.DATABASE_URL?.trim() || '';
  return /^postgres(ql)?:\/\//i.test(url);
}

/**
 * Whether explicit persistent file storage should be used (not overridden by PostgreSQL).
 */
export function hasExplicitFileStorageEnv(): boolean {
  if (shouldUseSelfHostedPostgres()) return false;
  const backend = process.env.RELAY_STORAGE_BACKEND?.trim().toLowerCase();
  if (backend === 'file') return true;
  return Boolean(process.env.RELAY_STORAGE_PATH?.trim() || process.env.RELAY_DATA_DIR?.trim());
}

// ── Admin UI Config ──────────────────────────────────────────

/** Minimum character length for API keys added via the admin UI. Default: 20. */
export function getApiKeyMinLength(): number {
  const cacheEntry = (globalThis as { __aiRelayRuntimeSettingsCache?: { data?: { apiKeyMinLength?: number | null }; expiresAt?: number } | null })
    .__aiRelayRuntimeSettingsCache;
  if (
    cacheEntry &&
    typeof cacheEntry.expiresAt === 'number' &&
    Date.now() < cacheEntry.expiresAt &&
    typeof cacheEntry.data?.apiKeyMinLength === 'number' &&
    Number.isFinite(cacheEntry.data.apiKeyMinLength) &&
    cacheEntry.data.apiKeyMinLength >= 4
  ) {
    return Math.floor(cacheEntry.data.apiKeyMinLength);
  }
  return getEnvInt('RELAY_API_KEY_MIN_LENGTH', 20);
}
