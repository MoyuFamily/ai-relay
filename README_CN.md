<div align="center">

<img src="docs/assets/logo-banner.svg" alt="AI Relay" width="400">

**开源 AI API 网关 — 支持 VPS 自托管、Vercel、Cloudflare 与本地运行**

<p>
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/MoyuFamily/ai-relay&env=RELAY_API_KEY,RELAY_ADMIN_KEY,RELAY_SIGNING_SECRET&envDescription=API%20authentication%20keys%20(required%20for%20security)&envLink=https://github.com/MoyuFamily/ai-relay/blob/main/README_CN.md#-快速开始">
    <img src="https://vercel.com/button" alt="Deploy with Vercel" height="36">
  </a>
  &nbsp;
  <a href="#-部署到-cloudflare-pages">
    <img src="https://img.shields.io/badge/⚡_Deploy_to_Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Deploy to Cloudflare" height="36">
  </a>
  &nbsp;
  <a href="#-本地运行cli">
    <img src="https://img.shields.io/badge/💻_本地运行-000?style=for-the-badge&logo=terminal&logoColor=white" alt="Run locally" height="36">
  </a>
</p>

[![Version](https://img.shields.io/badge/Version-2.13.0-green.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · [中文](README_CN.md)

</div>

---

> **一个网关，管理所有 AI 接口。**
>
> 把 OpenAI、Claude、DeepSeek 等多个 Provider 的 API Key 统一接入，通过一个端点对外服务。
> 自动轮换 Key、故障转移、熔断保护，不用写一行胶水代码。
>
> **多种部署形态，自由选择：**
> - 🖥️ **VPS / 自托管** — 常驻服务、专属资源、灵活运维，适合持续高负载与共享接入
> - ☁️ **Vercel / Cloudflare** — 快速上线，无需维护 VPS
> - 💻 **本地 CLI** — `airelay local:start`，本地运行并记录用量
> - 🔧 **开发模式** — `npm run dev`，方便修改和调试

### 谁该用哪个？

| | 🖥️ VPS / 自托管 | ☁️ Vercel | ☁️ Cloudflare | 💻 本地 CLI |
|---|---|---|---|---|
| **适合场景** | 持续请求、团队共享、长时间集成任务、资源自主掌控 | 快速体验、轻量应用 | 全球分发的 Serverless 请求 | 个人开发和本地 Agent |
| **运行形态** | Node.js 长驻进程，不受 Serverless 单次执行窗口约束 | Serverless Functions | Edge Workers | 本机常驻进程 |
| **运维方式** | 自行管理 Linux、更新、HTTPS 与备份 | 平台托管 | 平台托管 | 自行管理本机进程 |
| **可观测性** | 主机指标和日志；配置持久化后可保留请求日志 | 平台日志、用量采样 | 平台日志、用量采样 | SQLite 请求与用量记录 |
| **存储** | 需配置当前支持的存储后端；独立 PostgreSQL 配置存储仍在开发 | Upstash Redis（KV） | Cloudflare D1 + KV | 本地 SQLite |
| **核心取舍** | 资源、网络与运维控制最强，但需要维护服务器 | 免费层额度和运行时限制 | Edge 资源与执行时间限制 | 端点可用性依赖本机 |

> **⚠️ Vercel Hobby 使用建议：**
> - **适合**：个人日常对话、轻量 API 中转、开发调试阶段
> - **不适合**：高频编码调用（如 Copilot/Cursor 连续使用）、大图/视频等多模态场景、长时间推理任务
> - 免费层的存储和流量资源有限，项目已实现用量采样统计来缓解压力；多 Key 轮换和用量采样参数均可在管理后台调整
>
> 对持续高频请求、团队共享和长时间流式传输，VPS 能提供更强的资源与运维控制；希望免维护的用户可以选择 Cloudflare，个人 Agent 则适合本地 CLI。

> **一句话选择：** Vercel 负责快速上手，Cloudflare 负责托管边缘部署，VPS 负责稳定常驻和更高控制权，本地 CLI 适合私有 Agent。核心网关 API 一致，但不同运行时的存储与运维配置有所区别。

## 🎯 为什么选 AI Relay

| | 说明 |
|---|---|
| **自由选择部署方式** | Vercel/Cloudflare 免运维，VPS 稳定自托管，本地 CLI 即开即用 |
| **零成本启动** | 免费层即可跑起来，个人开发者不用花一分钱 |
| **一个端点搞定** | 兼容 OpenAI SDK，现有代码只改 `base_url`，零改动迁移 |
| **多 Key 多 Provider** | 自动轮换、故障转移、熔断保护，内置容灾能力 |
| **VPS 体验更可控** | CPU、内存、网络、常驻进程和主机级监控自主可控，适合长期负载；需要自行运维 |

## 🚀 快速开始

### ☁️ 一键部署到 Vercel（推荐新用户）

> 前置条件：[Vercel 账号](https://vercel.com/signup)（免费）+ 至少一个 AI Provider 的 API Key

1. 点击上方 **Deploy with Vercel** 按钮，填入 3 个环境变量：

| 变量 | 说明 |
|------|------|
| `RELAY_API_KEY` | 客户端鉴权密钥（自定义强密码） |
| `RELAY_ADMIN_KEY` | Admin 后台登录密钥（可同上） |
| `RELAY_SIGNING_SECRET` | 临时 Key 签名密钥（可同上） |

2. 部署完成后，在 Vercel Dashboard → **Storage** → 创建 **Upstash for Redis**（Free 套餐）→ 关联项目
3. 访问 Admin 后台添加 Provider Key，开始调用：

```bash
curl -X POST https://你的项目.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer YOUR_RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-5.4", "messages": [{"role": "user", "content": "你好！"}]}'
```

<details>
<summary><strong>☁️ 部署到 Cloudflare Pages</strong></summary>

**前置条件：** [Cloudflare 账号](https://dash.cloudflare.com/sign-up)（免费）+ GitHub 仓库

> ⚠️ 必须先配置 GitHub Secrets，否则部署会失败。

**第 1 步 — Fork 仓库并配置 GitHub Secrets**

在仓库 **Settings → Secrets and variables → Actions → Repository secrets** 中添加：

| Secret | 说明 | 必填 |
|--------|------|------|
| `CLOUDFLARE_API_TOKEN` | CF API Token（Pages:Edit + D1:Edit + KV:Edit） | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | CF 账号 ID | ✅ |
| `RELAY_API_KEY` | 客户端鉴权密钥 | ✅ |
| `RELAY_ADMIN_KEY` | Admin 登录密钥（可选，默认同上） | ⬜ |
| `RELAY_SIGNING_SECRET` | 临时 Key 签名密钥（可选，默认同上） | ⬜ |

<details>
<summary>如何获取 Cloudflare API Token</summary>

1. 访问 [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 **Create Token** → **Create Custom Token**
3. 权限设置：Account → Cloudflare Pages / D1 / Workers KV Storage → Edit
4. 复制 Token

</details>

**第 2 步 — 推送触发部署**

推送到 `main` 分支，GitHub Actions 自动完成：D1 建表 → KV 创建 → 构建部署 → 环境变量配置。

**第 3 步 — 验证**

```bash
curl https://你的项目.pages.dev/health
# → {"status":"ok"}
```

> **存储说明：** CF 部署使用 D1（用量统计）+ KV（配置数据），免费层可支撑 3-5 万次请求/天。

</details>

<details>
<summary><strong>🖥️ VPS 自托管部署（Node.js）</strong></summary>

AI Relay 可以通过现有 Next.js 运行时部署到 Linux VPS，作为长期在线服务运行。如果你希望获得更稳定的资源分配、长期可用的 API 端点、完整的主机级监控，以及不受 Serverless 单次执行窗口约束的运行环境，**VPS 是更适合的自托管方案**。实际吞吐和延迟仍取决于服务器配置、网络与上游 Provider。

```bash
git clone https://github.com/MoyuFamily/ai-relay.git
cd ai-relay
pnpm install
cp .env.local.example .env.local
# 配置强随机 RELAY_API_KEY、RELAY_ADMIN_KEY、
# Provider 密钥及当前运行环境所需的存储后端凭据。
pnpm build
pnpm exec next start --hostname 127.0.0.1 --port 3000
```

建议通过 HTTPS 反向代理提供服务，限制管理后台访问，并自行配置进程守护、备份和日志轮转。不要将 3000 端口直接暴露到公网。

> **当前实现边界：** VPS 已可通过现有 Next.js 应用运行时自托管，但独立 Server Runtime、Docker 镜像与完整的 PostgreSQL ConfigStore 仍在开发中。当前 PostgreSQL ConfigStore 不能直接代替既有 KV 配置路径。生产环境部署前请参考[存储架构说明](docs/storage-architecture.md)，确认所选功能的存储后端已正确配置并实际验证。

</details>

<details>
<summary><strong>💻 本地运行（CLI）</strong></summary>

除了云端部署，AI Relay 提供本地 CLI 工具，在开发机上运行轻量 Relay 服务器，不消耗云端额度。

> 📖 完整文档：[CLI_GUIDE.md](CLI_GUIDE.md)

```bash
# 1. 克隆并安装
git clone https://github.com/MoyuFamily/ai-relay.git && cd ai-relay && pnpm install

# 2. 全局安装 CLI
npm link

# 3. 启动（支持 4 种配置方式）
airelay local:start                              # 本地配置文件
airelay local:start --config ./relay-config.json  # 指定配置文件
export OPENAI_KEYS="sk-xxx" && airelay local:start  # 环境变量
airelay login https://你的项目.vercel.app && airelay local:start  # 云端同步
```

**适用场景：** 本地开发调试 · 内网环境 · 临时测试 Provider · CI/CD 集成测试

</details>

<details>
<summary><strong>🔧 本地开发（Web 应用）</strong></summary>

```bash
git clone https://github.com/MoyuFamily/ai-relay.git && cd ai-relay
npm install
cp .env.local.example .env.local
# 编辑 .env.local 填入 API Keys
npm run dev  # http://localhost:3000
```

</details>


## ✨ 核心能力

**路由与容灾**
| 特性 | 说明 |
|------|------|
| 多 Provider 路由 | OpenAI · Claude · DeepSeek · MiMo · 自定义，统一端点接入 |
| 多 Key 轮换 | Round-Robin + 429 自动退避，单 Key 故障不影响服务 |
| 多级 Fallback | Provider → Key 链式故障转移，可配置恢复策略 |
| 熔断器 | Provider 连续故障时自动摘除，恢复后自动加回 |
| 智能路由 | 延迟优先 / 成本优先 / 可用性优先，自动选择最优 Provider |

**协议与兼容**
| 特性 | 说明 |
|------|------|
| OpenAI 兼容 | `/v1/chat/completions` · `/v1/responses` · 流式 SSE，直接用 OpenAI SDK |
| Anthropic 原生 | `/v1/messages` 端点，Claude 客户端直连无需转换 |
| 虚拟模型映射 | 将虚拟模型名路由到真实 Provider，按需切换底层模型 |

**管理与监控**
| 特性 | 说明 |
|------|------|
| Admin 后台 | Web 管理界面，密钥管理、配额配置、用量统计、模型测试 |
| Provider 引导 | 三步式创建：选模板 → 配密钥 → 测试保存 |
| 模型别名 | CSV 批量导入导出、内联编辑、模型可见性控制 |
| 请求日志 | 实时请求追踪，支持内存 / KV / Postgres 多后端 |

**安全与通知**
| 特性 | 说明 |
|------|------|
| 临时 API Key | HMAC-SHA256 无状态签名，自动过期，适合 CI/CD |
| Key 安全管理 | 遮掩展示、健康监控、轮换告警、审计日志 |
| Webhook 通知 | 企微 / 飞书 / 钉钉 / Slack，日报 + 超限告警 |

**部署与运维**
| 特性 | 说明 |
|------|------|
| 零服务器 | Vercel Edge Runtime / Cloudflare Workers，全球分发 < 50ms |
| 双平台 | Vercel 一键部署；Cloudflare 通过 GitHub Actions 推送即部署 |
| 本地 CLI | `airelay local:start` 本地运行，云端配置同步，不消耗服务器额度 |
| 用量采样 | 可配置采样率，高并发场景降低 KV 写入压力 |

## 🏗️ 架构

```
                  ┌─────────────────────────────────────────┐
                  │           AI Relay Gateway               │
                  ├─────────────────────────────────────────┤
  Client ────────▶│  Edge Runtime                           │
  (OpenAI SDK)    │    ├─ 熔断器 + Fallback 链               │
                  │    ├─ Key 轮换 (Round-Robin + 429 退避)  │
                  │    ├─ 智能路由 (延迟/成本/可用性)          │
                  │    └─ 协议转换 (OpenAI ↔ Anthropic)      │
                  ├──────────┬──────────┬───────────────────┤
                  │  Vercel  │   CF     │  本地 CLI          │
                  │  Edge    │  Workers │  (airelay start)   │
                  │  + Redis │  + D1+KV │  + SQLite/KV      │
                  └──────────┴──────────┴───────────────────┘
                    ▼           ▼           ▼
                  OpenAI    Claude    DeepSeek    自定义 ...
```

## 📖 使用方法

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_RELAY_API_KEY",
    base_url="https://你的项目.vercel.app/v1"
)

# 普通调用
response = client.chat.completions.create(
    model="gpt-5.4",
    messages=[{"role": "user", "content": "你好！"}]
)

# 流式调用
stream = client.chat.completions.create(
    model="gpt-5.4",
    messages=[{"role": "user", "content": "讲个故事"}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### Claude / Anthropic Messages API

```bash
curl -X POST https://你的项目.vercel.app/v1/messages \
  -H "x-api-key: YOUR_RELAY_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好！"}]
  }'
```

### Responses API

```bash
curl -X POST https://你的项目.vercel.app/v1/responses \
  -H "Authorization: Bearer YOUR_R...KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-5.4", "input": "你好！", "stream": true}'
```

> Responses API 目前仅支持 OpenAI 格式的 Provider。


## 🏁 同类项目对比

| | AI Relay | OneAPI / new-api | FastGPT | OpenRouter |
|---|---|---|---|---|
| **部署方式** | 一键部署（Vercel / CF / 本地 CLI） | 自托管（Docker） | 自托管（Docker） | 纯 SaaS |
| **服务器成本** | **零**（免费层可跑） | 需要服务器 | 需要服务器 | 按量付费 |
| **核心差异** | Edge 低延迟 + 熔断器 + 本地 CLI | 多 Key 管理 | 知识库 + API | API 市场 |

**选 AI Relay 的理由：** 想要自己可控的 AI API 网关，但不想买服务器、维护 Docker？AI Relay 是更轻的路线 — 无服务器、双平台、2 分钟部署、多 Provider 故障转移、本地 CLI 进阶。

## 🔧 配置参考

### 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `RELAY_API_KEY` | 客户端鉴权密钥（逗号分隔支持多个） | ✅ |
| `RELAY_ADMIN_KEY` | Admin 登录密钥（未设置则回退到 `RELAY_API_KEY`） | ⬜ |
| `RELAY_SIGNING_SECRET` | 临时 Key 签名密钥 | ⬜ |
| `OPENAI_KEYS` | OpenAI API Keys | ⬜ |
| `CLAUDE_KEYS` | Anthropic API Keys | ⬜ |
| `DEEPSEEK_KEYS` | DeepSeek API Keys | ⬜ |
| `RELAY_UPSTREAM_TIMEOUT_MS` | 上游超时（默认 50000，设 0 关闭） | ⬜ |
| `RELAY_KV_USAGE_SAMPLE_RATE` | 用量采样率（默认 1，0.1 = 10% 采样） | ⬜ |

> Provider 密钥建议通过 Admin 后台配置（存储在 Redis 中），而非写入环境变量。

### 支持的 Provider

| Provider | 模型示例 | 状态 |
|----------|---------|------|
| OpenAI | gpt-5.4, gpt-5.4-mini | ✅ 内置 |
| Anthropic (Claude) | claude-sonnet-4-6, claude-opus-4-7 | ✅ 内置 |
| DeepSeek | deepseek-v4-flash, deepseek-v4-pro | ✅ 内置 |
| MiMo | mimo-v2.5, mimo-v2.5-pro | ✅ 内置 |
| 自定义 | 任意 OpenAI 兼容 API | ✅ 可配置 |

## 📊 Admin 后台

访问 `/admin` 用 `RELAY_ADMIN_KEY` 登录，支持：

- **Provider Keys** — 密钥管理 + 连通性测试
- **路由策略** — 优先级规则 + Fallback Chain，拖拽排序
- **用量监控** — 日期筛选、Provider 维度、趋势图表
- **模型测试** — 测试特定模型的连通性和响应
- **通知设置** — Webhook 推送、告警阈值、日报

<details>
<summary>查看截图</summary>

![运行概览](docs/assets/screenshots/admin-overview.png)
![密钥管理](docs/assets/screenshots/admin-keys.png)
![辅助工具](docs/assets/screenshots/admin-tools.png)

</details>

## 🎯 典型场景

- **多 Key 整合** — 把散落的 OpenAI / Claude / DeepSeek Key 统一管理，一个端点对外
- **Agent / IDE 集成** — Codex、Claude Code、Cursor 等工具接入本地 Relay，低延迟不占云端额度
- **团队共享** — 共享中转实例，配额管理，Admin 可见性
- **CI/CD 集成** — HMAC 临时密钥，自动过期无需清理
- **成本优化** — 按模型/任务路由到不同 Provider，虚拟模型映射

## 🌐 开源社区基础设施（规划中）

AI Relay 是采用 [MIT 许可证](LICENSE) 的开源项目。除了 Serverless 和 VPS 自托管部署，我们计划建设一个**非商业、长期在线的兼容性与可靠性测试环境**，方便贡献者跨运行时复现问题、验证改动。

计划中的 Linux 社区基础设施主要用于：

- **API 协议兼容性测试**：使用模拟 Provider 或明确授权的测试服务，验证 OpenAI 兼容接口、流式 SSE、模型路由与 fallback。
- **可靠性与性能测试**：以可控工作负载复现超时、错误响应和并发场景，并公开可复现的测试结果。
- **安全的公开演示**：使用模拟密钥与脱敏数据展示功能，不收集访问者的个人 Provider API Key。
- **开源贡献验证**：运行回归测试，为 Issue 和 PR 提供可追溯的诊断数据。

**当前状态：规划中，尚未宣称公开演示服务已上线。** VPS 可以提供常驻进程、相对稳定的测试资源和主机级指标，补充 Serverless 临时执行环境的局限。相关赞助资源将专用于非商业开源开发与教育用途，不用于付费 API 转售或无关服务。

欢迎为这项工作提供基础设施赞助。确认赞助后，我们可在 README 和项目文档中公开致谢。

## 📢 通知与告警

支持企微 / 飞书 / 钉钉 / Slack / 通用 Webhook。

- **每日报告** — Cron 定时发送，含当日总量、Provider 分项、前日对比
- **超限告警** — 按 Provider 或全局设置请求量 / Token 量阈值

配置：Admin 后台 → 通知设置 → 添加 Webhook → 启用

## 🤝 贡献指南

1. Fork → 创建特性分支 → 提交 → 推送 → 提 Pull Request

维护者发布流程见 [Release Flow](docs/RELEASE-FLOW.md)：常规变更先合入 `pre-release`，验证后再发布到 `main`。

## 🙏 致谢

- [OpenRouter](https://openrouter.ai) · [OneAPI](https://github.com/songquanpeng/one-api) · [new-api](https://github.com/Calcium-Ion/new-api) · [FastGPT](https://github.com/labring/FastGPT)
- [Vercel](https://vercel.com) · [OpenAI](https://platform.openai.com) · [Linux Do](https://linux.do/)

## ❓ 常见问题

查看 [FAQ 文档](docs/FAQ.md)，包含部署、配置、本地 Relay 等常见问题。

## 📝 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

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
