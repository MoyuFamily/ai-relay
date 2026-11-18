// ============================================================
// AI API Relay — PostgreSQL KV Adapter (Self-Hosted Multi-Node)
// ============================================================
// Implements the unified KV interface over PostgreSQL `kv_store` JSONB
// with single-statement atomic upserts (`ON CONFLICT DO UPDATE`),
// making admin config, key pools, smart routing, health probes, and
// device auth multi-replica safe without requiring Redis.

import type postgres from 'postgres';
import { ensureSelfHostedPostgresSchema } from '@/lib/db/self-hosted-schema';

function globToSqlLike(pattern?: string): { like: string; regex: RegExp | null } {
  if (!pattern || pattern === '*') {
    return { like: '%', regex: null };
  }
  const hasQuestion = pattern.includes('?');
  const escapedForLike = pattern
    .replace(/[\\%_]/g, (m) => `\\${m}`)
    .replace(/\*/g, '%')
    .replace(/\?/g, '_');

  if (!hasQuestion) {
    return { like: escapedForLike, regex: null };
  }

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
  return { like: escapedForLike, regex: new RegExp(regexStr) };
}

function unwrapJsonb(raw: unknown): any {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export class PostgresKVAdapter {
  readonly _isPostgresKV = true;

  constructor(private readonly sql: postgres.Sql) {}

  private async ready(): Promise<void> {
    await ensureSelfHostedPostgresSchema(this.sql);
  }

  async get(key: string): Promise<any> {
    await this.ready();
    const rows = await this.sql`
      SELECT value FROM kv_store
      WHERE key = ${key} AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    return unwrapJsonb(rows[0].value);
  }

  async set(key: string, value: any, options?: { ex?: number }): Promise<string> {
    await this.ready();
    const expiresAt =
      options?.ex && options.ex > 0 ? new Date(Date.now() + options.ex * 1000) : null;
    const jsonPayload = this.sql.json(value);
    await this.sql`
      INSERT INTO kv_store (key, value, expires_at, updated_at)
      VALUES (${key}, ${jsonPayload}, ${expiresAt}, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
    `;
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    await this.ready();
    const result = await this.sql`
      DELETE FROM kv_store WHERE key = ANY(${keys})
    `;
    return result.count ?? keys.length;
  }

  async hgetall(key: string): Promise<Record<string, unknown> | null> {
    const val = await this.get(key);
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
    return null;
  }

  async hset(key: string, dataOrField: any, value?: any): Promise<number> {
    await this.ready();
    const patch: Record<string, any> =
      typeof dataOrField === 'object' && dataOrField !== null
        ? dataOrField
        : typeof dataOrField === 'string'
          ? { [dataOrField]: value }
          : {};
    const patchJson = this.sql.json(patch);

    await this.sql`
      INSERT INTO kv_store (key, value, expires_at, updated_at)
      VALUES (${key}, ${patchJson}, NULL, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = CASE
          WHEN (kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= NOW())
            OR jsonb_typeof(kv_store.value) <> 'object'
          THEN EXCLUDED.value
          ELSE kv_store.value || EXCLUDED.value
        END,
        expires_at = CASE
          WHEN kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= NOW() THEN NULL
          ELSE kv_store.expires_at
        END,
        updated_at = NOW()
    `;
    return 1;
  }

  async hincrby(key: string, field: string, increment: number): Promise<number> {
    await this.ready();
    const initialObj = this.sql.json({ [field]: increment });
    const rows = await this.sql`
      INSERT INTO kv_store (key, value, expires_at, updated_at)
      VALUES (${key}, ${initialObj}, NULL, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = CASE
          WHEN (kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= NOW())
            OR jsonb_typeof(kv_store.value) <> 'object'
          THEN EXCLUDED.value
          ELSE jsonb_set(
            kv_store.value,
            ARRAY[${field}],
            to_jsonb(COALESCE((kv_store.value ->> ${field})::numeric, 0) + ${increment}::numeric),
            true
          )
        END,
        expires_at = CASE
          WHEN kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= NOW() THEN NULL
          ELSE kv_store.expires_at
        END,
        updated_at = NOW()
      RETURNING (value ->> ${field})::numeric AS next_val
    `;
    return Number(rows[0]?.next_val ?? increment);
  }

  async incr(key: string): Promise<number> {
    return this.incrby(key, 1);
  }

  async incrby(key: string, increment: number): Promise<number> {
    await this.ready();
    const initialJson = this.sql.json(increment);
    const rows = await this.sql`
      INSERT INTO kv_store (key, value, expires_at, updated_at)
      VALUES (${key}, ${initialJson}, NULL, NOW())
      ON CONFLICT (key) DO UPDATE SET
        value = CASE
          WHEN kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= NOW()
          THEN EXCLUDED.value
          ELSE to_jsonb(
            COALESCE(
              CASE
                WHEN jsonb_typeof(kv_store.value) = 'number' THEN (kv_store.value #>> '{}')::numeric
                WHEN jsonb_typeof(kv_store.value) = 'string' THEN NULLIF(kv_store.value #>> '{}', '')::numeric
                ELSE 0
              END,
              0
            ) + ${increment}::numeric
          )
        END,
        expires_at = CASE
          WHEN kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= NOW() THEN NULL
          ELSE kv_store.expires_at
        END,
        updated_at = NOW()
      RETURNING (value #>> '{}')::numeric AS next_val
    `;
    return Number(rows[0]?.next_val ?? increment);
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    await this.ready();
    const uniqueNew = Array.from(new Set(members.map(String)));
    const existing = await this.smembers(key);
    const merged = Array.from(new Set([...existing, ...uniqueNew]));
    const added = merged.length - existing.length;
    if (added > 0 || existing.length === 0) {
      const jsonArr = this.sql.json(merged);
      await this.sql`
        INSERT INTO kv_store (key, value, expires_at, updated_at)
        VALUES (${key}, ${jsonArr}, NULL, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = (
            SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
            FROM jsonb_array_elements_text(
              CASE
                WHEN (kv_store.expires_at IS NOT NULL AND kv_store.expires_at <= NOW())
                  OR jsonb_typeof(kv_store.value) <> 'array'
                THEN '[]'::jsonb
                ELSE kv_store.value
              END || EXCLUDED.value
            ) AS elem
          ),
          updated_at = NOW()
      `;
    }
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    const val = await this.get(key);
    return Array.isArray(val) ? val.map(String) : [];
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (members.length === 0) return 0;
    await this.ready();
    const existing = await this.smembers(key);
    if (existing.length === 0) return 0;
    const removeList = Array.from(new Set(members.map(String)));
    const removeSet = new Set(removeList);
    const removed = existing.filter((m) => removeSet.has(m)).length;
    if (removed > 0) {
      await this.sql`
        UPDATE kv_store
        SET value = COALESCE(
          (
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements_text(
              CASE WHEN jsonb_typeof(kv_store.value) = 'array' THEN kv_store.value ELSE '[]'::jsonb END
            ) AS elem
            WHERE NOT (elem = ANY(${removeList}))
          ),
          '[]'::jsonb
        ),
        updated_at = NOW()
        WHERE key = ${key}
      `;
    }
    return removed;
  }

  async expire(key: string, seconds: number): Promise<number> {
    await this.ready();
    const expiresAt = new Date(Date.now() + Math.max(0, seconds) * 1000);
    const res = await this.sql`
      UPDATE kv_store SET expires_at = ${expiresAt}, updated_at = NOW()
      WHERE key = ${key}
    `;
    return res.count > 0 ? 1 : 0;
  }

  async mget(...keysOrArray: Array<string | string[]>): Promise<any[]> {
    const keys = Array.isArray(keysOrArray[0])
      ? (keysOrArray[0] as string[])
      : (keysOrArray as string[]);
    if (keys.length === 0) return [];
    await this.ready();
    const rows = await this.sql`
      SELECT key, value FROM kv_store
      WHERE key = ANY(${keys}) AND (expires_at IS NULL OR expires_at > NOW())
    `;
    const byKey = new Map<string, any>();
    for (const row of rows) {
      byKey.set(String(row.key), unwrapJsonb(row.value));
    }
    return keys.map((k) => (byKey.has(k) ? byKey.get(k) : null));
  }

  async scan(_cursor: number | string, options?: { match?: string; count?: number }): Promise<[number, string[]]> {
    await this.ready();
    const { like, regex } = globToSqlLike(options?.match);
    const rows = await this.sql`
      SELECT key FROM kv_store
      WHERE key LIKE ${like} ESCAPE '\\'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY key ASC
    `;
    let keys = rows.map((r) => String(r.key));
    if (regex) {
      keys = keys.filter((k) => regex.test(k));
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
              const results: any[] = [];
              for (const cmd of commands) {
                results.push(await cmd());
              }
              return results;
            };
          }
          const method = (self as any)[prop];
          if (typeof method === 'function') {
            return (...args: any[]) => {
              commands.push(() => method.apply(self, args));
              return proxy;
            };
          }
          throw new Error(`PostgresKVAdapter pipeline: method not implemented: ${String(prop)}`);
        },
      }
    );
    return proxy;
  }
}
