// ============================================================
// AI API Relay — Concurrency Limiter
//
// Limits the number of concurrent in-flight requests to upstream
// providers. Excess requests are queued; if the queue is full,
// a 429/502 is returned immediately.
// Reads env limits dynamically so Cloudflare Workers / OpenNext
// request-scoped env vars and runtime overrides take effect.
// ============================================================

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_QUEUE = 10;

function getMaxConcurrent(): number {
  const parsed = parseInt(process.env.RELAY_MAX_CONCURRENT || '', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_CONCURRENT;
}

function getMaxQueue(): number {
  const parsed = parseInt(process.env.RELAY_MAX_QUEUE || '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_QUEUE;
}

let inFlight = 0;
const queue: Array<{
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}> = [];

/**
 * Acquire a concurrency slot. Resolves when a slot is available.
 * Rejects if the queue is full or the wait times out.
 */
export function acquireSlot(timeoutMs = 30_000): Promise<void> {
  const maxConcurrent = getMaxConcurrent();
  const maxQueue = getMaxQueue();

  return new Promise((resolve, reject) => {
    if (inFlight < maxConcurrent) {
      inFlight++;
      resolve();
      return;
    }

    if (queue.length >= maxQueue) {
      reject(new Error('Concurrency queue full'));
      return;
    }

    const timer = setTimeout(() => {
      const idx = queue.findIndex((e) => e.resolve === wrappedResolve);
      if (idx !== -1) queue.splice(idx, 1);
      reject(new Error('Concurrency slot timeout'));
    }, timeoutMs);

    // Wrap resolve to also clear the timer and increment inFlight
    const wrappedResolve = () => {
      clearTimeout(timer);
      inFlight++;
      resolve();
    };

    queue.push({ resolve: wrappedResolve, reject, timer });
  });
}

/**
 * Release a concurrency slot. Resumes the next queued request.
 */
export function releaseSlot(): void {
  inFlight = Math.max(0, inFlight - 1);
  if (queue.length > 0 && inFlight < getMaxConcurrent()) {
    const next = queue.shift()!;
    next.resolve();
  }
}

/**
 * Execute a function with concurrency control.
 */
export async function withConcurrency<T>(
  fn: () => Promise<T>,
  timeoutMs = 30_000
): Promise<T> {
  await acquireSlot(timeoutMs);
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

/**
 * Get current concurrency stats (for status/health endpoints).
 */
export function getConcurrencyStats(): {
  inFlight: number;
  queued: number;
  maxConcurrent: number;
  maxQueue: number;
} {
  return {
    inFlight,
    queued: queue.length,
    maxConcurrent: getMaxConcurrent(),
    maxQueue: getMaxQueue(),
  };
}
