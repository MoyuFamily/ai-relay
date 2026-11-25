// ============================================================
// AI API Relay — Provider Types (Unified)
// ============================================================

/**
 * Unified provider configuration.
 * All providers follow this shape — no special cases.
 */
export interface ProviderConfig {
  name: string;                    // 'openai' | 'anthropic' | 'deepseek' | 'xiaomi'
  displayName: string;             // Human-readable name
  baseUrl: string;                 // Default upstream base URL
  modelPrefixes: string[];         // e.g. ['gpt-', 'chatgpt-']
  headerFormat: 'openai' | 'anthropic' | 'azure';  // Auth header format
  envKeyField: string;             // Env var name for API keys
  envBaseUrlField?: string;        // Env var name for custom base URL
  userAgent?: string;              // Optional custom User-Agent (overrides default)
  models?: ModelInfo[];            // Supported models list
  modelMapping?: Record<string, string>; // User-facing model ID → upstream model ID (for virtual model names)
  fallbackProvider?: string;       // Fallback provider name when this one fails (single, legacy)
  fallbackProviders?: string[];    // Chain of fallback providers (tried in order, supersede fallbackProvider)
  isCustom?: boolean;              // Distinguish custom KV providers from static ones
}

/**
 * Model metadata for /v1/models endpoint.
 */
export interface ModelInfo {
  id: string;                      // e.g. 'gpt-6-luna', 'claude-sonnet-5-5'
  displayName: string;             // e.g. 'GPT-5.4', 'Claude Sonnet 4.6'
  contextWindow: number;           // Max context tokens
  maxOutput?: number;              // Max output tokens
  supportsStream?: boolean;        // Supports streaming
  supportsVision?: boolean;        // Supports image input
  supportsTools?: boolean;         // Supports function/tool calling
  pricing?: {                      // Per-token pricing (USD)
    input: number;                 // Per 1M input tokens
    output: number;                // Per 1M output tokens
  };
}

/**
 * A single API key with metadata.
 */
export interface ApiKey {
  key: string;                     // The raw key
  hash: string;                    // Short hash for KV/logging
  provider: string;                // Provider name
}

/**
 * Key pool for a provider.
 */
export interface KeyPool {
  provider: string;
  keys: ApiKey[];
  counter: number;                 // Round-robin counter
}

/**
 * Relay result — returned from relayRequest().
 */
export interface RelayResult {
  response: Response;
  provider: ProviderConfig;
  apiKey: ApiKey;
  /** Abort the active upstream fetch (e.g. when client disconnects mid-stream). */
  abortUpstream?: () => void;
}
