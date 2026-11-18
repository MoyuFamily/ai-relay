# AI Relay — 多平台存储架构说明

AI Relay 在不引入外部重型中间件的前提下，针对不同部署平台自动选择最优的配置存储（Config / KV）与计量存储（Usage / Logs）实现。

---

## 1. 平台与存储后端映射矩阵

| 部署运行环境 | 触发条件（自动检测优先级） | 配置与状态存储 (`getKV` / `ConfigStore`) | 用量与配额存储 (`UsageStorage`) | 请求追踪日志 (`RequestLogStore`) |
|---|---|---|---|---|
| **Cloudflare Pages / Workers** | 请求级 OpenNext Context 存在 `env.KV` / `env.DB` | `CFKVAdapter`（Cloudflare Workers KV） | `D1UsageStorage`（Cloudflare D1 SQLite，请求内直写） | `KVRequestLogStore`（CF KV，游标分页 + 24h TTL） |
| **Vercel Serverless** | 设置了 `KV_REST_API_URL` 与 `KV_REST_API_TOKEN` | `@vercel/kv`（Upstash Redis REST） | `KVUsageStorage`（内存环形缓冲聚合 + Lua 脚本） | `KVRequestLogStore`（Redis `SCAN` + `MGET`） |
| **自部署 — 单机持久化磁盘** | 设置了 `RELAY_STORAGE_PATH` / `RELAY_DATA_DIR`，或非云端 `NODE_ENV=production` 默认状态 | `FileKVAdapter`（`./data/kv-store.json`） | `KVUsageStorage`（直写内存态 + 40ms 防抖原子落盘，默认全量精确统计） | `KVRequestLogStore`（持久化至本地磁盘，自动 TTL 淘汰） |
| **自部署 — 多实例 PostgreSQL** | 非 Vercel/CF 环境设置了 `DATABASE_URL=postgres://...` | `PostgresKVAdapter` + `PostgresConfigStore`（`kv_store` JSONB 表） | `PostgresUsageStorage`（关系型表实时原子累加） | `PostgresRequestLogStore`（Drizzle ORM + 自动条数裁剪） |
| **本地 CLI (`airelay`)** | `airelay local:start` | `SnapshotConfigStore`（云端快照同步 / 本地 JSON / 环境变量） | 内存批量缓冲并定时上报 `/api/local/usage/batch` | 本机标准输出与状态统计 |
| **本地开发 / 单元测试** | `NODE_ENV=development` 或 `test` | `createMemoryMockKV()`（进程内内存模拟） | `KVUsageStorage`（基于内存模拟 KV） | `MemoryRequestLogStore` |

> 在 `next build` 静态构建阶段（`NEXT_PHASE === 'phase-production-build'`），存储工厂会自动跳过本地文件创建与外部数据库连接，确保 CI/CD 在无真实数据库的构建环境下零阻塞通过。

---

## 2. 各存储后端核心实现机制

### 2.1 Cloudflare KV + D1 (`src/lib/admin/cf-kv-adapter.ts`, `src/lib/usage/storage/d1-usage-storage.ts`)
- **并发与一致性保护**：`CFKVAdapter` 对单 Key 读改写操作（`hset`、`hincrby`、`sadd`、`srem`、`incrby`）内置进程内异步互斥锁，并在 `pipeline()` 中按 Key 分组顺序执行、全局限制最多 6 个并发请求，严格匹配 Cloudflare Workers 出站连接限制。
- **TTL 下限适配**：Cloudflare KV 要求 `expirationTtl >= 60` 秒，`CFKVAdapter` 会自动将小于 60 秒的过期时间安全钳制为 60 秒。
- **D1 关系表结构**：迁移文件位于 `migrations/`（`0001_usage_schema.sql`、`0002_error_key_stats.sql`），包含 `daily_usage`、`key_usage`、`quota_counters`、`error_stats` 与 `error_key_stats`，由 `worker.ts` 每日定时清理过期分区。

### 2.2 自部署单机磁盘存储 (`src/lib/storage/file-kv-adapter.ts`)
- **零外部依赖**：无需安装 Redis、PostgreSQL 或编译原生 C++ SQLite 模块，单容器挂载 `/app/data` 即可持久化所有后台配置、密钥池、设备授权与统计报表。
- **高性能与崩溃安全**：所有读取在内存中 O(1) 完成；写入在内存立即生效后经 40ms 防抖合并，先写入同目录临时文件（权限 `0600`）再通过 POSIX `rename` 原子替换目标文件，并在 `SIGTERM` / `SIGINT` / `beforeExit` 时强制刷盘。
- **外部修改感知**：每次读取前比对文件 `mtimeMs`，若外部恢复或替换了状态文件会自动热重载。

### 2.3 自部署多实例 PostgreSQL 存储 (`src/lib/db/self-hosted-schema.ts`, `src/lib/storage/postgres-kv-adapter.ts`, `src/lib/usage/storage/postgres-usage-storage.ts`)
- **零手动迁移**：首次访问数据库时，`ensureSelfHostedPostgresSchema()` 会幂等执行 `CREATE TABLE IF NOT EXISTS`，自动初始化全部 8 张核心表与索引：
  - `kv_store`：存储配置、自定义 Provider、密钥池、单调递增版本号（`admin:config:version`）、探针状态与设备令牌，支持单条 SQL `ON CONFLICT DO UPDATE` 原子 `hincrby` / `incrby` / `hset` / `sadd` / `srem` 与 `expires_at` 过期过滤。
  - `daily_usage`、`key_usage`、`quota_counters`、`error_stats`、`error_key_stats`：关系型原子累加表，支持多副本无锁并发写入与精确配额预占。
  - `request_logs`、`config_flags`：供 `PostgresRequestLogStore` 存储按需开启的请求级追踪日志。
- **连接池兼容**：底层 `postgres` 客户端默认启用 `prepare: false` 并支持 `DATABASE_POOL_MAX` 配置，同时兼容直连 PostgreSQL 与 Supabase / PgBouncer 事务连接池。

---

## 3. 跨平台平滑迁移（备份与恢复）

无论使用哪种部署形态，都可以在 `/admin` 后台的 **辅助工具 (Tools)** 页面执行：
1. **配置备份导出 / 导入**（`/api/admin/backup`）：完整迁移自定义 Provider、API Key 池、模型别名、优先级规则、Fallback 链、配额与 Webhook 配置。
2. **统计数据导出 / 导入**（`/api/admin/backup/stats`）：导出历史每日用量、Provider 维度明细、日报与错误统计；导入时不仅写入当前 KV 后端，在 Cloudflare D1 或自部署 PostgreSQL 模式下还会自动同步回填关系型 `daily_usage` 表，保证趋势图表无缝衔接。
