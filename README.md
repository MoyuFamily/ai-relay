<div align="center">

<img src="docs/assets/logo-banner.svg" alt="AI Relay" width="400">

**Open-source AI API gateway — deploy on your VPS, Vercel, Cloudflare, or locally**

<p>
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/MoyuFamily/ai-relay&env=RELAY_API_KEY,RELAY_ADMIN_KEY,RELAY_SIGNING_SECRET&envDescription=API%20authentication%20keys%20(required%20for%20security)&envLink=https://github.com/MoyuFamily/ai-relay#-quick-start">
    <img src="https://vercel.com/button" alt="Deploy with Vercel" height="36">
  </a>
  &nbsp;
  <a href="#-deploy-to-cloudflare-pages">
    <img src="https://img.shields.io/badge/⚡_Deploy_to_Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Deploy to Cloudflare" height="36">
  </a>
  &nbsp;
  <a href="#-run-locally-cli">
    <img src="https://img.shields.io/badge/💻_Run_Locally-000?style=for-the-badge&logo=terminal&logoColor=white" alt="Run locally" height="36">
  </a>
</p>

[![Version](https://img.shields.io/badge/Version-2.13.0-green.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · [中文](README_CN.md)

</div>

---

> **One gateway for all your AI APIs.**
>
> Unify OpenAI, Claude, DeepSeek and more behind a single endpoint.
> Automatic key rotation, failover, and circuit breaking — no glue code needed.
>
> **Deployment options — from zero-ops to fully self-hosted:**
> - 🖥️ **VPS / self-hosted** — dedicated resources, an always-on endpoint, operational control, and room for sustained workloads
> - ☁️ **Vercel / Cloudflare** — quick serverless setup, no VPS maintenance
> - 💻 **Local CLI** — `airelay local:start`, private localhost relay with local usage records
> - 🔧 **Development** — `npm run dev`, edit and iterate

### Who should use which?

| | 🖥️ VPS / Self-hosted | ☁️ Vercel | ☁️ Cloudflare | 💻 Local CLI |
|---|---|---|---|---|
| **Best for** | Sustained traffic, shared endpoints, long-running integrations, control over resources | Quick trials and lightweight apps | Globally distributed serverless traffic | Private development and local agents |
| **Runtime** | Always-on Node.js application, no serverless execution window | Serverless functions | Edge workers | Persistent local process |
| **Operations** | You manage Linux, updates, HTTPS and backups | Managed platform | Managed platform | You manage the local process |
| **Observability** | Host-level metrics and logs; persistent request logs with a configured backend | Platform logs; usage sampling | Platform logs; usage sampling | SQLite request/usage records |
| **Storage** | Configure a supported backing store; standalone PostgreSQL config integration is still in progress | Upstash Redis (KV) | Cloudflare D1 + KV | Local SQLite |
| **Trade-off** | Best infrastructure control, but requires a maintained server | Hosting quotas and runtime limits | Edge resource and runtime limits | Endpoint availability depends on your device |

> **⚠️ Vercel Hobby usage guidance:**
> - **Good fit**: Personal chat, light API relay, dev/debugging phase
> - **Not ideal**: High-frequency coding calls (e.g. Copilot/Cursor continuous use), large image/video multimodal, long reasoning tasks
> - Free-tier storage and traffic are limited; the project provides usage sampling and multi-key rotation settings to help — all adjustable from the admin dashboard
>
> For sustained traffic, shared access, and long-running streaming, a VPS offers the most infrastructure control. Cloudflare is a convenient managed option for frequent requests; Local CLI is ideal for private agent workflows.

> **TL;DR:** Start on Vercel, use Cloudflare for managed edge deployment, choose a VPS for a persistent self-hosted service, or run locally for private agents. The gateway API stays consistent; storage and operational setup vary by runtime.

## 🎯 Why AI Relay?

| | |
|---|---|
| **Choice of infrastructure** | Deploy serverless on Vercel/Cloudflare, run a persistent service on your VPS, or use Local CLI |
| **Zero cost to start** | Runs on free tiers — personal devs pay nothing |
| **One endpoint, drop-in** | Compatible with OpenAI SDK — just change `base_url`, zero code changes |
| **Multi-key, multi-provider** | Automatic rotation, failover, circuit breaking — built-in resilience |
| **Best control on VPS** | Manage CPU, memory, network, uptime and host-level observability for sustained workloads; requires server administration |

## 🚀 Quick Start

### ☁️ Deploy to Vercel (recommended for new users)

> Prerequisites: [Vercel account](https://vercel.com/signup) (free) + at least one AI provider API key

1. Click **Deploy with Vercel** above, fill in 3 environment variables:

| Variable | Description |
|----------|-------------|
| `RELAY_API_KEY` | Client authentication key (use a strong password) |
| `RELAY_ADMIN_KEY` | Admin dashboard login key (can be same as above) |
| `RELAY_SIGNING_SECRET` | Temp key signing secret (can be same as above) |

2. After deploy, go to Vercel Dashboard → **Storage** → Create **Upstash for Redis** (Free tier) → Connect to project
3. Access the Admin dashboard to add Provider keys, then start calling:

```bash
curl -X POST https://your-project.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer YOUR_R...KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-5.4", "messages": [{"role": "user", "content": "Hello!"}]}'
```

<details>
<summary><strong>☁️ Deploy to Cloudflare Pages</strong></summary>

**Prerequisites:** [Cloudflare account](https://dash.cloudflare.com/sign-up) (free) + GitHub repo

> ⚠️ You must configure GitHub Secrets first, or the deploy will fail.

**Step 1 — Fork and configure GitHub Secrets**

Go to **Settings → Secrets and variables → Actions → Repository secrets** and add:

| Secret | Description | Required |
|--------|-------------|----------|
| `CLOUDFLARE_API_TOKEN` | CF API Token (Pages:Edit + D1:Edit + KV:Edit) | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | CF Account ID | ✅ |
| `RELAY_API_KEY` | Client auth key | ✅ |
| `RELAY_ADMIN_KEY` | Admin login key (optional, defaults to API key) | ⬜ |
| `RELAY_SIGNING_SECRET` | Temp key signing secret (optional) | ⬜ |

<details>
<summary>How to get a Cloudflare API Token</summary>

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens)
2. Click **Create Token** → **Create Custom Token**
3. Permissions: Account → Cloudflare Pages / D1 / Workers KV Storage → Edit
4. Copy the token

</details>

**Step 2 — Push to deploy**

Push to `main` — GitHub Actions auto-handles: D1 setup → KV creation → build → deploy → env config.

**Step 3 — Verify**

```bash
curl https://your-project.pages.dev/health
# → {"status":"ok"}
```

> **Storage:** CF uses D1 (usage stats) + KV (config). Free tier supports ~30-50K requests/day.

</details>

<details>
<summary><strong>🖥️ Deploy on a VPS (self-hosted Node.js)</strong></summary>

AI Relay can run as a long-lived Next.js application on a Linux VPS. This is the preferred **self-managed** route when you need predictable resource allocation, a stable endpoint, host-level monitoring, or workloads that should not depend on serverless execution windows. Actual throughput and latency depend on your VPS and upstream providers.

```bash
git clone https://github.com/MoyuFamily/ai-relay.git
cd ai-relay
pnpm install
cp .env.local.example .env.local
# Set strong RELAY_API_KEY and RELAY_ADMIN_KEY values,
# provider keys, and any backing-store credentials required by your setup.
pnpm build
pnpm exec next start --hostname 127.0.0.1 --port 3000
```

Place the service behind an HTTPS reverse proxy, restrict admin access, and arrange your own process supervisor, backups and log rotation. Do not expose port 3000 directly to the public internet.

> **Current implementation boundary:** VPS-hosted Node.js execution is available through the existing app runtime, but the separate all-in-one Server Runtime / Docker image and full standalone PostgreSQL ConfigStore are still being developed. The PostgreSQL ConfigStore is not yet a drop-in replacement for the configured KV-backed paths. Review [storage architecture](docs/storage-architecture.md) and validate your chosen persistence configuration before a production deployment.

</details>

<details>
<summary><strong>💻 Run Locally (CLI)</strong></summary>

Beyond cloud deploy, AI Relay provides a local CLI to run a lightweight relay on your machine — no cloud quota consumed.

> 📖 Full docs: [CLI_GUIDE.md](CLI_GUIDE.md)

```bash
# 1. Clone and install
git clone https://github.com/MoyuFamily/ai-relay.git && cd ai-relay && pnpm install

# 2. Install CLI globally
npm link

# 3. Start (4 config options supported)
airelay local:start                              # local config file
airelay local:start --config ./relay-config.json  # specify config file
export OPENAI_KEYS="sk-xxx" && airelay local:start  # environment variables
airelay login https://your-project.vercel.app && airelay local:start  # sync from cloud
```

**Use cases:** Local dev/debug · Intranet environments · Quick provider testing · CI/CD integration

</details>

<details>
<summary><strong>🔧 Local Development (Web App)</strong></summary>

```bash
git clone https://github.com/MoyuFamily/ai-relay.git && cd ai-relay
npm install
cp .env.local.example .env.local
# Edit .env.local with your API keys
npm run dev  # http://localhost:3000
```

</details>

## ✨ Core Capabilities

**Routing & Resilience**
| Feature | Description |
|---------|-------------|
| Multi-provider routing | OpenAI · Claude · DeepSeek · MiMo · Custom — single endpoint |
| Multi-key rotation | Round-robin + 429 auto-backoff, single key failure doesn't affect service |
| Multi-level fallback | Provider → Key chain failover with configurable recovery |
| Circuit breaker | Auto-remove failing providers, auto-restore when recovered |
| Smart routing | Latency / cost / availability priority, auto-select optimal provider |

**Protocol & Compatibility**
| Feature | Description |
|---------|-------------|
| OpenAI compatible | `/v1/chat/completions` · `/v1/responses` · SSE streaming — use OpenAI SDK directly |
| Anthropic native | `/v1/messages` endpoint — Claude clients connect without conversion |
| Virtual model mapping | Route virtual model names to real providers, swap underlying models on demand |

**Management & Monitoring**
| Feature | Description |
|---------|-------------|
| Admin dashboard | Web UI for key management, quota config, usage stats, model testing |
| Provider wizard | 3-step creation: pick template → add key → test & save |
| Model aliases | CSV import/export, inline edit, model visibility control |
| Request logs | Real-time request tracing with memory / KV / Postgres backends |

**Security & Notifications**
| Feature | Description |
|---------|-------------|
| Temp API keys | HMAC-SHA256 stateless signing, auto-expiring — perfect for CI/CD |
| Key security | Masked display, health monitoring, rotation alerts, audit logs |
| Webhook alerts | WeCom / Feishu / DingTalk / Slack — daily reports + threshold alerts |

**Deployment & Ops**
| Feature | Description |
|---------|-------------|
| Zero servers | Vercel Edge Runtime / Cloudflare Workers — global edge, < 50ms latency |
| Dual platform | Vercel one-click; Cloudflare via GitHub Actions push-to-deploy |
| Local CLI | `airelay local:start` — same config, same API, no cloud quota used |
| Usage sampling | Configurable sample rate for high-concurrency scenarios |

## 🏗️ Architecture

```
                  ┌─────────────────────────────────────────┐
                  │           AI Relay Gateway               │
                  ├─────────────────────────────────────────┤
  Client ────────▶│  Edge Runtime                           │
  (OpenAI SDK)    │    ├─ Circuit breaker + Fallback chain  │
                  │    ├─ Key rotation (Round-robin + 429)  │
                  │    ├─ Smart routing (latency/cost/avail)│
                  │    └─ Protocol bridge (OpenAI ↔ Anthropic)│
                  ├──────────┬──────────┬───────────────────┤
                  │  Vercel  │   CF     │  Local CLI         │
                  │  Edge    │  Workers │  (airelay start)   │
                  │  + Redis │  + D1+KV │  + SQLite/KV      │
                  └──────────┴──────────┴───────────────────┘
                    ▼           ▼           ▼
                  OpenAI    Claude    DeepSeek    Custom ...
```

## 📖 Usage

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_RELAY_API_KEY",
    base_url="https://your-project.vercel.app/v1"
)

# Standard call
response = client.chat.completions.create(
    model="gpt-5.4",
    messages=[{"role": "user", "content": "Hello!"}]
)

# Streaming
stream = client.chat.completions.create(
    model="gpt-5.4",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### Claude / Anthropic Messages API

```bash
curl -X POST https://your-project.vercel.app/v1/messages \
  -H "x-api-key: YOUR_RELAY_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Responses API

```bash
curl -X POST https://your-project.vercel.app/v1/responses \
  -H "Authorization: Bearer YOUR_R...KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-5.4", "input": "Hello!", "stream": true}'
```

> Responses API currently only supports OpenAI-format providers.

## 🏁 Comparison

| | AI Relay | OneAPI / new-api | FastGPT | OpenRouter |
|---|---|---|---|---|
| **Deploy** | One-click (Vercel / CF / Local CLI) | Self-hosted (Docker) | Self-hosted (Docker) | SaaS only |
| **Server cost** | **Zero** (free tier works) | Needs server | Needs server | Pay per use |
| **Key differentiator** | Edge latency + circuit breaker + local CLI | Multi-key mgmt | Knowledge base + API | API marketplace |

**Choose AI Relay when:** You want a self-controlled AI API gateway without servers, Docker, or ops overhead.

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `RELAY_API_KEY` | Client auth key (comma-separated for multiple) | ✅ |
| `RELAY_ADMIN_KEY` | Admin login key (falls back to `RELAY_API_KEY`) | ⬜ |
| `RELAY_SIGNING_SECRET` | Temp key signing secret | ⬜ |
| `OPENAI_KEYS` | OpenAI API Keys | ⬜ |
| `CLAUDE_KEYS` | Anthropic API Keys | ⬜ |
| `DEEPSEEK_KEYS` | DeepSeek API Keys | ⬜ |
| `RELAY_UPSTREAM_TIMEOUT_MS` | Upstream timeout (default 50000, 0 to disable) | ⬜ |
| `RELAY_KV_USAGE_SAMPLE_RATE` | Usage sampling rate (default 1, 0.1 = 10% sample) | ⬜ |

> Provider keys are recommended to be configured via Admin dashboard (stored in Redis), not environment variables.

### Supported Providers

| Provider | Example Models | Status |
|----------|---------------|--------|
| OpenAI | gpt-5.4, gpt-5.4-mini | ✅ Built-in |
| Anthropic (Claude) | claude-sonnet-4-6, claude-opus-4-7 | ✅ Built-in |
| DeepSeek | deepseek-v4-flash, deepseek-v4-pro | ✅ Built-in |
| MiMo | mimo-v2.5, mimo-v2.5-pro | ✅ Built-in |
| Custom | Any OpenAI-compatible API | ✅ Configurable |

## 📊 Admin Dashboard

Access `/admin` with `RELAY_ADMIN_KEY`:

- **Provider Keys** — Key management + connectivity testing
- **Routing Policy** — Priority rules + Fallback Chain, drag-to-reorder
- **Usage Monitor** — Date range, provider filter, trend charts
- **Model Testing** — Test specific model connectivity and responses
- **Notifications** — Webhook push, alert thresholds, daily reports

<details>
<summary>View screenshots</summary>

![Overview](docs/assets/screenshots/admin-overview.png)
![Key Management](docs/assets/screenshots/admin-keys.png)
![Tools](docs/assets/screenshots/admin-tools.png)

</details>

## 🎯 Use Cases

- **Multi-key consolidation** — Unify scattered OpenAI / Claude / DeepSeek keys behind one endpoint
- **Agent / IDE integration** — Codex, Claude Code, Cursor → local relay, low latency, no cloud quota
- **Team sharing** — Shared relay instance, quota management, admin visibility
- **CI/CD integration** — HMAC temp keys, auto-expiring, no cleanup needed
- **Cost optimization** — Route by model/task to different providers, virtual model mapping

## 🌐 Community Infrastructure (Planned)

AI Relay is an [MIT-licensed](LICENSE), community-accessible open-source project. Alongside its serverless and self-hosted deployment options, we are planning a **non-commercial, always-on compatibility and reliability test environment** to help contributors reproduce issues across runtimes.

The proposed Linux-based community infrastructure would provide:

- **Protocol compatibility checks** — exercise OpenAI-compatible endpoints, streaming/SSE behavior, model routing and fallback using mock or explicitly authorized test providers.
- **Reliability and performance tests** — reproduce timeouts, error responses and concurrency scenarios with controlled workloads and published, reproducible findings.
- **Safe public demonstrations** — demonstrate API behavior with simulated credentials and sanitized example data; no collection of visitors' personal provider keys.
- **Contributor verification** — run regression tests and keep diagnostic artifacts available for issue reports and pull requests.

**Status: planned, not a currently operating public service.** A VPS would provide persistent processes, predictable test resources and host-level metrics that are harder to maintain consistently across ephemeral serverless runs. Infrastructure granted for this purpose would be used for non-commercial open-source development and education, not API resale or unrelated services.

We welcome infrastructure sponsorship for this effort. Sponsors providing the environment may be acknowledged here and in project documentation once support is confirmed.

## 📢 Notifications & Alerts

Supports WeCom / Feishu / DingTalk / Slack / Generic Webhook.

- **Daily reports** — Cron-scheduled with daily totals, per-provider breakdown, day-over-day comparison
- **Threshold alerts** — Per-provider or global request/token volume thresholds

Configure: Admin → Notification Settings → Add Webhook → Enable

## 🤝 Contributing

1. Fork → Create branch → Commit → Push → Open Pull Request

See [Release Flow](docs/RELEASE-FLOW.md): changes merge to `pre-release` first, then `main` after verification.

## 🙏 Acknowledgments

- [OpenRouter](https://openrouter.ai) · [OneAPI](https://github.com/songquanpeng/one-api) · [new-api](https://github.com/Calcium-Ion/new-api) · [FastGPT](https://github.com/labring/FastGPT)
- [Vercel](https://vercel.com) · [OpenAI](https://platform.openai.com) · [Linux Do](https://linux.do/)

## ❓ FAQ

See [FAQ](docs/FAQ.md) for deployment, configuration, and local relay issues.

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md).

## 📄 License

MIT — [LICENSE](LICENSE)

## 👥 Team

| | Name | Role |
|---|---|---|
| <img src="https://avatars.githubusercontent.com/u/7930911?v=4" width="28" height="28" style="border-radius:50%"> | Parsifal | Founder & Project Lead |
| <img src="https://avatars.githubusercontent.com/u/286714101?v=4" width="28" height="28" style="border-radius:50%"> | 小赫 (Xiaohe) | Coordinator |
| <img src="https://avatars.githubusercontent.com/u/286719582?v=4" width="28" height="28" style="border-radius:50%"> | 像素姐 (Pixel) | Design Director |
| <img src="https://avatars.githubusercontent.com/u/286715358?v=4" width="28" height="28" style="border-radius:50%"> | 码飞 (Mafei) | Tech Director |
| <img src="https://avatars.githubusercontent.com/u/286716759?v=4" width="28" height="28" style="border-radius:50%"> | 饼哥 (Bingge) | Product Director |
