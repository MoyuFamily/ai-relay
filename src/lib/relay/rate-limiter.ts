// ============================================================
// AI API Relay — Rate Limiting & 429 Protection
// ============================================================
//
// Three-layer defense against upstream rate limits:
//
// 1. Token Bucket — proactive rate limiting per provider
//    Prevents triggering 429s in the first place.
//
// 2. Circuit Breaker — stops requests after consecutive failures
//    Avoids hammering a rate-limited provider.
//
// 3. Exponential Backoff — reactive delay after 429 responses
//    With jitter to avoid thundering herd.
//
// All three are keyed by provider name. State is in-memory
// (resets on cold start), which is fine for a single-process relay.

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Exponential backoff parameters */
const BACKOFF_BASE_MS = 1_000;        // 1s initial delay
const BACKOFF_MAX_MS = 60_000;        // 60s max delay
const BACKOFF_MULTIPLIER = 2;         // double each retry
const JITTER_FACTOR = 0.3;            // ±30% random jitter

/** Circuit breaker parameters */
const CIRCUIT_BREAKER_THRESHOLD = 5;  // consecutive 429s to trip
const CIRCUIT_BREAKER_RESET_MS = 120_000;  // 2min cooldown before half-open

/** Token bucket parameters */
const TOKEN_BUCKET_CAPACITY = 60;     // max burst size
const TOKEN_BUCKET_REFILL_RATE = 1;   // tokens per second (= 60/min)

// ---------------------------------------------------------------------------
// Exponential Backoff
// ---------------------------------------------------------------------------

/**
 * Calculate backoff delay with jitter.
 * Returns milliseconds to wait before next retry.
 */
export function getBackoffDelay(attempt: number): number {
  const exponential = Math.min(
    BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
    BACKOFF_MAX_MS
  );
  // Add jitter: ±JITTER_FACTOR of the exponential delay
  const jitter = exponential * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(exponential + jitter));
}

/**
 * Sleep for the backoff delay. Returns actual delay in ms.
 */
export async function backoffSleep(attempt: number): Promise<number> {
  const delay = getBackoffDelay(attempt);
  await new Promise(resolve => setTimeout(resolve, delay));
  return delay;
}

// ---------------------------------------------------------------------------
// Circuit Breaker (per-provider)
// ---------------------------------------------------------------------------

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureAt: number;
  openedAt: number;
}

interface SharedRateLimiterState {
  circuits: Map<string, CircuitBreakerState>;
  buckets: Map<string, TokenBucket>;
}

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
}

const sharedRateLimiterState: SharedRateLimiterState = ((globalThis as any).__aiRelayRateLimiterState ??= {
  circuits: new Map<string, CircuitBreakerState>(),
  buckets: new Map<string, TokenBucket>(),
});

const circuits = sharedRateLimiterState.circuits;

function getCircuit(provider: string): CircuitBreakerState {
  let circuit = circuits.get(provider);
  if (!circuit) {
    circuit = {
      state: 'closed',
      consecutiveFailures: 0,
      lastFailureAt: 0,
      openedAt: 0,
    };
    circuits.set(provider, circuit);
  }
  return circuit;
}

/**
 * Check if the circuit allows a request through.
 * Returns true if the request should proceed, false if circuit is open.
 */
export function circuitAllows(provider: string): boolean {
  const circuit = getCircuit(provider);

  if (circuit.state === 'closed') return true;

  if (circuit.state === 'open') {
    // Check if cooldown period has elapsed → transition to half-open
    if (Date.now() - circuit.openedAt >= CIRCUIT_BREAKER_RESET_MS) {
      circuit.state = 'half-open';
      return true; // Allow one probe request
    }
    return false;
  }

  // half-open: allow the probe
  return true;
}

/**
 * Record a successful response. Resets the circuit to closed.
 */
export function circuitRecordSuccess(provider: string): void {
  const circuit = getCircuit(provider);
  circuit.state = 'closed';
  circuit.consecutiveFailures = 0;
}

/**
 * Record a 429 failure. May trip the circuit to open.
 */
export function circuitRecord429(provider: string): void {
  const circuit = getCircuit(provider);
  circuit.consecutiveFailures += 1;
  circuit.lastFailureAt = Date.now();

  if (circuit.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuit.state = 'open';
    circuit.openedAt = Date.now();
  }
}

/**
 * Get circuit breaker status for diagnostics.
 */
export function getCircuitStatus(provider: string): {
  state: CircuitState;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
} {
  const circuit = getCircuit(provider);
  const cooldownRemainingMs =
    circuit.state === 'open'
      ? Math.max(0, CIRCUIT_BREAKER_RESET_MS - (Date.now() - circuit.openedAt))
      : 0;
  return {
    state: circuit.state,
    consecutiveFailures: circuit.consecutiveFailures,
    cooldownRemainingMs,
  };
}

// ---------------------------------------------------------------------------
// Token Bucket (per-provider)
// ---------------------------------------------------------------------------

const buckets = sharedRateLimiterState.buckets;

function getBucket(provider: string): TokenBucket {
  let bucket = buckets.get(provider);
  if (!bucket) {
    bucket = {
      tokens: TOKEN_BUCKET_CAPACITY,
      lastRefillAt: Date.now(),
    };
    buckets.set(provider, bucket);
  }
  return bucket;
}

/**
 * Try to consume a token. Returns true if allowed, false if rate limited.
 */
export function tokenBucketConsume(provider: string): boolean {
  const bucket = getBucket(provider);
  const now = Date.now();

  // Refill tokens based on elapsed time
  const elapsed = (now - bucket.lastRefillAt) / 1000;
  bucket.tokens = Math.min(
    TOKEN_BUCKET_CAPACITY,
    bucket.tokens + elapsed * TOKEN_BUCKET_REFILL_RATE
  );
  bucket.lastRefillAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
}

/**
 * Get token bucket status for diagnostics.
 */
export function getTokenBucketStatus(provider: string): {
  tokens: number;
  capacity: number;
} {
  const bucket = getBucket(provider);
  // Refill before reporting
  const now = Date.now();
  const elapsed = (now - bucket.lastRefillAt) / 1000;
  const currentTokens = Math.min(
    TOKEN_BUCKET_CAPACITY,
    bucket.tokens + elapsed * TOKEN_BUCKET_REFILL_RATE
  );
  return {
    tokens: Math.floor(currentTokens),
    capacity: TOKEN_BUCKET_CAPACITY,
  };
}

// ---------------------------------------------------------------------------
// Unified Rate Limiter — combines all three layers
// ---------------------------------------------------------------------------

export interface RateLimitDecision {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

/**
 * Check if a request to the given provider should proceed.
 * Combines token bucket + circuit breaker checks.
 *
 * Call this BEFORE making the upstream request.
 */
export function checkRateLimit(provider: string): RateLimitDecision {
  // Layer 1: Circuit breaker
  if (!circuitAllows(provider)) {
    const status = getCircuitStatus(provider);
    return {
      allowed: false,
      reason: `circuit breaker open for ${provider} (${status.consecutiveFailures} consecutive 429s, cooldown ${Math.ceil(status.cooldownRemainingMs / 1000)}s remaining)`,
      retryAfterMs: status.cooldownRemainingMs,
    };
  }

  // Layer 2: Token bucket
  if (!tokenBucketConsume(provider)) {
    return {
      allowed: false,
      reason: `rate limit exceeded for ${provider} (token bucket empty)`,
      retryAfterMs: 1000, // Retry in 1s when a token refills
    };
  }

  return { allowed: true };
}

/**
 * Record a 429 response from the upstream provider.
 * Updates circuit breaker state.
 */
export function record429(provider: string): void {
  circuitRecord429(provider);
}

/**
 * Record a successful response from the upstream provider.
 * Resets circuit breaker.
 */
export function recordSuccess(provider: string): void {
  circuitRecordSuccess(provider);
}

/**
 * Get full rate limiter diagnostics for all providers.
 */
export function getRateLimiterStats(): Record<string, {
  circuit: ReturnType<typeof getCircuitStatus>;
  tokenBucket: ReturnType<typeof getTokenBucketStatus>;
}> {
  const providers = new Set([
    ...circuits.keys(),
    ...buckets.keys(),
  ]);
  const stats: Record<string, any> = {};
  for (const p of providers) {
    stats[p] = {
      circuit: getCircuitStatus(p),
      tokenBucket: getTokenBucketStatus(p),
    };
  }
  return stats;
}
