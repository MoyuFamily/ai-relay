<div align="center">

<img src="docs/assets/logo-banner.svg" alt="AI Relay" width="400">

**Your personal & team AI API gateway — deploy serverless, self-host with Docker, or run locally**

<p>
  <a href="https://vercel.com/new/clone?repository-url=https://github.com/MoyuFamily/ai-relay&env=RELAY_API_KEY,RELAY_ADMIN_KEY,RELAY_SIGNING_SECRET&envDescription=API%20authentication%20keys%20(required%20for%20security)&envLink=https://github.com/MoyuFamily/ai-relay#-quick-start">
    <img src="https://vercel.com/button" alt="Deploy with Vercel" height="36">
  </a>
  &nbsp;
  <a href="#deploy-cloudflare">
    <img src="https://img.shields.io/badge/⚡_Deploy_to_Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Deploy to Cloudflare" height="36">
  </a>
  &nbsp;
  <a href="#deploy-self-hosted">
    <img src="https://img.shields.io/badge/🐳_Self--Host_(Docker)-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Self-Host with Docker" height="36">
  </a>
  &nbsp;
  <a href="#deploy-local-cli">
    <img src="https://img.shields.io/badge/💻_Run_Locally_(CLI)-000?style=for-the-badge&logo=terminal&logoColor=white" alt="Run locally" height="36">
  </a>
</p>

[![Version](https://img.shields.io/badge/Version-2.15.0-green.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[English](README.md) · [中文](README_CN.md)

</div>

---

> **One gateway for all your AI APIs.**
>
> Unify OpenAI, Anthropic (Claude), DeepSeek, MiMo, and any OpenAI/Anthropic-compatible provider behind a single endpoint.
> Automatic multi-key rotation, cross-protocol failover, circuit breaking, and smart routing — zero glue code required.

### Choose Your Deployment Mode

| | ☁️ Vercel | ⚡ Cloudflare Pages | 🐳 Self-Hosted (Docker / VPS) | 💻 Local CLI (`airelay`) |
|---|---|---|---|---|
| **Best for** | Quick evaluation & personal chat | High-frequency coding on free tier | Long-running agents, teams, zero limits | Single-machine coding agents |
| **Runtime** | Vercel Node.js Serverless (`60s` max) | Cloudflare Workers (`@opennextjs/cloudflare`) | Standalone Node.js container / process | Local HTTP server (`127.0.0.1:3147`) |
| **Storage** | Upstash Redis (`@vercel/kv`) | Cloudflare KV (config) + D1 (usage) | Persistent Disk (`./data`) **or** PostgreSQL | Cloud snapshot / local JSON / env |
| **Token stats** | Configurable sampling (`RELAY_KV_USAGE_SAMPLE_RATE`) | Direct D1 writes + byte-estimated streams | **100% real-time exact** (Disk or Postgres) | Syncs batched usage to Cloud Admin |
| **Background cron** | Vercel Cron (`/api/cron/*`) | Workers `scheduled()` + D1 cleanup | **Built-in scheduler** (auto-enabled) | 30s config sync + 60s heartbeat |
| **Platform limits** | Hobby free-tier bandwidth & KV command caps | ~10ms Free Worker CPU budget, 6 sockets | **None** (bound only by your server) | Localhost only unless bound to LAN |

> **TL;DR:** Try **Vercel** in 2 minutes → use **Cloudflare** for heavy serverless coding → deploy **Docker / VPS** for zero serverless timeouts or team sharing → run **Local CLI** on your laptop for local agents like Codex and Claude Code. All four share the exact same Relay Core and API!

---

## 🚀 Quick Start

### ☁️ 1. Deploy to Vercel (Fastest Start)

1. Click **Deploy with Vercel** above and set:

| Variable | Description |
|----------|-------------|
| `RELAY_API_KEY` | Client authentication key for `/v1/*` (`Bearer` or `X-API-Key`) |
| `RELAY_ADMIN_KEY` | Admin dashboard key (optional; falls back to `RELAY_API_KEY`) |
| `RELAY_SIGNING_SECRET` | HMAC signing secret for temporary keys (optional) |

2. In Vercel Dashboard → **Storage** → attach **Upstash for Redis** (`KV_REST_API_URL` & `KV_REST_API_TOKEN`).
3. Visit `/admin` to add upstream provider keys, then call `/v1/chat/completions`:

```bash
curl -X POST https://your-project.vercel.app/v1/chat/completions \
  -H "Authorization: Bearer YOUR_RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-5.4", "messages": [{"role": "user", "content": "Hello!"}]}'
```

<details id="deploy-cloudflare">
<summary><strong>⚡ 2. Deploy to Cloudflare Pages</strong></summary>

**Prerequisites:** [Cloudflare account](https://dash.cloudflare.com/sign-up) (free) + GitHub fork.

**Step 1 — Configure GitHub Repository Secrets** (`Settings → Secrets and variables → Actions`):

| Secret | Description | Required |
|--------|-------------|----------|
| `CLOUDFLARE_API_TOKEN` | Token with `Cloudflare Pages:Edit`, `D1:Edit`, `Workers KV Storage:Edit` | ✅ |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID | ✅ |
| `RELAY_API_KEY` | Client authentication key | ✅ |
| `RELAY_ADMIN_KEY` | Admin login key (optional, defaults to `RELAY_API_KEY`) | ⬜ |
| `RELAY_SIGNING_SECRET` | Temporary key signing secret (optional) | ⬜ |
| `DEVICE_TOKEN_SECRET` | Device token hash secret for `airelay login` (optional) | ⬜ |
| `CRON_SECRET` | Authenticates scheduled probe/report jobs (optional) | ⬜ |

**Step 2 — Push or trigger workflow**

Push to `main` (or trigger **Deploy to Cloudflare Pages** in GitHub Actions). The workflow automatically provisions D1 + KV, runs migrations, builds the OpenNext bundle, and syncs secrets.

**Step 3 — Verify**

```bash
curl https://your-project.pages.dev/health
```

</details>

<details id="deploy-self-hosted">
<summary><strong>🐳 3. Self-Host with Docker / VPS (Disk or PostgreSQL)</strong></summary>

Self-hosted mode runs as a standalone Node.js server with **built-in cron scheduling** (periodic health probes, daily usage aggregation, and webhook reports) and **container liveness support** (`/health?liveness=1`).

#### Option A — Single-Container Persistent Disk (Zero External DB)

Persists all Admin settings, keys, aliases, routing rules, quotas, and usage in `/app/data/kv-store.json`:

```bash
git clone https://github.com/MoyuFamily/ai-relay.git && cd ai-relay
RELAY_API_KEY=your-strong-secret docker compose up -d --build
```

#### Option B — Multi-Instance High Availability with PostgreSQL

Pass `DATABASE_URL` — AI Relay **auto-creates all PostgreSQL tables and indexes on startup** (zero manual migration steps):

```bash
DATABASE_URL=postgresql://airelay:airelay@postgres:5432/airelay \
RELAY_API_KEY=your-strong-secret \
docker compose --profile postgres up -d --build
```

#### Option C — Bare-Metal / PM2 / Systemd

```bash
pnpm install --frozen-lockfile
NEXT_STANDALONE=1 pnpm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
RELAY_API_KEY=your-strong-secret RELAY_DATA_DIR=./data node .next/standalone/server.js
```

> **Container Healthchecks:** Use `GET /health?liveness=1` for Docker / Kubernetes / Coolify liveness probes (returns `200` even before provider keys are added in `/admin`), and `GET /health` for readiness probes (`200` when ≥1 key is available, `503` when `0` keys are available).

</details>

<details id="deploy-local-cli">
<summary><strong>💻 4. Run Locally via CLI (<code>airelay</code>)</strong></summary>

Run a lightweight local gateway on `http://127.0.0.1:3147` for Codex, Claude Code, Cursor, or local scripts without consuming cloud serverless quota.

> 📖 Full guide: [CLI_GUIDE.md](CLI_GUIDE.md)

```bash
git clone https://github.com/MoyuFamily/ai-relay.git && cd ai-relay
pnpm install && npm link

# Option A: Sync providers & keys from your Cloud / Self-Hosted Admin
airelay login https://your-relay.example.com
airelay local:start

# Option B: Standalone local config file or environment variables
airelay local:start --config ./relay-config.json
OPENAI_KEYS="sk-xxx" airelay local:start

# Optional: Auto-configure Codex CLI
airelay agent:install codex
airelay agent:doctor codex
```

</details>

---

## ✨ Core Capabilities

**Protocol & Cross-Provider Translation**
| Endpoint | Protocol | Capabilities |
|----------|----------|--------------|
| `POST /v1/chat/completions` | OpenAI Chat Completions | Streaming & non-streaming, tool calls, vision, transparent fallback to Anthropic `/v1/messages` |
| `POST /v1/messages` | Anthropic Messages API | Native Claude Code / SDK support, streaming SSE, transparent fallback to OpenAI-format providers |
| `POST /v1/messages/count_tokens` | Anthropic Token Counting | Upstream token counting with automatic local estimation fallback |
| `POST /v1/responses` | OpenAI Responses API | Streaming & non-streaming Responses API forwarding |
| `GET /v1/models` & `/v1/models/:model` | OpenAI Model Discovery | Aggregated model list + virtual aliases + hidden-model filtering |

**Routing, Resilience & Governance**
- **Multi-key rotation & cooldowns**: Round-robin rotation with automatic 60s per-key cooldown on `429` / `5xx` and instant retry on healthy keys.
- **Multi-provider fallback & cycle prevention**: Chain fallbacks across providers and model mappings (`provider:model`) with loop detection.
- **Circuit breaker & smart routing**: Automatically isolate degraded upstreams and route by priority rules, latency, cost, or availability.
- **Stateless temporary keys**: Issue HMAC-SHA256 time-bounded client tokens with model allowlists and request quotas.
- **Webhooks & observability**: Daily usage reports and threshold alerts to Slack, Feishu, WeCom, DingTalk, or generic webhooks, plus opt-in request tracing.

---

## 🏗️ Architecture

```text
Clients (OpenAI SDK / Claude Code / Codex / Cursor / curl)
   │
   ▼  /v1/chat/completions · /v1/messages · /v1/responses · /v1/models
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI Relay Core Engine                            │
│  Auth (Constant-Time + Temp HMAC) → Quota & Payload Guards              │
│  → Model Alias & Priority Rules → Smart Routing & Circuit Breaker       │
│  → Multi-Key Pool Rotation → Bidirectional OpenAI ↔ Anthropic Bridge    │
├─────────────────┬──────────────────┬───────────────────┬────────────────┤
│ Vercel          │ Cloudflare Pages │ Self-Hosted Node  │ Local CLI      │
│ Serverless Node │ OpenNext Workers │ Docker / VPS      │ 127.0.0.1:3147 │
│ + Upstash KV    │ + CF KV + CF D1  │ + Disk or Postgres│ + Cloud Sync   │
└─────────────────┴──────────────────┴───────────────────┴────────────────┘
   │                  │                  │                  │
   ▼                  ▼                  ▼                  ▼
OpenAI · Anthropic (Claude) · DeepSeek · MiMo · Custom OpenAI/Anthropic APIs
```

See [Technical Design](docs/TECH-DESIGN.md) and [Storage Architecture](docs/storage-architecture.md) for deep dives.

---

## 📖 Usage Examples

### OpenAI SDK (Python / TypeScript)

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_RELAY_API_KEY",
    base_url="https://your-relay.example.com/v1",
)

stream = client.chat.completions.create(
    model="gpt-5.4",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### Anthropic Messages API (Claude Code / SDK)

```bash
curl -X POST https://your-relay.example.com/v1/messages \
  -H "x-api-key: YOUR_RELAY_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### OpenAI Responses API

```bash
curl -X POST https://your-relay.example.com/v1/responses \
  -H "Authorization: Bearer YOUR_RELAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-5.4", "input": "Summarize this repository", "stream": true}'
```

---

## 🔧 Configuration Reference

See [`.env.local.example`](.env.local.example) for the complete template.

| Variable | Description | Required |
|----------|-------------|----------|
| `RELAY_API_KEY` | Client auth key(s), comma-separated (`Bearer` or `X-API-Key`) | ✅ |
| `RELAY_ADMIN_KEY` | Admin dashboard key(s) (falls back to `RELAY_API_KEY` if unset) | ⬜ |
| `RELAY_SIGNING_SECRET` | HMAC signing secret for temporary client keys | ⬜ |
| `DEVICE_TOKEN_SECRET` | Secret for hashing `airelay login` device tokens | ⬜ |
| `OPENAI_KEYS` / `CLAUDE_KEYS` / `DEEPSEEK_KEYS` / `XIAOMI_KEYS` | Static provider keys (can also be managed dynamically in `/admin`) | ⬜ |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel KV / Upstash Redis credentials (Vercel mode) | ⬜ |
| `RELAY_DATA_DIR` / `RELAY_STORAGE_PATH` | Persistent JSON state directory/file for single-node self-hosted mode (default `./data`) | ⬜ |
| `DATABASE_URL` | PostgreSQL connection string for multi-node self-hosted mode (auto-bootstraps schema) | ⬜ |
| `ENABLE_SELF_HOSTED_CRON` | Enable built-in background probes & daily reports on self-hosted servers (default `true`) | ⬜ |
| `SELF_HOSTED_PROBE_INTERVAL_MINUTES` | Upstream health probe interval in minutes on self-hosted servers (default `60`) | ⬜ |
| `RELAY_DAILY_LIMIT` / `RELAY_MONTHLY_LIMIT` | Global daily/monthly request limits (`0` = unlimited) | ⬜ |
| `RELAY_MAX_CONCURRENT` | Per-instance concurrent `/v1/*` request cap (`0` = unlimited) | ⬜ |
| `RELAY_ALLOWED_ORIGINS` | Allowed browser CORS origins (comma-separated or `*`) | ⬜ |
| `RELAY_UPSTREAM_TIMEOUT_MS` | Upstream timeout in ms (default `50000`, `0` to disable) | ⬜ |
| `RELAY_KV_USAGE_SAMPLE_RATE` | KV usage sampling rate for Upstash quota saving (`1` = 100%, `0.1` = 10%) | ⬜ |

---

## 📊 Admin Dashboard

Sign in at `/admin` with `RELAY_ADMIN_KEY`:

- **Overview & Monitor** — Real-time request/token metrics, provider health probes, error breakdown, and opt-in request logs.
- **Providers & Keys** — 3-step custom provider wizard, Cherry Studio / NewAPI import, CcSwitch export, multi-key health testing.
- **Routing & Models** — Model aliases, visibility controls, priority rules, smart routing weights, and drag-and-drop fallback chains.
- **Security & Tools** — Temporary HMAC key generator, key rotation alerts, config/stats JSON backup & restore, and webhook notifications.

<details>
<summary>View screenshots</summary>

![Overview](docs/assets/screenshots/admin-overview.png)
![Key Management](docs/assets/screenshots/admin-keys.png)
![Tools](docs/assets/screenshots/admin-tools.png)

</details>

---

## 🌐 Community Infrastructure (Planned)

AI Relay is an [MIT-licensed](LICENSE), community-accessible open-source project. Alongside its serverless and self-hosted deployment options, we are planning a **non-commercial, always-on compatibility and reliability test environment** to help contributors reproduce issues across runtimes.

The proposed Linux-based community infrastructure would provide:

- **Protocol compatibility checks** — exercise OpenAI-compatible endpoints, streaming/SSE behavior, model routing and fallback using mock or explicitly authorized test providers.
- **Reliability and performance tests** — reproduce timeouts, error responses and concurrency scenarios with controlled workloads and published, reproducible findings.
- **Safe public demonstrations** — demonstrate API behavior with simulated credentials and sanitized example data; no collection of visitors' personal provider keys.
- **Contributor verification** — run regression tests and keep diagnostic artifacts available for issue reports and pull requests.

**Status: planned, not a currently operating public service.** A VPS provides persistent processes, predictable test resources and host-level metrics that are harder to maintain consistently across ephemeral serverless runs. Infrastructure granted for this purpose would be used for non-commercial open-source development and education, not API resale or unrelated services.

We welcome infrastructure sponsorship for this effort. Sponsors providing the environment may be acknowledged here and in project documentation once support is confirmed.

---

## 📚 Documentation

- **[CLI & Local Relay Guide](CLI_GUIDE.md)** — `airelay` installation, cloud sync, standalone config, and Codex integration
- **[Technical Design](docs/TECH-DESIGN.md)** — End-to-end request lifecycle, protocol translation, and platform constraints
- **[Storage Architecture](docs/storage-architecture.md)** — Multi-platform KV / D1 / Disk / PostgreSQL storage adapters
- **[FAQ](docs/FAQ.md)** — Troubleshooting deployment, auth, Docker, and local relay
- **[Release Flow](docs/RELEASE-FLOW.md)** — Branching & CI/CD workflow for forks and maintainers
- **[Changelog](CHANGELOG.md)** — Version history

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
