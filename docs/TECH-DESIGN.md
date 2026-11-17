# AI Relay — 技术架构设计

> 对应代码基线：`v2.14.2`（多平台统一内核：Vercel / Cloudflare Pages / Docker & VPS 自部署 / 本地 CLI）

---

## 1. 设计原则与架构总览

AI Relay 采用**单一核心引擎 + 多平台运行时适配层**架构：所有路由解析、多 Key 轮换、跨协议转换、熔断器、配额控制与安全校验只维护一套核心代码（`src/lib/relay/` 与 `src/lib/providers/`），通过环境自感知层无缝运行在四种部署形态上。

```text
客户端 (OpenAI SDK / Anthropic SDK / Claude Code / Codex / Cursor)
   │
   ├─ POST /v1/chat/completions
   ├─ POST /v1/messages  &  POST /v1/messages/count_tokens
   ├─ POST /v1/responses
   └─ GET  /v1/models    &  GET  /v1/models/:model
   │
   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. 接入与防护层 (src/middleware.ts, src/lib/relay/auth.ts, validation.ts)│
│    - 动态 CORS 校验（支持 Authorization / X-API-Key / Anthropic-* 头）   │
│    - 实例并发闸门 (RELAY_MAX_CONCURRENT)                                 │
│    - 常量时间密钥比对 + 无状态 HMAC-SHA256 临时客户端密钥校验             │
│    - O(1) Content-Length 预检 + 请求体 / Base64 图片体积防爆校验          │
├─────────────────────────────────────────────────────────────────────────┤
│ 2. 路由与容灾内核 (src/lib/providers/resolver.ts, src/lib/relay/*)      │
│    - 模型别名映射 & 隐藏模型过滤 (relay:models:aliases)                  │
│    - 优先级路由规则 (relay:priority:rules) & 智能路由评分                │
│    - 熔断器 (rate-limiter.ts) & 多级 Fallback 防环链 (fallbackChains)    │
│    - 多 Key 轮换池 (key-pool.ts)：版本号轻量校验 + 60s 故障冷却退避      │
├─────────────────────────────────────────────────────────────────────────┤
│ 3. 协议桥接与流式透传层 (src/lib/relay/transform.ts, stream-usage.ts)   │
│    - OpenAI Chat ↔ Anthropic Messages 双向请求/响应/SSE 实时互转        │
│    - 同协议零拷贝原始请求体直通 (rawBody passthrough)                    │
│    - 零逐块 JSON.parse 的轻量 SSE 字节计量流包装                         │
└──────────┬──────────────────┬────────────────────┬──────────────────────┘
           │                  │                    │
           ▼                  ▼                    ▼
     存储与配置抽象层     可观测性与告警层       后台调度层
   (KV / D1 / Disk / PG) (RequestLogs / Webhook) (Vercel / CF / 内置 Cron)
```

---

## 2. 目录结构（与最新代码严格对齐）

```text
ai-relay/
├── src/
│   ├── middleware.ts                     # /v1/* 动态 CORS 预检与实例级并发限制
│   ├── instrumentation.ts                # Next.js Node 服务启动钩子（激活自部署调度器）
│   ├── app/
│   │   ├── page.tsx / Homepage.tsx       # 状态首页与快速接入引导
│   │   ├── health/route.ts               # 就绪探针 (/health) 与容器存活探针 (?liveness=1)
│   │   ├── v1/
│   │   │   ├── chat/completions/route.ts # OpenAI Chat Completions 兼容端点
│   │   │   ├── messages/route.ts         # Anthropic Messages 原生端点
│   │   │   ├── messages/count_tokens/    # Anthropic Token 计数端点
│   │   │   ├── responses/route.ts        # OpenAI Responses 端点
│   │   │   └── models/                   # 模型列表与单模型详情端点
│   │   ├── admin/                        # Web 管理后台（含 /admin/local-relay 设备审批）
│   │   └── api/
│   │       ├── admin/*                   # 后台管理 REST API（Provider/Key/路由/备份/日志等）
│   │       ├── cron/*                    # 外部定时触发端点（probe / usage / daily-report）
│   │       └── local/*                   # 本地 CLI 设备授权、配置快照同步与用量批量上报
│   └── lib/
│       ├── admin/                        # 统一配置中心 (admin-config.ts)、CFKVAdapter、鉴权
│       ├── config-store/                 # ConfigStore 接口与 VercelKV / Postgres 实现
│       ├── db/                           # PostgreSQL 连接池与自部署幂等自动建表 Schema
│       ├── health/                       # 上游 Provider 健康探针执行器与存储
│       ├── local/                        # 设备授权令牌哈希与鉴权 (device-auth.ts)
│       ├── observability/                # 按需请求追踪日志（Memory / KV / Postgres）
│       ├── providers/                    # 内置与自定义 Provider 注册表、别名与选路解析器
│       ├── relay/                        # 核心转发、多 Key 池、跨协议转换、熔断、入参校验
│       ├── runtime/                      # 运行时能力识别与自部署后台定时调度器
│       ├── storage/                      # 自部署 FileKVAdapter 与 PostgresKVAdapter
│       ├── usage/                        # 10 字段计量 SDK、BatchUsageRecorder、多后端存储
│       └── webhooks/                     # 企微 / 飞书 / 钉钉 / Slack / 通用 Webhook 推送器
├── cli/                                  # `airelay` 本地 CLI 服务、云端同步与 Codex 适配器
├── migrations/                           # Cloudflare D1 SQLite 增量迁移脚本
├── worker.ts                             # Cloudflare Workers 入口包装（注入 scheduled 定时任务）
├── Dockerfile & docker-compose.yml       # 自部署多阶段容器构建与磁盘/PostgreSQL 编排
└── scripts/ci-local.sh                   # 本地全链路 CI 验收脚本（lint + tsc + vitest + build）
```

---

## 3. 核心数据面链路

### 3.1 鉴权与安全边界 (`src/lib/relay/auth.ts`, `src/lib/admin/auth.ts`)

1. **多头部兼容提取**：同时支持 `Authorization: Bearer <key>` 与 `X-API-Key: <key>`（兼容 OpenAI SDK 与 Anthropic Claude Code / SDK）。
2. **常量时间比对 (`constantTimeEqual`)**：所有静态密钥比对均基于固定长度缓冲区的异或累加，消除时序侧信道风险。
3. **无状态 HMAC-SHA256 临时密钥**：
   - 格式：`rk_temp.<base64url(payload)>.<signature>`，签名密钥按 `RELAY_SIGNING_SECRET -> RELAY_ADMIN_KEY -> RELAY_API_KEY` 派生（无硬编码默认密钥）。
   - 支持过期时间戳、允许模型白名单以及基于 KV 原子计数的调用配额限制。
4. **负载防爆保护 (`src/lib/relay/validation.ts`)**：
   - 在读取请求流前先执行 `Content-Length` 头部 O(1) 预检（默认上限 10MB），拦截超大负载耗尽 Serverless 内存或 Worker CPU。
   - 校验 OpenAI `image_url`、Anthropic `base64` 图片块以及 Responses `input_image` 的单图体积上限（5MB）。

### 3.2 模型解析、智能路由与多级容灾 (`src/lib/providers/resolver.ts`, `src/lib/relay/relay.ts`)

1. **模型别名与隐藏控制**：先通过 `resolveModelAlias()` 将虚拟模型名映射为真实模型，隐藏模型在 `/v1/models` 中自动过滤。
2. **Provider 选路优先级**：
   - 精确或前缀匹配的优先级规则（`PriorityRule`）→ 智能路由策略（延迟 / 成本 / 可用性加权评分）→ Provider 注册表默认匹配。
3. **Key 池轮换与瞬时故障转移 (`key-pool.ts`)**：
   - 内存池缓存解析后的 Key 列表，每 30 秒仅通过单次轻量版本号读取（`admin:keys:version:{provider}`）判断是否需要重拉完整 Key 数组。
   - 当上游返回 `429` 或 `5xx` 时，立即取消未消费的上游响应流（释放底层 Socket），将该 Key 标记 60 秒冷却并轮换同 Provider 下一个可用 Key 重试。
   - 当上游因默认 SDK UA 返回 HTML 拦截页时，自动切换浏览器兼容 User-Agent 重试一次。
4. **跨 Provider Fallback 链与超时预算**：
   - 若当前 Provider 触发熔断或所有可用 Key 均失败（401/403/429/5xx/网络异常），按配置的 Fallback 链（支持 `provider` 或 `provider:targetModel`）自动切换备用 Provider，并通过 `attemptedProviders` 集合严格阻止循环回退。
   - **超时保护不变量**：默认上游超时 `RELAY_UPSTREAM_TIMEOUT_MS = 50000ms`，为 Vercel Serverless 60 秒硬限制预留 10 秒安全窗口；一旦单次上游请求达到超时阈值立即返回结构化 `504`，避免触发平台强制杀进程导致客户端收到非预期断连。

### 3.3 跨协议透明转换矩阵 (`src/lib/relay/transform.ts`)

| 客户端接入端点 | 上游 Provider 类型 | 处理方式 |
|---|---|---|
| `POST /v1/chat/completions` | OpenAI 兼容 (`headerFormat: 'openai' / 'azure'`) | 原生转发（模型名未变且在 CF 环境时支持 `rawBody` 零重序列化直通） |
| `POST /v1/chat/completions` | Anthropic (`headerFormat: 'anthropic'`) | 自动将 OpenAI 消息/系统提示词/工具定义转为 `/v1/messages`，并将响应或 SSE 流实时转回 OpenAI chunk 格式 |
| `POST /v1/messages` | Anthropic (`headerFormat: 'anthropic'`) | 原生直通 Anthropic Messages API（含 `thinking`、`tool_use`、缓存控制等字段） |
| `POST /v1/messages` | OpenAI 兼容 (`headerFormat: 'openai' / 'azure'`) | 自动将 Anthropic 请求转为 OpenAI Chat Completions，并将响应或流式 delta 实时合成标准 Anthropic SSE 事件流（`message_start` → `content_block_*` → `message_delta` → `message_stop`） |
| `POST /v1/responses` | OpenAI 兼容 | 原生转发至 `/responses` 并提取或估算流式用量 |

---

## 4. 多平台特性与深度优化

| 平台维度 | 关键约束 | 项目内的针对性工程实现 |
|---|---|---|
| **Cloudflare Pages / Workers** | 免费层单请求 ~10ms CPU 预算；单请求最多 6 个并发出站连接；50 次子请求上限；无全局持久环境引用 | 1. 通过请求级 `getCloudflareContext()` 动态获取 `KV` / `DB` 绑定；<br>2. `CFKVAdapter` 实现单 Key 互斥锁、按 Key 归并的 6 并发上限队列以及 `<60s` TTL 自动抬升至 `60s`；<br>3. 流式传输采用零 `JSON.parse` 字节扫描器提取末尾 `usage`；<br>4. 每次错误重试前显式 `res.body.cancel()` 防止占满 6 个并发 Socket；<br>5. `worker.ts` 注入 `scheduled()` 执行健康探测与 D1 历史表清理。 |
| **Vercel Serverless** | 函数最大执行时长 60s；Upstash 免费 Redis 每日命令数有限 | 1. `BatchUsageRecorder` 内存环形缓冲区聚合写入 + Lua 脚本单次原子更新多维计数；<br>2. 支持 `RELAY_KV_USAGE_SAMPLE_RATE` 与错误明细采样率；<br>3. KV 读取瞬时超时返回 `TIMEOUT_OR_ERROR` 哨兵值，保留上一次健康内存缓存而不误覆盖为空。 |
| **Docker / VPS 自部署** | 无平台托管 Cron；编排器在未配 Key 时易因健康检查 503 重启容器；单机与多实例存储需求分化 | 1. 单机默认启用 `FileKVAdapter`（内存 O(1) 读写 + `0600` 临时文件原子 `rename` 落盘，零外部依赖）；<br>2. 配置 `DATABASE_URL` 时自动切换 `PostgresKVAdapter` + `PostgresUsageStorage`，首次连接幂等自动建表；<br>3. `src/instrumentation.ts` 自动拉起 `self-hosted-scheduler`（定时健康探针、UTC 日报聚合、过期清理、Webhook 推送）；<br>4. `/health?liveness=1` 专供容器编排存活探针。 |
| **本地 CLI (`airelay`)** | 离线可用性、云端配置安全同步、开发机零配置体验 | 1. 支持 `--config` 本地文件、环境变量、云端 Device Code 授权同步四种模式；<br>2. 设备令牌经 SHA-256 哈希存储，换取令牌强制一次性消费；<br>3. 内置 `CodexAdapter` 自动备份并注入 `~/.codex/config.toml`。 |
