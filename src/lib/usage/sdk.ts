// ============================================================
// AI API Relay — Usage SDK (10-Field Standard)
// ============================================================
//
// Every usage event follows this 10-field schema.
// The SDK abstracts the storage backend (KV today, Postgres in S2+).
//
// ┌────────────────────┬──────────┬─────────────────────────────┐
// │ Field              │ Type     │ Description                 │
// ├────────────────────┼──────────┼─────────────────────────────┤
// │ 1. request_id      │ string   │ Unique request identifier   │
// │ 2. provider        │ string   │ Provider name               │
// │ 3. model           │ string   │ Model name (as requested)   │
// │ 4. api_key_hash    │ string   │ Hash of the API key used    │
// │ 5. status_code     │ number   │ Upstream HTTP status        │
// │ 6. prompt_tokens   │ number   │ Prompt token count          │
// │ 7. completion_tokens│ number  │ Completion token count      │
// │ 8. total_tokens    │ number   │ prompt + completion         │
// │ 9. latency_ms      │ number   │ Upstream response time      │
// │ 10. is_stream      │ boolean  │ Whether it was streaming    │
// └────────────────────┴──────────┴─────────────────────────────┘

export interface UsageEvent {
  requestId: string;          // 1. UUID or nanoid
  provider: string;           // 2. 'openai' | 'anthropic' | ...
  model: string;              // 3. 'gpt-6-luna' | 'claude-sonnet-5-5' | ...
  apiKeyHash: string;         // 4. Short hash of the relay key
  statusCode: number;         // 5. HTTP status from upstream
  promptTokens: number;       // 6. Input tokens
  completionTokens: number;   // 7. Output tokens
  totalTokens: number;        // 8. Sum of prompt + completion
  latencyMs: number;          // 9. Round-trip to upstream
  isStream: boolean;          // 10. Streaming mode
}

/**
 * Generate a short unique request ID.
 * crypto.randomUUID() available in Edge/Node 19+.
 */
export function generateRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Build a UsageEvent from request context.
 */
export function createUsageEvent(params: {
  requestId?: string;
  provider: string;
  model: string;
  apiKeyHash: string;
  statusCode: number;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  isStream?: boolean;
}): UsageEvent {
  const prompt = params.promptTokens ?? 0;
  const completion = params.completionTokens ?? 0;
  return {
    requestId: params.requestId ?? generateRequestId(),
    provider: params.provider,
    model: params.model,
    apiKeyHash: params.apiKeyHash,
    statusCode: params.statusCode,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    latencyMs: params.latencyMs ?? 0,
    isStream: params.isStream ?? false,
  };
}

// ── Storage Backend Interface ────────────────────────────────

/**
 * Abstract storage backend for usage events.
 * Current impl: KVStorage (Vercel KV).
 * Future: PostgresStorage (Drizzle, S2+).
 */
export interface UsageStorage {
  record(event: UsageEvent): Promise<void>;
  getKeyUsage(keyHash: string): Promise<{
    daily: { requests: number; tokens: number };
    total: { requests: number; tokens: number };
  } | null>;
  getGlobalUsage(): Promise<{
    requests: number; tokens: number; promptTokens: number; completionTokens: number;
    providers: Record<string, { requests: number; tokens: number; promptTokens: number; completionTokens: number }>;
  } | null>;
  getMonthlyUsage(): Promise<{ requests: number; tokens: number; promptTokens: number; completionTokens: number } | null>;
  getUsageTrend(
    range: string,
    granularity: 'day' | 'week' | 'month'
  ): Promise<{
    global: TrendPoint[];
    providers: ProviderTrendPoint[];
  }>;
  checkQuota(reserve?: boolean): Promise<QuotaStatus>;
  getErrorStats(): Promise<Record<string, Record<string, number>>>;
  getKeyErrors(): Promise<Array<{ keyHash: string; errors: Record<string, { count: number; reason: string }> }>>;
  getDailyReport(date: string): Promise<import('@/lib/webhooks/types').DailyReportData | null>;
  clearKeyErrors(keyHash: string): Promise<void>;
  recordDirect(event: UsageEvent, requestCount?: number, options?: { includeGlobal?: boolean }): Promise<void>;
  recordError(event: { provider: string; keyHash: string; statusCode: number; reason: string }): Promise<void>;
  recordErrorDirect(event: { provider: string; keyHash: string; statusCode: number; reason: string; count?: number }): Promise<void>;
  flush(): Promise<void>;
}

export interface TrendPoint {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderTrendPoint {
  provider: string;
  data: TrendPoint[];
}

export interface QuotaStatus {
  allowed: boolean;
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number;
  monthlyLimit: number;
  retryAfter?: number;
  isOverride?: boolean;
}
