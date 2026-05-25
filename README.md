<div align="center">

<img src="docs/assets/logo-banner.svg" alt="AI Relay" width="400">

**无服务器 AI API 中转网关：一键部署到 Vercel，2 分钟拥有自己的多 Provider AI Relay**

<h3>🚀 <a href="https://vercel.com/new/clone?repository-url=https://github.com/MoyuFamily/ai-relay&env=RELAY_API_KEY,RELAY_ADMIN_KEY,RELAY_SIGNING_SECRET&envDescription=API%20authentication%20keys%20(required%20for%20security)&envLink=https://github.com/MoyuFamily/ai-relay#environment-variables">一键部署到 Vercel，2 分钟上线你的 AI API 网关</a></h3>

<p>不用买服务器，不用维护 Docker，只需填写 3 个环境变量，即可拥有自己的多 Provider AI Relay。</p>

<p>
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/MoyuFamily/ai-relay&env=RELAY_API_KEY,RELAY_ADMIN_KEY,RELAY_SIGNING_SECRET&envDescription=API%20authentication%20keys%20(required%20for%20security)&envLink=https://github.com/MoyuFamily/ai-relay#environment-variables">
    <img src="https://vercel.com/button" alt="Deploy with Vercel" height="42">
  </a>
</p>

<p><strong><a href="https://vercel.com/new/clone?repository-url=https://github.com/MoyuFamily/ai-relay&env=RELAY_API_KEY,RELAY_ADMIN_KEY,RELAY_SIGNING_SECRET&envDescription=API%20authentication%20keys%20(required%20for%20security)&envLink=https://github.com/MoyuFamily/ai-relay#environment-variables">👉 立即一键部署</a></strong> · <a href="#-一键部署2-分钟上线你的-ai-api-网关">查看部署步骤</a></p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![Edge Runtime](https://img.shields.io/badge/Edge_Runtime-⚡-black?logo=vercel)](https://vercel.com/docs/functions/edge-functions)
[![Vercel KV](https://img.shields.io/badge/Vercel_KV-Redis-black?logo=redis)](https://vercel.com/docs/storage/vercel-kv)

[English](README_EN.md) · [中文](README.md)

</div>

---

> 🚀 **不用买服务器，不用写后端，不用维护 Docker。**
>
> AI Relay 基于 Vercel Edge Runtime 构建，点击 **Deploy with Vercel**，配置 3 个环境变量，即可获得一个支持 OpenAI / Claude / DeepSeek / 自定义 Provider 的无服务器 AI API 中转网关。

| 你关心的 | AI Relay 的答案 |
|---|---|
| **怎么部署？** | 点一下 Deploy with Vercel，填 3 个环境变量，约 2 分钟上线 |
| **要服务器吗？** | 不需要 VPS，不需要 Docker，不需要后端运维 |
| **能免费跑吗？** | 面向 Vercel Edge + KV 设计，个人 / 小团队可从免费层开始 |
| **接入复杂吗？** | OpenAI SDK 只改 `base_url`，继续使用 `/v1/chat/completions` |

## 目录

- [特性](#-特性)
- [一键部署：2 分钟上线你的 AI API 网关](#-一键部署2-分钟上线你的-ai-api-网关)
- [同类项目对比](#-同类项目对比)
- [为什么选择 AI Relay](#为什么选择-ai-relay)
- [使用方法](#-使用方法)
- [配置参考](#-配置参考)
- [架构概览](#-架构概览)
- [Admin 后台](#-admin-后台)
- [通知与告警](#-通知与告警)
- [使用场景](#-使用场景)
- [贡献指南](#-贡献指南)
- [更新日志](#-更新日志)
- [许可证](#-许可证)

## ✨ 特性

| 特性 | 说明 |
|------|------|
| **无服务器架构** | 基于 Vercel Edge Runtime，无需购买 VPS / 维护 Docker / 管理后端服务 |
| **一键部署** | 点击 Deploy with Vercel，填写 3 个环境变量，约 2 分钟上线 |
| **免费层可用** | 个人和小团队可直接使用 Vercel 免费层跑起来 |
| **OpenAI 兼容** | 直接用 OpenAI SDK 对接，零改动 |
| **多 Provider 路由** | OpenAI · Claude · DeepSeek · MiMo · 自定义 |
| **多 Key 轮换** | Round-Robin + 429 自动退避 |
| **多级 Fallback** | Provider → Key 链式故障转移 |
| **熔断器** | Provider 故障时自动切换 |
| **Admin 后台** | 密钥管理、配额配置、用量统计、模型测试 |
| **流式响应** | SSE 透传，实时输出 |
| **Webhook 通知** | 企微 / 飞书 / 钉钉 / Slack，日报 + 超限告警 |
| **临时 API Key** | HMAC-SHA256 无状态签名，自动过期 |
| **虚拟模型映射** | 将虚拟模型名路由到真实 Provider |

## 🚀 一键部署：2 分钟上线你的 AI API 网关

> **前置条件：** [Vercel 账号](https://vercel.com/signup)（免费）+ 至少一个 AI Provider 的 API Key

**第 1 步 — 部署**

点击上方 **Deploy with Vercel** 按钮，填入 3 个环境变量：

| 变量 | 说明 |
|------|------|
| `RELAY_API_KEY` | 客户端请求鉴权密钥（自定义强密码） |
| `RELAY_ADMIN_KEY` | 后台管理登录密钥（可同上） |
| `RELAY_SIGNING_SECRET` | 临时 Key 签名密钥（可同上） |

点击 **Deploy**，等待部署完成。

**第 2 步 — 验证**

```bash
curl https://你的项目.vercel.app/health
# → {"status":"ok"}
```

**第 3 步 — 添加密钥**

1. 访问 `https://你的项目.vercel.app/admin`，用 `RELAY_ADMIN_KEY` 登录
2. 进入 **Provider Keys**，添加你的 API Key（OpenAI、Claude 等）

**第 4 步 — 开始调用**

```bash
curl -X POST https://你的项目.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer YOUR_RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "你好！"}]}'
```

🎉 **完成！** 你已经拥有一个支持多 Provider、自动故障转移的 AI API 中转服务。

<details>
<summary><strong>📦 本地开发</strong></summary>

```bash
git clone https://github.com/MoyuFamily/ai-relay.git
cd ai-relay
npm install
cp .env.local.example .env.local
# 编辑 .env.local 填入你的 API Keys
npm run dev  # http://localhost:3000
```

</details>

## 🏁 同类项目对比

| 特性 | AI Relay | OpenRouter | OneAPI / new-api | FastGPT |
|------|----------|------------|------------------|---------|
| **部署方式** | **Vercel 一键部署（Edge）** | 纯 SaaS | 自托管（Docker） | 自托管（Docker） |
| **基础设施成本** | **无需服务器，可从免费层开始** | 按量付费 | 需要服务器 | 需要服务器 |
| **冷启动** | < 50ms | N/A | 秒级 | 秒级 |
| **熔断器** | ✅ | ❌ | ❌ | ❌ |
| **Fallback 链** | ✅ 可配置 | ✅ 自动 | ✅ 基础 | ✅ 基础 |
| **并发控制** | ✅ 令牌桶 + 队列 | 限流 | ❌ | ❌ |
| **Webhook 告警** | ✅ 4 平台 | ❌ | ❌ | ✅ |
| **临时 API Key** | ✅ HMAC 签名 | ❌ | ✅ | ✅ |
| **主要场景** | 个人 / 小团队 | API 市场 | 多 Key 管理 | 知识库 + API |

**选择 AI Relay：** 当你想要“自己可控的 AI API 网关”，但不想买服务器、维护 Docker 或搭后端时，AI Relay 是更轻的路线：无服务器、2 分钟部署、多 Provider 故障转移、Edge 低延迟。

## 为什么选择 AI Relay？

- **不用服务器**：跑在 Vercel Edge Runtime，无需 VPS、Docker、运维。
- **部署足够快**：点击按钮 + 填环境变量，2 分钟完成上线。
- **成本足够低**：个人开发者和小团队可以从 Vercel 免费层开始。
- **接入足够简单**：兼容 OpenAI API，现有 SDK 只需改 `base_url`。
- **容灾足够实用**：多 Provider、多 Key、Fallback、熔断器内置。

## 📖 使用方法

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_RELAY_API_KEY",
    base_url="https://你的项目.vercel.app/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "你好！"}]
)
```

### 流式响应

```python
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "讲个故事"}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### 临时密钥

在 Admin 后台生成指定有效期的临时密钥：
- **格式：** `***${base64Payload}.${signature}`
- **校验：** Vercel Edge 服务端 HMAC-SHA256 无状态签名校验
- **场景：** CI/CD 流水线、临时授权、API 分享

## 🔧 配置参考

### 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `RELAY_API_KEY` | 客户端请求鉴权密钥（逗号分隔支持多个） | ✅ |
| `RELAY_ADMIN_KEY` | 后台管理登录密钥（未设置则回退到 `RELAY_API_KEY`） | ⬜ |
| `RELAY_SIGNING_SECRET` | 临时 Key 签名密钥（未设置则回退到管理/请求密钥） | ⬜ |
| `OPENAI_KEYS` | OpenAI API Keys（逗号分隔） | ⬜ |
| `CLAUDE_KEYS` | Anthropic API Keys | ⬜ |
| `DEEPSEEK_KEYS` | DeepSeek API Keys | ⬜ |
| `XIAOMI_KEYS` | Xiaomi API Keys | ⬜ |

> [!NOTE]
> Provider 密钥建议通过 Admin 后台配置（存储在 Vercel KV 中），而非写入环境变量。

### 支持的 Provider

| Provider | 模型示例 | 状态 |
|----------|---------|------|
| OpenAI | gpt-4o, gpt-4, gpt-3.5-turbo | ✅ 内置 |
| Anthropic (Claude) | claude-3.5-sonnet, claude-3-opus | ✅ 内置 |
| DeepSeek | deepseek-chat, deepseek-coder | ✅ 内置 |
| Xiaomi (MiMo) | mimo-7b | ✅ 内置 |
| 自定义 | 任意 OpenAI 兼容 API | ✅ 可配置 |

## 🏗️ 架构概览

```
Client → Edge Runtime (全球分发, <50ms 延迟)
              ├─ 熔断器
              ├─ 多级 Fallback (Provider → Key)
              ├─ Key 轮换 (Round-Robin + 429 退避)
              └─ Vercel KV (密钥, 配额, 用量)
```

## 📊 Admin 后台

访问 `/admin` 使用 `RELAY_ADMIN_KEY` 登录：

| 功能 | 说明 |
|------|------|
| **Provider Keys** | 管理所有 Provider 的 API 密钥，支持连通性测试 |
| **配额配置** | 为每个 Provider 设置动态配额，KV 持久化 |
| **模型测试** | 测试特定模型的连通性和响应 |
| **临时密钥** | 生成有时效的 HMAC-SHA256 签名 API 密钥 |
| **自定义 Provider** | 添加 / 编辑 / 删除自定义 Provider |
| **用量统计** | 请求次数 + Token 用量趋势图 |
| **Key Pool 状态** | 实时同步所有密钥状态 |
| **通知设置** | Webhook 推送、告警阈值、日报时间 |

> 💡 **移动端友好** — 响应式设计，手机上也能随时管理中转策略。

## 📸 截图

<details>
<summary>点击展开截图</summary>

**运行概览**

![管理后台运行概览](docs/assets/screenshots/admin-overview.png)

限额状态、今日消耗概览、Token 消耗趋势一目了然。

**密钥管理**

![管理后台密钥管理](docs/assets/screenshots/admin-keys.png)

多服务商密钥池，带状态指示和模型前缀映射。

**辅助工具**

![管理后台辅助工具](docs/assets/screenshots/admin-tools.png)

临时密钥生成和模型连通性测试。

</details>

## 📢 通知与告警

支持通过 Webhook 推送每日用量报告和超限告警。

| 平台 | 格式 |
|------|------|
| 企业微信 | Markdown |
| 飞书 | 消息卡片 |
| 钉钉 | Markdown |
| Slack | Block Kit |
| 通用 Webhook | 自定义 JSON |

**配置：** Admin 后台 → 通知设置 → 添加 Webhook → 填入 URL → 启用

**每日报告：** Vercel Cron 定时发送，包含当日总量、Provider 分项、前日对比。

**超限告警：** 支持按 Provider 或全局设置请求量 / Token 量阈值。

## 🎯 使用场景

| 场景 | 说明 |
|------|------|
| **个人开发者** | 多 Key 整合为单一端点，自动轮换 + 故障转移 |
| **小团队** | 共享中转实例，配额管理，Admin 可见性 |
| **CI/CD** | HMAC 临时密钥，自动过期无需清理 |
| **多地域应用** | Edge 全球 < 50ms，熔断防级联故障 |
| **成本优化** | 虚拟模型映射，按任务复杂度路由 Provider |
| **企业内部** | API 网关 + Webhook 告警，用量监控 |



## 👥 团队

| | 姓名 | 角色 | 贡献 | 联系 |
|---|---|---|---|---|
| <img src="https://avatars.githubusercontent.com/u/7930911?v=4" width="32" height="32" style="border-radius:50%"> | Parsifal | 创始人 & 项目负责人 | 项目发起人，负责整体架构设计、技术选型和团队管理 | zmw@izmw.me |
| <img src="https://avatars.githubusercontent.com/u/286714101?v=4" width="32" height="32" style="border-radius:50%"> | 小赫 | 协调者 | 团队任务协调、需求分析、进度跟踪和质量把控 | xiaohe@izmw.me |
| <img src="https://avatars.githubusercontent.com/u/286719582?v=4" width="32" height="32" style="border-radius:50%"> | 像素姐 | 设计总监 | 品牌视觉体系设计、Logo 设计、UI/UX 设计和 README 视觉收尾 | pixiel@izmw.me |
| <img src="https://avatars.githubusercontent.com/u/286715358?v=4" width="32" height="32" style="border-radius:50%"> | 码飞 | 技术总监 | 全栈架构开发、CI/CD 流水线建设、系统性能优化和技术选型评估 | mafei@izmw.me |
| <img src="https://avatars.githubusercontent.com/u/286716759?v=4" width="32" height="32" style="border-radius:50%"> | 饼哥 | 产品总监 | 产品规划、需求分析、用户体验设计和迭代策略 | bingge@izmw.me |

## 🤝 贡献指南

欢迎贡献！请随时提交 Pull Request。

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 提交 Pull Request

## 🙏 致谢

- [OpenRouter](https://openrouter.ai) — 多 Provider API 聚合模式先驱
- [OneAPI](https://github.com/songquanpeng/one-api) / [new-api](https://github.com/Calcium-Ion/new-api) — 最流行的开源 API 管理系统
- [FastGPT](https://github.com/labring/FastGPT) — API 中转与知识库工作流整合
- [Vercel](https://vercel.com) — Edge Runtime + KV 存储
- [OpenAI](https://platform.openai.com) — OpenAI 兼容 API 标准
- [Linux Do](https://linux.do/) — 温暖的开发者社区，AI Relay 的灵感来源

## 📝 更新日志

项目版本变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 📄 许可证

本项目基于 MIT 许可证 — 详见 [LICENSE](LICENSE) 文件。
