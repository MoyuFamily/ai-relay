// ============================================================
// AI API Relay — Batch Usage Recorder (Ring Buffer + Flush)
// ============================================================
//
// Buffers usage events in memory, then flushes to KV in batches.
// This reduces KV commands per request from ~15 to ~1-2.
//
// Strategy:
// - Each record() adds to an in-memory ring buffer (aggregated by key)
// - Flush triggers: buffer reaches MAX_BATCH_SIZE or FLUSH_INTERVAL_MS
// - Graceful: try to flush remaining on process exit (best-effort)
// - Risk: un-flushed data lost on cold restart (max ~60s of data)

import type { UsageStorage, UsageEvent } from '../sdk';
import { getUsageSamplingInfo, shouldSample } from './kv-storage';

const MAX_BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 60_000;
const SERVERLESS_AFTER_FLUSH_BATCH_SIZE = 10;
const SERVERLESS_AFTER_FLUSH_AGE_MS = 15_000;

interface PendingEntry {
  requests: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
}

export class BatchUsageRecorder {
  private pending = new Map<string, PendingEntry>();
  private errorPending = new Map<string, { count: number; reason: string; keyHash: string; provider: string; statusCode: number }>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private storage: UsageStorage | null = null;
  private shouldRecordDirect = false;
  private totalPending = 0;
  private oldestPendingAt = 0;
  private destroyed = false;
  private flushing = false;

  /**
   * Attach the storage backend. Must be called before record().
   */
  setStorage(storage: UsageStorage): void {
    this.storage = storage;
    this.shouldRecordDirect = (storage as { shouldRecordDirect?: boolean }).shouldRecordDirect === true;
  }

  /**
   * Buffer a usage event. Aggregates by key for efficient batch writes.
   * On Cloudflare Workers, bypasses the buffer and writes directly to
   * D1 storage within the request lifecycle (the timer-based flush
   * strategy is unreliable on Workers because the runtime suspends
   * immediately after the response is sent).
   */
  async record(event: UsageEvent): Promise<void> {
    if (this.destroyed) return;

    // Cloudflare D1 writes must complete within the request lifecycle.
    if (this.shouldRecordDirect) {
      if (this.storage) {
        await this.storage.record(event);
      }
      return;
    }

    // Vercel / Node.js: batch in memory as before
    const usageSampleRate = getUsageSamplingInfo().sampleRate;
    if (!shouldSample(usageSampleRate)) return;
    const usageScale = usageSampleRate > 0 && usageSampleRate < 1
      ? Math.max(1, Math.round(1 / usageSampleRate))
      : 1;
    const scaledEvent: UsageEvent = {
      ...event,
      promptTokens: event.promptTokens * usageScale,
      completionTokens: event.completionTokens * usageScale,
      totalTokens: event.totalTokens * usageScale,
    };

    const keys = this.getKeysForEvent(scaledEvent);
    for (const key of keys) {
      const existing = this.pending.get(key);
      if (existing) {
        existing.requests += usageScale;
        existing.tokens += scaledEvent.totalTokens;
        existing.promptTokens += scaledEvent.promptTokens;
        existing.completionTokens += scaledEvent.completionTokens;
      } else {
        this.pending.set(key, {
          requests: usageScale,
          tokens: scaledEvent.totalTokens,
          promptTokens: scaledEvent.promptTokens,
          completionTokens: scaledEvent.completionTokens,
        });
      }
    }

    if (this.totalPending === 0) {
      this.oldestPendingAt = Date.now();
    }
    this.totalPending++;
    this.ensureTimer();

    if (this.totalPending >= MAX_BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Flush pending usage inside Vercel's `after()` / `waitUntil` lifecycle when
   * either enough events have accumulated (>=10) or the oldest buffered event
   * has aged (>=15s). This prevents low-traffic serverless freezes from dropping
   * buffered usage while preserving Upstash command batching under steady load.
   */
  async flushForServerlessAfter(): Promise<void> {
    if (this.shouldRecordDirect || this.totalPending === 0) return;
    const ageMs = this.oldestPendingAt > 0 ? Date.now() - this.oldestPendingAt : Infinity;
    if (
      this.totalPending >= SERVERLESS_AFTER_FLUSH_BATCH_SIZE ||
      ageMs >= SERVERLESS_AFTER_FLUSH_AGE_MS
    ) {
      await this.flush();
    }
  }

  /**
   * Buffer an error event.
   */
  recordError(event: {
    provider: string;
    keyHash: string;
    statusCode: number;
    reason: string;
  }): void {
    if (this.destroyed) return;

    const key = `error:${event.provider}:${event.statusCode}:${event.keyHash}`;
    const existing = this.errorPending.get(key);
    if (existing) {
      existing.count++;
      existing.reason = event.reason.slice(0, 200);
    } else {
      this.errorPending.set(key, {
        count: 1,
        reason: event.reason.slice(0, 200),
        keyHash: event.keyHash,
        provider: event.provider,
        statusCode: event.statusCode,
      });
    }
  }

  /**
   * Flush all pending data to KV storage.
   * Called on timer, on batch full, or on graceful shutdown.
   */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.pending.size === 0 && this.errorPending.size === 0) return;
    if (!this.storage) return;

    this.flushing = true;
    try {

    // Swap out pending data atomically
    const usageEntries = new Map(this.pending);
    const errorEntries = new Map(this.errorPending);
    this.pending.clear();
    this.errorPending.clear();
    this.totalPending = 0;
    this.oldestPendingAt = 0;

    // Flush usage data via direct KV writes
    const usagePromises: Promise<void>[] = [];
    for (const [key, entry] of usageEntries) {
      const parts = key.split(':');
      if (parts[0] === 'global') {
        usagePromises.push(
          this.storage.recordDirect({
            requestId: `batch_${Date.now()}_${key}`,
            provider: '',
            model: '',
            apiKeyHash: '',
            statusCode: 200,
            promptTokens: entry.promptTokens,
            completionTokens: entry.completionTokens,
            totalTokens: entry.tokens,
            latencyMs: 0,
            isStream: false,
          }, entry.requests)
        );
      } else if (parts[0] === 'provider' && parts[1]) {
        usagePromises.push(
          this.storage.recordDirect({
            requestId: `batch_${Date.now()}_${key}`,
            provider: parts[1],
            model: '',
            apiKeyHash: '',
            statusCode: 200,
            promptTokens: entry.promptTokens,
            completionTokens: entry.completionTokens,
            totalTokens: entry.tokens,
            latencyMs: 0,
            isStream: false,
          }, entry.requests, { includeGlobal: false })
        );
      }
    }

    // Flush error data
    const errorPromises: Promise<void>[] = [];
    for (const [, entry] of errorEntries) {
      errorPromises.push(
        this.storage.recordErrorDirect({
          provider: entry.provider,
          keyHash: entry.keyHash,
          statusCode: entry.statusCode,
          reason: entry.reason,
          count: entry.count,
        })
      );
    }

      await Promise.allSettled([...usagePromises, ...errorPromises]);
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Destroy the recorder and flush remaining data.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /**
   * Number of pending entries (for monitoring).
   */
  get pendingCount(): number {
    return this.totalPending;
  }

  private ensureTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, FLUSH_INTERVAL_MS);
    // Don't hold the process open just for the timer
    if (this.flushTimer && typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  private getKeysForEvent(event: UsageEvent): string[] {
    const keys: string[] = ['global'];
    if (event.provider) {
      keys.push(`provider:${event.provider}`);
    }
    return keys;
  }
}

// Module-level singleton — persists across warm invocations in serverless
let _batchRecorder: BatchUsageRecorder | null = null;

/**
 * Get or create the singleton batch recorder.
 * In serverless, this persists across warm invocations (module scope).
 */
export function getBatchRecorder(): BatchUsageRecorder {
  if (!_batchRecorder) {
    _batchRecorder = new BatchUsageRecorder();

    // Best-effort graceful shutdown — only in Node.js (not Edge/Workers runtimes
    // where process.on exists but is a no-op or throws).
    if (typeof process !== 'undefined' && typeof process.on === 'function') {
      const shutdown = () => {
        _batchRecorder?.flush().catch(() => {});
      };
      try {
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
        process.on('beforeExit', shutdown);
      } catch {
        // Edge/Workers runtimes may throw on unsupported signals — ignore
      }
    }
  }
  return _batchRecorder;
}

/**
 * For testing only.
 */
export function __resetBatchRecorder(): void {
  if (_batchRecorder) {
    _batchRecorder.destroy().catch(() => {});
    _batchRecorder = null;
  }
}
