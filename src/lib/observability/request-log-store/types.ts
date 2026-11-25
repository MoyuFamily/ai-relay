// ============================================================
// AI API Relay — Request Log Store Interface
// ============================================================

export interface RequestLogEntry {
  traceId: string;
  timestamp: string;
  apiKeyHash: string;
  model: string;
  provider: string;
  status: 'success' | 'error';
  httpStatus: number;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  isStream?: boolean;
  errorType?: string;
  errorMessage?: string;
  diagnostic?: string;
}

export interface RequestLogFilters {
  status?: 'success' | 'error' | 'all';
  provider?: string;
  limit?: number;
}

export type RequestLogSource = 'd1' | 'postgres' | 'kv' | 'memory';

export interface RequestLogStore {
  /** Explicit backend tag that survives production minification. */
  readonly source?: RequestLogSource;

  /**
   * Append a request log entry. May no-op if capture is disabled.
   */
  append(log: RequestLogEntry): Promise<void>;

  /**
   * Query logs with optional filters. Returns newest-first, capped at limit.
   */
  list(filters?: RequestLogFilters): Promise<RequestLogEntry[]>;

  /**
   * Clear all logs (user-initiated or automatic pruning).
   */
  clear(): Promise<void>;

  /**
   * Check if capture is currently enabled (for on-demand logging).
   */
  isCaptureEnabled(): Promise<boolean>;

  /**
   * Enable capture for a short TTL window (e.g., when admin opens the logs tab).
   */
  enableCapture(ttlSeconds: number): Promise<void>;
}
