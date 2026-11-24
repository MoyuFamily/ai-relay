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
 * On Cloudflare, the runtime suspends as soon as the response stream closes,
 * so awaiting slow usage/log writes before `controller.close()` delays the
 * client's stream completion. Handing the promise to `ctx.waitUntil` lets the
 * worker stay alive for the write while the client sees the stream finish
 * immediately. Off CF (or when no context is available) it degrades to plain
 * fire-and-forget. Errors are always swallowed — this is never load-bearing.
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

  if (shouldSkipCloudflareContext()) {
    return; // Vercel / Node.js: fire-and-forget.
  }

  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare');
    const context = getCloudflareContext();
    if (context && typeof context.ctx?.waitUntil === 'function') {
      context.ctx.waitUntil(settled);
    }
  } catch {
    // No CF context — the fire-and-forget promise above still runs.
  }
}
