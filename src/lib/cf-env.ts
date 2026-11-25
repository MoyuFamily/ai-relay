// ============================================================
// AI API Relay — CF Bindings Helper
// ============================================================
// Provides access to Cloudflare KV and D1 bindings when running
// on Cloudflare Pages. Returns null outside CF environment.
//
// Uses getCloudflareContext() from @opennextjs/cloudflare so that
// bindings are always request-scoped — no module-level state, no
// race conditions between concurrent requests.
//
// require() is used intentionally (not import) to keep this module
// invisible to TypeScript's global type resolution — a static import
// of @opennextjs/cloudflare would pull in @cloudflare/workers-types
// globally and override DOM types like Response.json() → unknown.

export interface CFEnv {
  KV: import('@cloudflare/workers-types').KVNamespace;
  DB: import('@cloudflare/workers-types').D1Database;
}

function isCloudflareWorkersRuntime(): boolean {
  if (process.env.CF_PAGES === '1') return true;
  if (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') {
    return true;
  }
  return false;
}

function shouldSkipCloudflareContext(): boolean {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.VERCEL === '1' ||
    !!process.env.VERCEL_ENV ||
    !!process.env.VERCEL_URL
  );
}

export function getCFEnvSync(): CFEnv | null {
  if (shouldSkipCloudflareContext()) {
    return null;
  }

  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare');
    const context = getCloudflareContext();
    if (context && context.env) {
      const env = context.env as Partial<CFEnv>;
      // Only treat context as Cloudflare if real CF bindings exist or we are in workerd/CF_PAGES.
      if (env.KV || env.DB || isCloudflareWorkersRuntime()) {
        return context.env as unknown as CFEnv;
      }
    }
  } catch {}
  return null;
}

export async function getCFEnv(): Promise<CFEnv | null> {
  const syncEnv = getCFEnvSync();
  if (syncEnv) return syncEnv;

  if (shouldSkipCloudflareContext()) {
    return null;
  }

  // Avoid invoking @opennextjs/cloudflare's Wrangler dev fallback in standard Node.js
  // servers (Docker / VPS `next start`), which writes an empty `{ env: {} }` onto
  // globalThis.__cloudflare-context__ and breaks File/Postgres storage detection.
  if (process.env.NEXT_RUNTIME === 'nodejs' && !isCloudflareWorkersRuntime()) {
    return null;
  }

  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    if (context && context.env) {
      const env = context.env as Partial<CFEnv>;
      if (env.KV || env.DB || isCloudflareWorkersRuntime()) {
        return context.env as unknown as CFEnv;
      }
    }
  } catch {}
  return null;
}

export function isCloudflareSync(): boolean {
  return getCFEnvSync() !== null;
}

export async function isCloudflare(): Promise<boolean> {
  return (await getCFEnv()) !== null;
}

/**
 * Run best-effort background work without blocking the response.
 *
 * - On Cloudflare Workers/Pages: hands the promise to `ctx.waitUntil()` so the
 *   worker stays alive for D1/KV writes after the response stream closes.
 * - On Vercel (Fluid Compute) / Next.js 15: registers the promise with
 *   `after()` from `next/server` (which maps to Vercel `waitUntil`) when inside
 *   a Next.js request scope, preventing serverless freeze from dropping writes.
 * - Outside a request scope (e.g. unit tests, CLI server, or post-return stream
 *   callbacks): degrades gracefully to plain fire-and-forget.
 * Errors are always swallowed — this is never load-bearing.
 */
export function runAfterResponse(work: () => Promise<void>): void {
  let promise: Promise<void>;
  try {
    promise = work();
  } catch {
    // Synchronous throw in the work factory — nothing to wait on.
    return;
  }
  const settled = promise.catch(() => {});

  if (!shouldSkipCloudflareContext()) {
    try {
      const { getCloudflareContext } = require('@opennextjs/cloudflare');
      const context = getCloudflareContext();
      if (context && typeof context.ctx?.waitUntil === 'function') {
        context.ctx.waitUntil(settled);
        return;
      }
    } catch {
      // Fall through to Next.js after() / fire-and-forget.
    }
  }

  // Next.js 15 `after()` — hooks Vercel `waitUntil` automatically when called
  // synchronously inside a route handler request scope.
  try {
    const nextServer = require('next/server') as { after?: (fn: () => void | Promise<void>) => void };
    if (typeof nextServer?.after === 'function') {
      nextServer.after(() => settled);
    }
  } catch {
    // Outside a Next.js request scope (tests, CLI, post-return stream) — the
    // fire-and-forget `settled` promise above still runs.
  }
}

export interface AfterStreamHook {
  /** Schedule post-stream work and release the deferred waitUntil promise when done. */
  schedule(work: () => Promise<void>): void;
  /** Release the deferred waitUntil promise without extra work (e.g. on cancel/error). */
  complete(): void;
}

/**
 * Create a deferred post-stream hook synchronously inside a Next.js route handler
 * BEFORE returning a streaming `Response`.
 *
 * Next.js 15 `after()` must be called synchronously during the request lifecycle
 * (not later inside `ReadableStream.pull()`). Calling this helper inside `POST()`
 * registers a deferred promise with `after()` upfront, so Vercel `waitUntil` keeps
 * the Fluid Compute instance alive until post-stream usage/log writes settle —
 * allowing `controller.close()` to flush to the client immediately.
 */
export function createAfterStreamHook(): AfterStreamHook {
  let resolveDeferred: (() => void) | null = null;
  let settled = false;

  const finish = () => {
    if (settled) return;
    settled = true;
    resolveDeferred?.();
    resolveDeferred = null;
  };

  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    const deferred = new Promise<void>((resolve) => {
      resolveDeferred = resolve;
    });
    runAfterResponse(() => deferred);
  }

  return {
    schedule(work: () => Promise<void>): void {
      Promise.resolve()
        .then(work)
        .catch(() => {})
        .finally(finish);
    },
    complete(): void {
      finish();
    },
  };
}
