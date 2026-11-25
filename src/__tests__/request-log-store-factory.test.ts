import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable CF signal — the factory must re-read this on every call, not
// cache the first answer. This is the regression guard for the bug where the
// first caller in an isolate permanently pinned the backend (P2).
const cfState = { value: false, hasDb: false };
vi.mock('@/lib/cf-env', () => ({
  isCloudflareSync: () => cfState.value,
  getCFEnvSync: () => (cfState.value && cfState.hasDb ? { DB: {} } : null),
}));

import {
  getDefaultRequestLogStore,
  setDefaultRequestLogStore,
  __resetDefaultRequestLogStore,
  D1RequestLogStore,
  KVRequestLogStore,
  MemoryRequestLogStore,
} from '../lib/observability/request-log-store';

describe('request log store factory', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    cfState.value = false;
    cfState.hasDb = false;
    __resetDefaultRequestLogStore();
  });

  afterEach(() => {
    __resetDefaultRequestLogStore();
  });

  it('re-selects the backend per call when the CF signal flips (D1 when bound, KV fallback)', () => {
    // First access is OUTSIDE a CF context (e.g. a build-time/module-init
    // caller, or a non-CF isolate). Pre-fix this would lock in MemoryStore.
    cfState.value = false;
    expect(getDefaultRequestLogStore()).toBeInstanceOf(MemoryRequestLogStore);

    // CF context without D1 falls back to KVRequestLogStore.
    cfState.value = true;
    cfState.hasDb = false;
    expect(getDefaultRequestLogStore()).toBeInstanceOf(KVRequestLogStore);

    // CF context with D1 prefers D1RequestLogStore (100k rows written/day vs 1k CF KV writes/day).
    cfState.hasDb = true;
    expect(getDefaultRequestLogStore()).toBeInstanceOf(D1RequestLogStore);

    // And back again — selection always follows the current signal.
    cfState.value = false;
    cfState.hasDb = false;
    expect(getDefaultRequestLogStore()).toBeInstanceOf(MemoryRequestLogStore);
  });

  it('returns a stable instance for a given backend across calls', () => {
    cfState.value = true;
    const a = getDefaultRequestLogStore();
    const b = getDefaultRequestLogStore();
    // Same instance so KV/memory state (in-memory logs, append counter) persists.
    expect(a).toBe(b);
  });

  it('honors a test override above environment detection', () => {
    const fake = new MemoryRequestLogStore();
    setDefaultRequestLogStore(fake);
    cfState.value = true; // would otherwise select KV
    expect(getDefaultRequestLogStore()).toBe(fake);
  });
});
