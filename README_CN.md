<div align="center">

<img src="docs/assets/logo-banner.svg" alt="AI Relay" width="400">

**个人与团队的 AI API 统一网关 — 支持 Serverless 云端部署、Docker 自托管与本地 CLI 运行**

<p>
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/MoyuFamily/ai-relay&env=RELAY_API_KEY,RELAY_ADMIN_KEY,RELAY_SIGNING_SECRET&envDescription=API%20authentication%20keys%20(required%20for%20security)&envLink=https://github.com/MoyuFamily/ai-relay/blob/main/README_CN.md#-快速开始">
    <img src="https://vercel.com/button" alt="Deploy with Vercel" height="36">
  </a>
  &nbsp;
  <a href="#deploy-cloudflare">
    <img src="https://img.shields.io/badge/⚡_Deploy_to_Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Deploy to Cloudflare" height="36">
  </a>
  &nbsp;
  <a href="#deploy-self-hosted">
    <img src="https://img.shields.io/badge/🐳_Docker_自部署-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Self-Host with Docker" height="36">
  </a>
  &nbsp;
  <a href="#deploy-local-cli">
    <img src="https://img.shields.io/badge/💻_本地运行_(CLI)-000?style=for-the-badge&logo=terminal&logoColor=white" alt="Run locally" height="36">
  </a>
</p>

[![Version](https://img.shields.io/badge/Version-2.14.2-green.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · [中文](README_CN.md)

</div>

---

> **一个网关，统一管理所有大模型接口。**
>
> 将 OpenAI、Anthropic (Claude)、DeepSeek、MiMo 以及任意兼容 OpenAI / Anthropic 协议的自定义 Provider 收敛到单一端点。
> 内置多 Key 自动轮换、跨协议故障转移、熔断保护与智能路由，零业务代码改造。

### 四种部署形态怎么选？

| | ☁️ Vercel | ⚡ Cloudflare Pages | 🐳 自部署 (Docker / VPS) | 💻 本地 CLI (`airelay`) |
|---|---|---|---|---|
| **适合场景** | 快速试用、轻量日常对话 | 免费层高频编码调用 | 长耗时推理、多模态、团队共享、无平台限制 | 本机跑 Codex / Claude Code 等本地 Agent |
| **运行环境** | Vercel Node.js Serverless（最长 `60s`） | Cloudflare Workers（`@opennextjs/cloudflare`） | 独立 Node.js 容器或常驻进程 | 本机 HTTP 服务（默认 `127.0.0.1:3147`） |
| **数据存储** | Upstash Redis（`@vercel/kv`） | Cloudflare KV（配置）+ D1（统计） | 本地持久化磁盘（`./data`）**或** PostgreSQL | 云端快照同步 / 本地 JSON / 环境变量 |
| **用量统计** | 支持采样统计（节省免费 KV 额度） | D1 直写 + 流式字节估算 | **100% 实时精确统计**（磁盘或 Postgres） | 批量聚合并同步回云端后台 |
| **定时任务** | Vercel Cron（`/api/cron/*`） | Workers `scheduled()` + D1 自动清理 | **内置后台调度器**（自动探测/日报/清理） | 30s 配置同步 + 60s 设备心跳 |
| **平台限制** | Hobby 免费层有流量、KV 次数与 60s 上限 | 免费层单次请求约 10ms CPU 预算、6 并发连接上限 | **无 Serverless 限制**（取决于自有服务器） | 默认仅本机访问，需进程常驻 |

> **一句话选择：** 想 2 分钟零成本尝鲜用 **Vercel**；想白嫖高频编码用 **Cloudflare**；有 VPS/NAS、跑长推理或团队共用直接上 **Docker 自部署**；在本机跑 Agent 不想消耗云端额度用 **本地 CLI**。四种形态共用同一套核心引擎，配置与备份可随时迁移。

---

## 🚀 快速开始

### ☁️ 1. 一键部署到 Vercel（最快体验）

1. 点击上方 **Deploy with Vercel** 按钮，配置环境变量：

| 变量 | 说明 |
|------|------|
| `RELAY_API_KEY` | 客户端调用 `/v1/*` 的鉴权密钥（支持 `Bearer` 或 `X-API-Key`） |
| `RELAY_ADMIN_KEY` | `/admin` 后台登录密钥（可选，未设置时回退到 `RELAY_API_KEY`） |
| `RELAY_SIGNING_SECRET` | 临时密钥 HMAC 签名密钥（可选） |

2. 部署后进入 Vercel Dashboard → **Storage** → 创建并关联 **Upstash for Redis**（自动注入 `KV_REST_API_URL` 与 `KV_REST_API_TOKEN`）。
3. 打开 `/admin` 添加上游 Provider Key，即可开始调用：

```bash
curl -X POST https://你的项目.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer YOUR_RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-5.4", "messages": [{"role": "user", "content": "你好！"}]}'
```

<details id="deploy-cloudflare">
<summary><strong>⚡ 2. 部署到 Cloudflare Pages</strong></summary>

**前置条件：** [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费）+ Fork 本仓库。

**第 1 步 — 配置 GitHub Repository Secrets**（`Settings → Secrets and variables → Actions`）：

| Secret | 说明 | 必填 |
|--------|------|------|
| `CLOUDFLARE_API_TOKEN` | 具备 `Cloudflare Pages:Edit`、`D1:Edit`、`Workers KV Storage:Edit` 权限 | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID | ✅ |
| `RELAY_API_KEY` | 客户端鉴权密钥 | ✅ |
| `RELAY_ADMIN_KEY` | Admin 登录密钥（可选，默认同 `RELAY_API_KEY`） | ⬜ |
| `RELAY_SIGNING_SECRET` | 临时密钥签名密钥（可选） | ⬜ |
| `DEVICE_TOKEN_SECRET` | 本地 CLI 设备令牌哈希密钥（可选） | ⬜ |
| `CRON_SECRET` | 定时任务鉴权密钥（可选） | ⬜ |

**第 2 步 — 推送自动部署**

推送到 `main` 分支（或在 Actions 页面手动触发 **Deploy to Cloudflare Pages**），工作流会自动完成 D1 建表与迁移、KV 创建、OpenNext 构建部署及密钥同步。

**第 3 步 — 验证**

```bash
curl https://你的项目.pages.dev/health
```

</details>

<details id="deploy-self-hosted">
<summary><strong>🐳 3. 自部署服务（Docker / VPS / NAS）</strong></summary>

自部署模式运行在独立 Node.js 服务上，**无 60s 函数超时或 CPU 时间限制**，内置后台定时调度器（自动执行上游健康探测、每日用量聚合、过期数据清理与 Webhook 日报推送），并提供容器存活探针 `/health?liveness=1`。

#### 方案 A — 单容器持久化磁盘模式（零外部数据库依赖，开箱即用）

默认将后台配置、Provider Key、模型别名、路由规则、配额与用量自动持久化到 `/app/data/kv-store.json`（原子写入 + `0600` 权限保护）：

```bash
git clone https://github.com/MoyuFamily/ai-relay.git && cd ai-relay
RELAY_API_KEY=your-strong-secret docker compose up -d --build
```

#### 方案 B — 多实例 / PostgreSQL 高可用模式

传入 `DATABASE_URL` 即可切换至 PostgreSQL 模式，**服务启动时会自动幂等创建所需全部数据表与索引**，无需手动执行 SQL 迁移：

```bash
DATABASE_URL=postgresql://airelay:airelay@postgres:5432/airelay \
RELAY_API_KEY=your-strong-secret \
docker compose --profile postgres up -d --build
```

#### 方案 C — 裸机 / PM2 / Systemd 直接运行

```bash
pnpm install --frozen-lockfile
NEXT_STANDALONE=1 pnpm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
RELAY_API_KEY=your-strong-secret RELAY_DATA_DIR=./data node .next/standalone/server.js
```

> **容器健康检查说明：**
> - **存活探针 (Liveness)**：`GET /health?liveness=1` — 只要服务进程正常响应即返回 `200`（即使刚启动尚未在 `/admin` 添加任何上游 Key，也不会触发容器无限重启）。
> - **就绪探针 (Readiness)**：`GET /health` — 至少有 1 个可用上游 Key 时返回 `200`，否则返回 `503`。

</details>

<details id="deploy-local-cli">
<summary><strong>💻 4. 本地 CLI 运行（<code>airelay</code>）</strong></summary>

在开发机本地启动 `http://127.0.0.1:3147` 轻量网关，直接服务 Codex、Claude Code、Cursor 等工具，不消耗云端 Serverless 额度。

> 📖 完整指南见 [CLI_GUIDE.md](CLI_GUIDE.md)

```bash
git clone https://github.com/MoyuFamily/ai-relay.git && cd ai-relay
pnpm install && npm link

# 方式 A：绑定云端或自建后台，自动同步 Provider 与密钥配置
airelay login https://your-relay.example.com
airelay local:start

# 方式 B：纯本地离线配置文件或环境变量启动
airelay local:start --config ./relay-config.json
OPENAI_KEYS="sk-xxx" airelay local:start

# 可选：一键写入并检查 Codex CLI 配置
airelay agent:install codex
airelay agent:doctor codex
```

</details>

---

## ✨ 核心能力

**多协议原生支持与跨协议透明转换**
| 接口路径 | 协议规范 | 能力说明 |
|----------|----------|----------|
| `POST /v1/chat/completions` | OpenAI Chat Completions | 支持流式/非流式、Tool Calls、多模态图片，支持向 Anthropic `/v1/messages` 透明故障转移与格式互转 |
| `POST /v1/messages` | Anthropic Messages API | Claude Code / Anthropic SDK 原生直连，支持跨协议回退到 OpenAI 兼容 Provider |
| `POST /v1/messages/count_tokens` | Anthropic Token 计数 | 优先调用上游计数接口，不可用时自动降级本地精确估算 |
| `POST /v1/responses` | OpenAI Responses API | 支持流式与非流式 Responses API 转发 |
| `GET /v1/models` & `/v1/models/:model` | OpenAI 模型列表 | 自动聚合已启用模型、虚拟模型别名并过滤隐藏模型 |

**路由、容灾与安全治理**
- **多 Key 轮换与冷却退避**：Round-Robin 轮询，遇到 `429` / `5xx` 自动将该 Key 标记 60 秒冷却并立即切换同池可用 Key 重试。
- **多级 Fallback 与防环保护**：支持跨 Provider 及指定目标模型（`provider:model`）链式回退，保存与运行时双重环路检测。
- **熔断器与智能路由**：连续故障自动熔断摘除，支持按优先级规则、延迟、成本或可用性自动选路。
- **HMAC 无状态临时密钥**：无需写库即可签发带过期时间、模型白名单与调用次数上限的临时客户端 Key。
- **可观测性与通知告警**：支持企微、飞书、钉钉、Slack 与通用 Webhook 日报及阈值告警；支持按需开启实时请求追踪日志。

---

## 🏗️ 系统架构

```text
客户端 (OpenAI SDK / Claude Code / Codex / Cursor / curl)
   │
   ▼  /v1/chat/completions · /v1/messages · /v1/responses · /v1/models
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI Relay 核心转发引擎                            │
│  常量时间鉴权 + HMAC 临时密钥 → 配额与请求体大小校验                      │
│  → 模型别名与优先级规则 → 智能路由与熔断器 → 多 Key 轮换池               │
│  → OpenAI ↔ Anthropic 双向协议桥接与流式透传                             │
├─────────────────┬──────────────────┬───────────────────┬────────────────┤
│ Vercel          │ Cloudflare Pages │ 自部署 Node 服务   │ 本地 CLI       │
│ Serverless Node │ OpenNext Workers │ Docker / VPS      │ 127.0.0.1:3147 │
│ + Upstash KV    │ + CF KV + CF D1  │ + 本地磁盘/Postgres│ + 云端同步     │
└─────────────────┴──────────────────┴───────────────────┴────────────────┘
   │                  │                  │                  │
   ▼                  ▼                  ▼                  ▼
OpenAI · Anthropic (Claude) · DeepSeek · MiMo · 任意自定义兼容 Provider
```

深入实现细节请参考 [技术架构文档](docs/TECH-DESIGN.md) 与 [存储架构文档](docs/storage-architecture.md)。

---

## 🔧 环境变量参考

完整配置模板请查看 [`.env.local.example`](.env.local.example)。

| 变量 | 说明 | 必填 |
|------|------|------|
| `RELAY_API_KEY` | 客户端鉴权密钥，逗号分隔支持多个（支持 `Bearer` 与 `X-API-Key`） | ✅ |
| `RELAY_ADMIN_KEY` | Admin 后台密钥（未设置时默认回退到 `RELAY_API_KEY`） | ⬜ |
| `RELAY_SIGNING_SECRET` | 临时客户端 Key 的 HMAC 签名密钥 | ⬜ |
| `DEVICE_TOKEN_SECRET` | 本地 CLI 设备登录令牌（`airelay login`）哈希密钥 | ⬜ |
| `OPENAI_KEYS` / `CLAUDE_KEYS` / `DEEPSEEK_KEYS` / `XIAOMI_KEYS` | 静态环境变量密钥（更推荐在 `/admin` 后台可视化管理） | ⬜ |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV / Upstash Redis 连接凭据 | ⬜ |
| `RELAY_DATA_DIR` / `RELAY_STORAGE_PATH` | 自部署单机模式的持久化目录或文件路径（默认 `./data`） | ⬜ |
| `DATABASE_URL` | 自部署多实例 PostgreSQL 连接串（启动时自动建表） | ⬜ |
| `ENABLE_SELF_HOSTED_CRON` | 自部署服务是否启用内置后台定时任务（默认 `true`） | ⬜ |
| `SELF_HOSTED_PROBE_INTERVAL_MINUTES` | 自部署内置上游健康探测间隔分钟数（默认 `60`） | ⬜ |
| `RELAY_DAILY_LIMIT` / `RELAY_MONTHLY_LIMIT` | 全局每日 / 每月请求上限（`0` 为不限制，可在后台覆盖） | ⬜ |
| `RELAY_MAX_CONCURRENT` | 单实例 `/v1/*` 最大并发请求数限制（`0` 为不限制） | ⬜ |
| `RELAY_ALLOWED_ORIGINS` | 允许的浏览器跨域 CORS 来源（逗号分隔或 `*`） | ⬜ |
| `RELAY_UPSTREAM_TIMEOUT_MS` | 上游请求超时毫秒数（默认 `50000`，设 `0` 关闭） | ⬜ |
| `RELAY_KV_USAGE_SAMPLE_RATE` | KV 用量采样率（默认 `1` 全量，`0.1` 表示 10% 采样） | ⬜ |

---

## 📊 Admin 管理后台

访问 `/admin` 使用 `RELAY_ADMIN_KEY` 登录：

- **运行概览与监控** — 今日/本月请求与 Token 趋势、Provider 健康探针状态、错误分布与实时请求日志抓取。
- **Provider 与密钥管理** — 三步式自定义 Provider 向导、Cherry Studio / NewAPI 一键导入、CcSwitch 导出、单 Key 连通性测试。
- **路由策略与模型别名** — 虚拟模型别名、模型隐藏控制、优先级路由规则、智能路由权重与拖拽式 Fallback 链。
- **安全与运维工具** — HMAC 临时密钥签发、密钥轮换提醒、配置与统计 JSON 备份恢复、多平台 Webhook 通知。

<details>
<summary>查看后台截图</summary>

![运行概览](docs/assets/screenshots/admin-overview.png)
![密钥管理](docs/assets/screenshots/admin-keys.png)
![辅助工具](docs/assets/screenshots/admin-tools.png)

</details>

---

## 📚 项目文档索引

- **[本地 CLI 使用指南](CLI_GUIDE.md)** — `airelay` 安装、云端绑定同步、离线配置与 Codex 自动接入
- **[技术架构设计](docs/TECH-DESIGN.md)** — 核心请求链路、跨协议转换矩阵与多平台运行时适配细节
- **[多平台存储架构](docs/storage-architecture.md)** — Vercel KV、Cloudflare KV+D1、自部署磁盘与 PostgreSQL 存储层说明
- **[常见问题 (FAQ)](docs/FAQ.md)** — 部署排错、鉴权、Docker 自托管与本地 CLI 问答
- **[发布分支流程](docs/RELEASE-FLOW.md)** — Fork 用户与维护者的分支及自动化发布约定
- **[更新日志](CHANGELOG.md)** — 历史版本变更记录

## 📄 许可证

MIT — [LICENSE](LICENSE)

## 👥 团队

| | 姓名 | 角色 |
|---|---|---|
| <img src="https://avatars.githubusercontent.com/u/7930911?v=4" width="28" height="28" style="border-radius:50%"> | Parsifal | 创始人 & 项目负责人 |
| <img src="https://avatars.githubusercontent.com/u/286714101?v=4" width="28" height="28" style="border-radius:50%"> | 小赫 | 协调者 |
| <img src="https://avatars.githubusercontent.com/u/286719582?v=4" width="28" height="28" style="border-radius:50%"> | 像素姐 | 设计总监 |
| <img src="https://avatars.githubusercontent.com/u/286715358?v=4" width="28" height="28" style="border-radius:50%"> | 码飞 | 技术总监 |
| <img src="https://avatars.githubusercontent.com/u/286716759?v=4" width="28" height="28" style="border-radius:50%"> | 饼哥 | 产品总监 |
