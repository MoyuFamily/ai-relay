// ============================================================
// AI API Relay — Cloudflare KV Adapter
// ============================================================
// Wraps a CF KV namespace binding to expose the same interface
// used by admin-config.ts (which was written for @vercel/kv).
// CF KV only supports simple get/put/delete/list — no hashes,
// no sets, no pipelines. We emulate them with JSON serialization,
// per-key mutation serialization, and bounded subrequest concurrency
// to respect Cloudflare Workers' 6-connection / 50-subrequest limits.

import type { KVNamespace } from '@cloudflare/workers-types';

const DEFAULT_CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runner(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current], current);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runner()));
  return results;
}

function extractLiteralPrefix(pattern?: string): string {
  if (!pattern) return '';
  const wildcardIdx = pattern.search(/[*?]/);
  return wildcardIdx === -1 ? pattern : pattern.slice(0, wildcardIdx);
}

function buildGlobRegex(pattern: string): RegExp {
  const regexStr =
    '^' +
    pattern
      .split('*')
      .map((part) =>
        part
          .split('?')
          .map((sub) => sub.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
          .join('.')
      )
      .join('.*') +
    '$';
  return new RegExp(regexStr);
}

export class CFKVAdapter {
  private keyLocks = new Map<string, Promise<unknown>>();

  constructor(private kv: KVNamespace) {}

  /**
   * Serialize read-modify-write operations on the same key within this adapter
   * instance so concurrent hincrby/hset/sadd/del calls in a pipeline or fallback
   * never overwrite each other's updates.
   */
  private withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.keyLocks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    const tracked = next.finally(() => {
      if (this.keyLocks.get(key) === tracked) {
        this.keyLocks.delete(key);
      }
    });
    this.keyLocks.set(key, tracked);
    return next;
  }

  async get(key: string): Promise<any> {
    const raw = await this.kv.get(key, 'text');
    if (raw === null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  async set(key: string, value: any, options?: { ex?: number }): Promise<string> {
    return this.withKeyLock(key, async () => {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      // Honor Vercel-KV-style `{ ex: seconds }` TTL via CF KV's expirationTtl.
      // CF KV requires expirationTtl >= 60; smaller values round up to 60s so
      // short-lived flags (e.g. capture TTL) still expire rather than living forever.
      if (options?.ex && options.ex > 0) {
        await this.kv.put(key, str, { expirationTtl: Math.max(60, Math.ceil(options.ex)) });
      } else {
        await this.kv.put(key, str);
      }
      return 'OK';
    });
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    await mapWithConcurrency(keys, DEFAULT_CONCURRENCY, (key) =>
      this.withKeyLock(key, () => this.kv.delete(key))
    );
    return keys.length;
  }

  async hgetall(key: string): Promise<Record<string, unknown> | null> {
    const raw = await this.kv.get(key, 'text');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
    return null;
  }

  async hset(key: string, dataOrField: any, value?: any): Promise<number> {
    return this.withKeyLock(key, async () => {
      const current = await this.hgetall(key) || {};
      if (typeof dataOrField === 'object' && dataOrField !== null) {
        Object.assign(current, dataOrField);
      } else if (typeof dataOrField === 'string') {
        current[dataOrField] = value;
      }
      await this.kv.put(key, JSON.stringify(current));
      return 1;
    });
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    return this.withKeyLock(key, async () => {
      const current = await this.hgetall(key) || {};
      const prev = Number(current[field] || 0);
      current[field] = prev + increment;
      await this.kv.put(key, JSON.stringify(current));
      return current[field] as number;
    });
  }

  async incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return this.withKeyLock(key, async () => {
      const raw = await this.kv.get(key, 'text');
      const next = Number(raw || 0) + increment;
      await this.kv.put(key, String(next));
      return next;
    });
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.withKeyLock(key, async () => {
      const raw = await this.kv.get(key, 'text');
      let parsed: unknown = [];
      if (raw) {
        try { parsed = JSON.parse(raw); } catch { parsed = []; }
      }
      const set: string[] = Array.isArray(parsed) ? parsed.map(String) : [];
      let added = 0;
      for (const member of members) {
        if (!set.includes(member)) {
          set.push(member);
          added++;
        }
      }
      if (added > 0) {
        await this.kv.put(key, JSON.stringify(set));
      }
      return added;
    });
  }

  async smembers(key: string): Promise<string[]> {
    const raw = await this.kv.get(key, 'text');
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    return this.withKeyLock(key, async () => {
      const raw = await this.kv.get(key, 'text');
      if (!raw) return 0;
      let parsed: unknown = [];
      try { parsed = JSON.parse(raw); } catch { return 0; }
      if (!Array.isArray(parsed)) return 0;
      const removeSet = new Set(members);
      const filtered = parsed.map(String).filter((m) => !removeSet.has(m));
      const removed = parsed.length - filtered.length;
      if (removed === 0) return 0;
      await this.kv.put(key, JSON.stringify(filtered));
      return removed;
    });
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    // CF KV supports TTL via expirationTtl on put, but we don't re-put here
    // to save subrequests. Config data doesn't need expiry — return 1 for compatibility.
    return 1;
  }

  async mget(...keysOrArray: Array<string | string[]>): Promise<any[]> {
    const keys = Array.isArray(keysOrArray[0]) ? keysOrArray[0] as string[] : keysOrArray as string[];
    return mapWithConcurrency(keys, DEFAULT_CONCURRENCY, (k) => this.get(k));
  }

  async scan(_cursor: number | string, options?: { match?: string; count?: number }): Promise<[number, string[]]> {
    const match = options?.match;
    const prefix = extractLiteralPrefix(match);
    const list = await this.kv.list(prefix ? { prefix } : undefined);
    let names = list.keys.map((k) => k.name);
    if (match && match !== `${prefix}*`) {
      const regex = buildGlobRegex(match);
      names = names.filter((name) => regex.test(name));
    }
    return [0, names];
  }

  pipeline() {
    const commands: Array<{ key: string | null; run: () => Promise<any> }> = [];
    const self = this;
    const proxy: any = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'exec') {
          return async () => {
            if (commands.length === 0) return [];
            const results = new Array<any>(commands.length);
            // Group commands by target key so operations on the SAME key preserve
            // strict FIFO order (e.g. del -> sadd, or multiple hincrby), while
            // independent keys execute with bounded concurrency.
            const keyGroups = new Map<string, Array<{ index: number; run: () => Promise<any> }>>();
            let unkeyedCounter = 0;
            for (let i = 0; i < commands.length; i++) {
              const groupKey = commands[i].key ?? `__unkeyed_${unkeyedCounter++}`;
              let group = keyGroups.get(groupKey);
              if (!group) {
                group = [];
                keyGroups.set(groupKey, group);
              }
              group.push({ index: i, run: commands[i].run });
            }

            await mapWithConcurrency(
              Array.from(keyGroups.values()),
              DEFAULT_CONCURRENCY,
              async (group) => {
                for (const item of group) {
                  results[item.index] = await item.run();
                }
              }
            );
            return results;
          };
        }
        const method = (self as any)[prop];
        if (typeof method === 'function') {
          return (...args: any[]) => {
            const firstKey = typeof args[0] === 'string' ? args[0] : null;
            commands.push({ key: firstKey, run: () => method.apply(self, args) });
            return proxy;
          };
        }
        throw new Error(`CFKVAdapter pipeline: method not implemented: ${String(prop)}`);
      },
    });
    return proxy;
  }
}
