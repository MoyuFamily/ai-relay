// ============================================================
// AI API Relay — Persistent File KV Adapter (Self-Hosted Node)
// ============================================================
// Provides zero-dependency persistent storage for single-node Docker / VPS
// deployments (`NODE_ENV=production` without external Redis or Postgres).
//
// Design:
// - Sub-microsecond O(1) in-memory reads & atomic synchronous mutations
// - Native key-level TTL (`set(..., { ex })` and `expire(key, seconds)`)
// - Coalesced, atomic write-ahead disk persistence (`tmp` + `rename`, 0o600)
// - External file modification detection via `mtimeMs`
// - Graceful shutdown flush on SIGTERM / SIGINT / beforeExit
// - Lazy `node:fs` / `node:path` imports so Edge/CF bundlers stay clean

interface StoredEntry {
  type: 'json' | 'hash' | 'set';
  value: any;
  expiresAt: number | null;
}

interface PersistedPayload {
  version: 1;
  updatedAt: number;
  entries: Record<string, StoredEntry>;
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

export class FileKVAdapter {
  readonly _isFileKV = true;
  private store = new Map<string, StoredEntry>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private lastLoadedMtimeMs = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private dirty = false;
  private readOnlyWarned = false;

  constructor(private readonly filePath: string, private readonly debounceMs = 40) {}

  get storagePath(): string {
    return this.filePath;
  }

  private isExpired(entry: StoredEntry | undefined, now = Date.now()): boolean {
    if (!entry) return true;
    if (entry.expiresAt !== null && now >= entry.expiresAt) {
      return true;
    }
    return false;
  }

  private getValidEntry(key: string, now = Date.now()): StoredEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry, now)) {
      this.store.delete(key);
      this.dirty = true;
      return null;
    }
    return entry;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      // Check if another process updated the file on disk
      try {
        const fs = await import('node:fs/promises');
        const stat = await fs.stat(this.filePath);
        if (stat.mtimeMs > this.lastLoadedMtimeMs && !this.dirty) {
          this.loaded = false;
        } else {
          return;
        }
      } catch {
        return;
      }
    }

    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }

    this.loadPromise = (async () => {
      try {
        const fs = await import('node:fs/promises');
        const raw = await fs.readFile(this.filePath, 'utf8');
        const stat = await fs.stat(this.filePath);
        const parsed = JSON.parse(raw) as Partial<PersistedPayload>;
        this.store.clear();
        const now = Date.now();
        if (parsed && parsed.entries && typeof parsed.entries === 'object') {
          for (const [k, entry] of Object.entries(parsed.entries)) {
            if (entry && typeof entry === 'object' && !this.isExpired(entry as StoredEntry, now)) {
              this.store.set(k, entry as StoredEntry);
            }
          }
        }
        this.lastLoadedMtimeMs = stat.mtimeMs;
      } catch (err: any) {
        if (err?.code !== 'ENOENT') {
          console.warn(`[FileKVAdapter] Failed to read ${this.filePath}, starting fresh:`, err?.message || err);
        }
      } finally {
        this.loaded = true;
        this.loadPromise = null;
      }
    })();

    await this.loadPromise;
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.debounceMs <= 0) {
      void this.flush();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.debounceMs);
    if (typeof (this.flushTimer as any)?.unref === 'function') {
      (this.flushTimer as any).unref();
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty) {
      await this.writeChain;
      return;
    }

    this.dirty = false;
    const now = Date.now();
    const entries: Record<string, StoredEntry> = {};
    for (const [key, entry] of this.store.entries()) {
      if (!this.isExpired(entry, now)) {
        entries[key] = entry;
      } else {
        this.store.delete(key);
      }
    }

    const payload: PersistedPayload = {
      version: 1,
      updatedAt: now,
      entries,
    };
    const serialized = JSON.stringify(payload);

    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      try {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const dir = path.dirname(this.filePath);
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(tmpPath, this.filePath);
        const stat = await fs.stat(this.filePath);
        this.lastLoadedMtimeMs = stat.mtimeMs;
      } catch (err: any) {
        if (!this.readOnlyWarned) {
          this.readOnlyWarned = true;
          console.warn(
            `[FileKVAdapter] Could not persist to ${this.filePath} (${err?.message || err}); continuing in memory.`
          );
        }
      }
    });

    await this.writeChain;
  }

  private deserializeValue(raw: any): any {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  async get(key: string): Promise<any> {
    await this.ensureLoaded();
    const entry = this.getValidEntry(key);
    if (!entry) return null;
    if (entry.type === 'json') {
      return this.deserializeValue(entry.value);
    }
    return entry.value;
  }

  async set(key: string, value: any, options?: { ex?: number }): Promise<string> {
    await this.ensureLoaded();
    const expiresAt =
      options?.ex && options.ex > 0 ? Date.now() + options.ex * 1000 : null;
    this.store.set(key, { type: 'json', value, expiresAt });
    this.scheduleSave();
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    await this.ensureLoaded();
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) {
        deleted++;
      }
    }
    if (deleted > 0) this.scheduleSave();
    return deleted;
  }

  async hgetall(key: string): Promise<Record<string, unknown> | null> {
    await this.ensureLoaded();
    const entry = this.getValidEntry(key);
    if (!entry) return null;
    if (entry.type === 'hash' && entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) {
      return { ...entry.value };
    }
    if (entry.type === 'json') {
      const parsed = this.deserializeValue(entry.value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...parsed };
      }
    }
    return null;
  }

  async hset(key: string, dataOrField: any, value?: any): Promise<number> {
    await this.ensureLoaded();
    const existing = this.getValidEntry(key);
    const current: Record<string, any> =
      existing && existing.value && typeof existing.value === 'object' && !Array.isArray(existing.value)
        ? { ...existing.value }
        : {};
    if (typeof dataOrField === 'object' && dataOrField !== null) {
      Object.assign(current, dataOrField);
    } else if (typeof dataOrField === 'string') {
      current[dataOrField] = value;
    }
    this.store.set(key, {
      type: 'hash',
      value: current,
      expiresAt: existing?.expiresAt ?? null,
    });
    this.scheduleSave();
    return 1;
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    await this.ensureLoaded();
    const existing = this.getValidEntry(key);
    const current: Record<string, any> =
      existing && existing.value && typeof existing.value === 'object' && !Array.isArray(existing.value)
        ? { ...existing.value }
        : {};
    const next = Number(current[field] || 0) + increment;
    current[field] = next;
    this.store.set(key, {
      type: 'hash',
      value: current,
      expiresAt: existing?.expiresAt ?? null,
    });
    this.scheduleSave();
    return next;
  }

  async incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }

  async incrby(key: string, increment: number): Promise<number> {
    await this.ensureLoaded();
    const existing = this.getValidEntry(key);
    const prev = existing ? Number(this.deserializeValue(existing.value) || 0) : 0;
    const next = prev + increment;
    this.store.set(key, {
      type: 'json',
      value: next,
      expiresAt: existing?.expiresAt ?? null,
    });
    this.scheduleSave();
    return next;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    await this.ensureLoaded();
    const existing = this.getValidEntry(key);
    const arr: string[] =
      existing && Array.isArray(existing.value) ? [...existing.value.map(String)] : [];
    let added = 0;
    for (const m of members) {
      const str = String(m);
      if (!arr.includes(str)) {
        arr.push(str);
        added++;
      }
    }
    if (added > 0 || !existing) {
      this.store.set(key, {
        type: 'set',
        value: arr,
        expiresAt: existing?.expiresAt ?? null,
      });
      this.scheduleSave();
    }
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    await this.ensureLoaded();
    const entry = this.getValidEntry(key);
    if (!entry) return [];
    if (Array.isArray(entry.value)) return entry.value.map(String);
    return [];
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    await this.ensureLoaded();
    const existing = this.getValidEntry(key);
    if (!existing || !Array.isArray(existing.value)) return 0;
    const removeSet = new Set(members.map(String));
    const filtered = existing.value.map(String).filter((m: string) => !removeSet.has(m));
    const removed = existing.value.length - filtered.length;
    if (removed > 0) {
      this.store.set(key, {
        type: 'set',
        value: filtered,
        expiresAt: existing.expiresAt,
      });
      this.scheduleSave();
    }
    return removed;
  }

  async expire(key: string, seconds: number): Promise<number> {
    await this.ensureLoaded();
    const existing = this.getValidEntry(key);
    if (!existing) return 0;
    existing.expiresAt = seconds > 0 ? Date.now() + seconds * 1000 : Date.now();
    this.scheduleSave();
    return 1;
  }

  async mget(...keysOrArray: Array<string | string[]>): Promise<any[]> {
    await this.ensureLoaded();
    const keys = Array.isArray(keysOrArray[0])
      ? (keysOrArray[0] as string[])
      : (keysOrArray as string[]);
    return Promise.all(keys.map((k) => this.get(k)));
  }

  async scan(_cursor: number | string, options?: { match?: string; count?: number }): Promise<[number, string[]]> {
    await this.ensureLoaded();
    const now = Date.now();
    const keys: string[] = [];
    for (const [k, entry] of this.store.entries()) {
      if (this.isExpired(entry, now)) {
        this.store.delete(k);
        this.dirty = true;
      } else {
        keys.push(k);
      }
    }
    if (options?.match) {
      const regex = buildGlobRegex(options.match);
      return [0, keys.filter((k) => regex.test(k))];
    }
    return [0, keys];
  }

  pipeline() {
    const commands: Array<() => Promise<any>> = [];
    const self = this;
    const proxy: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'exec') {
            return async () => {
              const out: any[] = [];
              for (const cmd of commands) {
                out.push(await cmd());
              }
              return out;
            };
          }
          const method = (self as any)[prop];
          if (typeof method === 'function') {
            return (...args: any[]) => {
              commands.push(() => method.apply(self, args));
              return proxy;
            };
          }
          throw new Error(`FileKVAdapter pipeline: method not implemented: ${String(prop)}`);
        },
      }
    );
    return proxy;
  }
}

const instances = new Map<string, FileKVAdapter>();
let shutdownHookInstalled = false;

export function resolveSelfHostedKvFilePath(): string {
  const explicitPath = process.env.RELAY_STORAGE_PATH?.trim();
  if (explicitPath) return explicitPath;
  const dataDir = process.env.RELAY_DATA_DIR?.trim() || './data';
  return `${dataDir.replace(/\/+$/, '')}/kv-store.json`;
}

export function getFileKVAdapter(customPath?: string): FileKVAdapter {
  const targetPath = customPath || resolveSelfHostedKvFilePath();
  let instance = instances.get(targetPath);
  if (!instance) {
    instance = new FileKVAdapter(targetPath);
    instances.set(targetPath, instance);
  }

  if (!shutdownHookInstalled && typeof process !== 'undefined' && typeof process.on === 'function') {
    shutdownHookInstalled = true;
    const flushAll = () => {
      for (const adapter of instances.values()) {
        void adapter.flush();
      }
    };
    try {
      process.on('SIGTERM', flushAll);
      process.on('SIGINT', flushAll);
      process.on('beforeExit', flushAll);
    } catch {
      // Ignore in restricted runtimes
    }
  }

  return instance;
}

export async function __resetFileKVAdaptersForTests(): Promise<void> {
  for (const adapter of instances.values()) {
    await adapter.flush();
  }
  instances.clear();
}
