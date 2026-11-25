// ============================================================
// AI API Relay — Streaming Usage Parsing Helpers
// ============================================================
//
// Streaming responses for large (e.g. code) generations emit thousands
// of SSE delta chunks. Running JSON.parse on every chunk just to look
// for token usage is what pushes the worker past Cloudflare's CPU-time
// budget. Usage data lives in only a couple of chunks per stream, and
// every one of those carries a *_tokens field (prompt_tokens /
// completion_tokens / input_tokens / output_tokens). A cheap substring
// check lets us skip JSON.parse for the content deltas entirely.

import { getCachedRuntimeSettingsSync } from '@/lib/admin/runtime-settings';

/** True only for chunks that could carry token-usage data. */
export function chunkHasUsage(data: string): boolean {
  return data.indexOf('_tokens') !== -1;
}

// ── Cloudflare Free byte-counting passthrough ───────────────────
//
// On Cloudflare's Free plan the per-request CPU budget is ~10ms, and it
// counts only active JS execution (network/I/O waits are free). The
// precise usage wrappers (decode + split + parse every SSE chunk) are
// O(response bytes), so a large code generation blows the budget purely
// on string work. Here we trade usage *precision* for a near-constant
// per-byte cost: pass every chunk straight through and only tally
// byte length, then estimate completion tokens once the stream ends.
//
// This mirrors the precision/cost trade already made on Vercel (usage
// sampling) — exact token counts are not load-bearing for quota or
// billing here, only for rough dashboards.

/**
 * Coarse bytes-per-completion-token divisor for streamed SSE responses.
 *
 * Raw SSE bytes are NOT the same as content characters: every token's
 * delta is wrapped in `data: {...}\n\n` JSON framing that repeats each
 * chunk, so the byte count runs well above the ~4 chars/token heuristic
 * used for plain text. This divisor folds that framing overhead into a
 * single rough constant. It is intentionally approximate — override with
 * RELAY_STREAM_BYTES_PER_TOKEN if a given upstream's framing skews it.
 */
const DEFAULT_STREAM_BYTES_PER_TOKEN = 20;

function streamBytesPerToken(): number {
  const configured = getCachedRuntimeSettingsSync().streamBytesPerToken;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  const raw = process.env.RELAY_STREAM_BYTES_PER_TOKEN;
  if (raw === undefined || raw.trim() === '') return DEFAULT_STREAM_BYTES_PER_TOKEN;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_STREAM_BYTES_PER_TOKEN;
  return parsed;
}

/**
 * Estimate completion tokens from the total raw byte length of a streamed
 * SSE response body. Coarse by design — see DEFAULT_STREAM_BYTES_PER_TOKEN.
 */
export function estimateCompletionTokensFromStreamBytes(totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.max(1, Math.round(totalBytes / streamBytesPerToken()));
}

/**
 * Wrap an upstream stream as a pure byte-counting passthrough.
 *
 * Every chunk is enqueued unchanged (so the client still sees token-by-token
 * streaming) and only its byte length is summed. When the stream ends, the
 * total byte count is handed to `onDone` for coarse usage recording. No
 * decode / split / JSON.parse happens per chunk, keeping per-byte CPU
 * effectively constant — the key to staying under Cloudflare Free's ~10ms.
 *
 * `onDone` is best-effort: any error it throws is swallowed so it can never
 * stall the stream's close.
 */
export function createByteCountingStream(
  upstreamBody: ReadableStream<Uint8Array>,
  onDone: (totalBytes: number) => void | Promise<void>,
  onCancel?: () => void
): ReadableStream<Uint8Array> {
  const reader = upstreamBody.getReader();
  let totalBytes = 0;

  return new ReadableStream({
    async pull(controller) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (error) {
        controller.error(error);
        return;
      }

      if (done) {
        try {
          await onDone(totalBytes);
        } catch {
          // best-effort usage recording — never stall the stream close
        }
        controller.close();
        return;
      }

      controller.enqueue(value);
      if (value) totalBytes += value.byteLength;
    },
    cancel() {
      reader.cancel().catch(() => {});
      try {
        onCancel?.();
      } catch {
        // Ignore abort cleanup failures
      }
    },
  });
}

/**
 * Measure the character length of a JSON string field value without running
 * JSON.parse. Used only for fallback token estimation when an upstream omits
 * usage data from its stream. Approximate by design — escape sequences are
 * counted as written rather than decoded, which is well within the tolerance
 * of the chars-per-token heuristic.
 *
 * Returns 0 when the field is absent or not a string (e.g. "content":null).
 */
export function jsonStringFieldLength(data: string, key: string): number {
  const marker = `"${key}":"`;
  const start = data.indexOf(marker);
  if (start === -1) return 0;
  let len = 0;
  for (let i = start + marker.length; i < data.length; i++) {
    const c = data.charCodeAt(i);
    if (c === 92) {
      // Backslash escape — skip the next char, count the pair as one.
      i++;
      len++;
      continue;
    }
    if (c === 34) break; // unescaped closing quote
    len++;
  }
  return len;
}
