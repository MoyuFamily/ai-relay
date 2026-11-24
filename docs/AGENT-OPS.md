# AI Relay — Agent Deployment & Maintenance Runbook

> **Audience**: Autonomous coding & ops agents (Codex, Claude Code, Antigravity, Cursor, OpenClaw, etc.) and engineers orchestrating AI Relay via CLI / HTTP API without clicking through web dashboards.
>
> Every command in this runbook is **non-interactive**, **idempotent where possible**, and verified against the current codebase (`main`).

---

## 0. Agent Hard Rules & Safety Guardrails

Before executing any deployment or maintenance command, follow these non-negotiable rules:

1. **Always run CLIs non-interactively**:
   - Export `CI=true` and `WRANGLER_SEND_METRICS=false` when calling `wrangler` (prevents interactive AI-skills / telemetry prompts from hanging).
   - Pipe secrets via `printf '%s' "$VAL"` or a `chmod 600` temp JSON file (`wrangler pages secret bulk`), never interactive prompts, and **never** include trailing newlines in secrets.
   - Pass `--yes` to `vercel deploy` / `vercel link`. Note: `vercel project rm` does **not** accept `--yes`; confirm with `printf 'y\n' | vercel project rm <name>`.
2. **Isolate CLI accounts & workspaces**:
   - Repo roots may contain `.vercel/repo.json` or `.vercel/project.json` bound to an existing account. When deploying to a different or test account, **always** clone/copy to a clean temp directory outside the repo root and isolate auth state:
     - Vercel: `vercel ... -Q /path/to/isolated-vercel-auth`
     - Cloudflare: `XDG_CONFIG_HOME=/path/to/isolated-cf-auth CI=true WRANGLER_SEND_METRICS=false pnpm exec wrangler ...`
   - Never overwrite the user's default `~/.vercel`, `~/.config/.wrangler`, or tracked `.vercel/` files.
3. **Protect secrets & clean git state**:
   - Never print raw API keys or tokens to stdout/logs or commit `.env`, `.env.local`, or real D1/KV IDs in `wrangler.toml`.
   - Delete temporary secret JSON files immediately via `trap 'rm -f "$SECRETS_FILE"' EXIT`.
4. **Respect auth & platform boundaries**:
   - Never attempt to bypass CAPTCHA, Turnstile, SSO, or access controls. If CLI auth or OAuth confirmation is required, pause and provide the exact login URL/code to the user.
5. **Follow single-branch release workflow (`main`)**:
   - Do not push directly to protected `main`; create a short-lived branch, run `bash scripts/ci-local.sh`, open a PR, and wait for the required CI check `Lint, Type-Check, Test & Build`.

---

## 1. Deployment Mode Selection & Runtime Invariants

### 1.1 Target Matrix

| Mode | When to choose | Runtime | Persistent Storage | Cron / Background Tasks | Hard Limits |
|---|---|---|---|---|---|
| **Vercel** | Fast cloud deploy, light personal/team usage | Node.js Serverless (`60s` max) | Upstash Redis (`UPSTASH_REDIS_REST_*` or `KV_REST_API_*`) | `vercel.json` Cron (requires `CRON_SECRET`) | 60s timeout (`RELAY_UPSTREAM_TIMEOUT_MS=50000`), Hobby bandwidth & Redis cmd caps |
| **Cloudflare Pages** | Free-tier high-frequency coding relay | Workers (`@opennextjs/cloudflare`) | Cloudflare `KV` (config) + `D1` (usage/logs) | GitHub Actions `.github/workflows/cron.yml` (`DEPLOY_URL` + `CRON_SECRET`) | ~10ms Free CPU budget, 6 concurrent subrequests, KV 60s edge negative cache |
| **Docker / VPS (Disk)** | Single-node self-hosted, zero serverless limits | Standalone Node.js (`next start`) | Atomic JSON on disk (`/app/data/kv-store.json`) | Built-in Node scheduler (`ENABLE_SELF_HOSTED_CRON=true`) | Bound only by host |
| **Docker / VPS (Postgres)** | Multi-replica HA self-hosted | Standalone Node.js (`next start`) | PostgreSQL (`DATABASE_URL`, auto-migrates on boot) | Built-in Node scheduler (`ENABLE_SELF_HOSTED_CRON=true`) | Bound only by host/DB |
| **Local CLI (`airelay`)** | Laptop coding agents (`codex`, `claude-code`) | Local HTTP (`127.0.0.1:3147`) | Local JSON / env / cloud snapshot sync | 30s config poll + 60s heartbeat | Localhost only by default |

### 1.2 Storage Auto-Detection Precedence (`src/lib/config/env.ts`)

Understand this exact order before debugging storage issues:

1. **Cloudflare (`CF_PAGES` / OpenNext context)** → native `KV` + `DB` (D1) bindings.
2. **Redis REST (`KV_REST_API_URL` + `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`)** → Upstash / Vercel KV.
3. **Self-Hosted PostgreSQL** → selected when **not** on Vercel/CF/Redis, `DATABASE_URL` matches `^postgres(ql)?://`, and not forced to file (`RELAY_STORAGE_BACKEND=file` or explicit `RELAY_STORAGE_PATH` without `RELAY_STORAGE_BACKEND=postgres`). **Takes precedence over Docker's default `RELAY_DATA_DIR=/app/data`.**
4. **Self-Hosted Persistent Disk** → `RELAY_STORAGE_PATH` or `${RELAY_DATA_DIR}/kv-store.json` (default `./data/kv-store.json`).

### 1.3 Core Environment Variables

| Variable | Required | Default / Fallback | Purpose |
|---|---|---|---|
| `RELAY_API_KEY` | **Yes** | — | Comma-separated client keys for `/v1/*` (`Bearer` or `x-api-key`). Also fallback for Admin & Signing keys. |
| `RELAY_ADMIN_KEY` | No | Falls back to `RELAY_API_KEY` | Comma-separated Admin keys for `/admin` & `/api/admin/*`. |
| `RELAY_SIGNING_SECRET` | No | Falls back to Admin/Relay key | HMAC secret for temporary keys (`/api/admin/temp-keys`). |
| `DEVICE_TOKEN_SECRET` | No | Falls back to Admin/Relay key | Hashing secret for Local CLI device login (`airelay login`). |
| `CRON_SECRET` | Recommended | — | Constant-time auth for `/api/cron/*` (`Authorization: Bearer` or `x-cron-secret`). **Bare `x-vercel-cron: 1` is intentionally rejected.** |
| `OPENAI_KEYS`, `CLAUDE_KEYS`, `GEMINI_KEYS`, `DEEPSEEK_KEYS`, `OPENROUTER_KEYS`, `XIAOMI_KEYS`, `XIAOMI_CODING_KEYS`, `XIAOMIMIMO_SGP_CODING_KEYS` | Optional | Managed in `/admin` / KV | Comma-separated upstream provider API keys. Managed KV keys override env keys once written. |
| `*_BASE_URL` | Optional | Built-in provider URL | Override upstream endpoint (e.g. `OPENAI_BASE_URL`, `GEMINI_BASE_URL`). |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_*`) | Vercel | — | Persistent config + usage store on Vercel. |
| `DATABASE_URL` | Optional (Self-host HA) | — | PostgreSQL URL (`postgresql://...`). Auto-creates tables on startup. |
| `RELAY_DATA_DIR` / `RELAY_STORAGE_PATH` / `RELAY_STORAGE_BACKEND` | Optional (Self-host) | `./data` (`/app/data` in Docker) | Disk storage directory / file path / explicit override (`file` \| `postgres`). |
| `DEPLOY_URL` | CF Cron / Reverse Proxy | — | Public `https://...` URL for GitHub Actions `cron.yml` & device login links. |
| `ENABLE_SELF_HOSTED_CRON` / `SELF_HOSTED_PROBE_INTERVAL_MINUTES` | Self-host | `true` / `60` | Built-in background health probes, daily report, cleanup (auto-off on Vercel/CF). |
| `ENABLE_REQUEST_LOGS` / `REQUEST_LOGS_MAX_ENTRIES` | Optional | `false` | Persist request logs to KV/D1/DB (when `false`, `/api/admin/request-logs` returns `"source": "memory"`). |
| `RELAY_ALLOWED_ORIGINS` (alias `CORS_ORIGINS`) | Optional | `*` | Allowed CORS origins (comma-separated or `*`). |
| `RELAY_UPSTREAM_TIMEOUT_MS` | Optional | `50000` (Serverless) / `300000` (Self-host) | Upstream fetch timeout in ms (`0` disables). |
| `RELAY_DAILY_LIMIT` / `RELAY_MONTHLY_LIMIT` / `RELAY_MAX_CONCURRENT` | Optional | `0` (unlimited) | Global quotas & concurrency guard. |

---

## 2. Pre-Flight Checks & Headless Authentication

### 2.1 Check Local Toolchain

```bash
node -v          # >= 18 (22 recommended for Cloudflare / CI)
pnpm -v          # pnpm 11.x (defined in packageManager)
curl --version | head -1
jq --version
```

### 2.2 Generate Secrets Safely

```bash
RELAY_API_KEY="$(openssl rand -hex 24)"
RELAY_ADMIN_KEY="$(openssl rand -hex 24)"
CRON_SECRET="$(openssl rand -hex 24)"
DEVICE_TOKEN_SECRET="$(openssl rand -hex 32)"
```

### 2.3 CLI Auth Verification (Including Remote / Phone User Flows)

- **GitHub CLI**: `gh auth status`
- **Vercel CLI**:
  ```bash
  vercel whoami                                  # default account
  vercel whoami -Q /tmp/vercel-isolated-auth     # isolated account
  ```
  - If unauthenticated, run `vercel login -Q <auth-dir>` — Vercel prints a device OAuth URL (`https://vercel.com/oauth/device?user_code=XXXX-XXXX`) that the user can approve from any phone or browser.
- **Cloudflare Wrangler**:
  ```bash
  CI=true WRANGLER_SEND_METRICS=false pnpm exec wrangler whoami
  ```
  - Best for automation: set `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. Required token permissions: `Account:Cloudflare Pages:Edit`, `Account:D1:Edit`, `Account:Workers KV Storage:Edit`, `Account:Account Settings:Read`.
  - If using OAuth on a headless machine or when the user approves on a phone:
    1. Start `XDG_CONFIG_HOME=<auth-dir> pnpm exec wrangler login --browser=false` in the background (listens on `http://localhost:8976/oauth/callback`).
    2. Send the printed `https://dash.cloudflare.com/oauth2/auth?...` URL to the user.
    3. After authorizing, the user's phone browser fails to load `http://localhost:8976/oauth/callback?code=...&state=...` — ask the user to copy that full callback URL and replay it locally:
       ```bash
       curl -sS "<CALLBACK_URL_FROM_USER>"
       ```

---

## 3. Step-by-Step Deployment Runbooks

### 3.1 Vercel (Serverless + Upstash Redis)

> **Critical**: Never skip attaching Upstash Redis if the user intends to manage provider keys, aliases, routing, or webhooks via `/admin` or `/api/admin/*`. After attaching storage, a **Redeploy** is mandatory so injected env vars take effect.

```bash
set -euo pipefail
PROJECT_NAME="ai-relay"
AUTH_FLAG="" # or: AUTH_FLAG="-Q /path/to/isolated-vercel-auth"

# 1. Work in a clean directory (avoids repo-root .vercel/repo.json collision)
WORK_DIR="$(mktemp -d)"
git archive main | tar -x -C "$WORK_DIR"
cd "$WORK_DIR"

# 2. Link / create Vercel project
vercel link --yes --project "$PROJECT_NAME" $AUTH_FLAG

# 3. Attach free Upstash Redis via Vercel Marketplace (injects KV_REST_API_* / UPSTASH_REDIS_REST_*)
#    If CLI Marketplace prompts interactively, ask the user to attach "Upstash for Redis" in
#    Vercel Dashboard -> Storage -> Connect Store, or use the one-click button URL in README.md.
vercel integration add upstash/upstash-kv --plan free $AUTH_FLAG || true

# 4. Push required environment variables (production) without trailing newlines
printf '%s' "$RELAY_API_KEY"  | vercel env add RELAY_API_KEY production --force $AUTH_FLAG
printf '%s' "$CRON_SECRET"    | vercel env add CRON_SECRET production --force $AUTH_FLAG
# Optional: separate admin key or initial provider keys
# printf '%s' "$RELAY_ADMIN_KEY" | vercel env add RELAY_ADMIN_KEY production --force $AUTH_FLAG

# 5. Deploy production (must run AFTER storage + env vars are attached)
DEPLOY_URL="$(vercel deploy --prod --yes $AUTH_FLAG | tail -1)"
echo "Production URL: $DEPLOY_URL"
```

**Vercel-specific notes**:
- New Hobby accounts enable **Deployment Protection** on Preview URLs (`*-<hash>-<team>.vercel.app`), returning Vercel's SSO login page (`401`). Always verify against the **Production** domain (`https://<project>.vercel.app`).
- `vercel.json` schedules `/api/cron/probe` (`0 0 * * *`) and `/api/cron/usage` (`5 0 * * *`). Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is configured.

---

### 3.2 Cloudflare Pages (OpenNext + KV + D1)

#### Option A: GitHub Actions Automated Deploy (Recommended for Ongoing Maintenance)

1. Ensure the user has forked or owns the repo and enabled **Actions** (GitHub disables workflows by default on forks).
2. Configure Repository Secrets (`gh secret set` or Settings → Secrets and variables → Actions):
   - Required: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `RELAY_API_KEY`
   - Recommended: `CRON_SECRET`, `DEPLOY_URL` (e.g. `https://ai-relay.pages.dev`, activates `.github/workflows/cron.yml`)
   - Optional variable: `CLOUDFLARE_PAGES_PROJECT_NAME` (defaults to `ai-relay`)
3. Trigger deploy:
   ```bash
   gh workflow run deploy-cf.yml --ref main
   gh run watch
   ```
   `deploy-cf.yml` automatically provisions D1 + KV, runs D1 migrations, builds OpenNext, materializes static HTML (`index.html`, `admin.html`, `404.html`), syncs secrets via `wrangler pages secret bulk` **before** deploy, and deploys to `main`.

#### Option B: Direct CLI Deploy (Verified OpenNext + Wrangler Pipeline)

```bash
set -euo pipefail
export CI=true
export WRANGLER_SEND_METRICS=false
# Optional account isolation:
# export XDG_CONFIG_HOME="/path/to/isolated-cf-auth"
# Or token auth:
# export CLOUDFLARE_API_TOKEN="..."
# export CLOUDFLARE_ACCOUNT_ID="..."

PROJECT_NAME="ai-relay"
WORK_DIR="$(mktemp -d)"
git archive main | tar -x -C "$WORK_DIR"
cd "$WORK_DIR"
pnpm install --frozen-lockfile

# 1. Provision D1 database & extract UUID
D1_ID="$(pnpm exec wrangler d1 list --json | jq -r --arg n "$PROJECT_NAME" '.[] | select(.name == $n) | .uuid' | head -1)"
if [ -z "$D1_ID" ]; then
  D1_ID="$(pnpm exec wrangler d1 create "$PROJECT_NAME" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
fi

# 2. Provision KV namespace & extract ID
KV_TITLE="${PROJECT_NAME}-KV"
KV_ID="$(pnpm exec wrangler kv namespace list | jq -r --arg t "$KV_TITLE" '.[] | select(.title == $t) | .id' | head -1)"
if [ -z "$KV_ID" ]; then
  KV_ID="$(pnpm exec wrangler kv namespace create KV | grep -oE '[0-9a-f]{32}' | head -1)"
fi

# 3. Write temporary wrangler.toml (never commit real IDs to git)
cat > wrangler.toml <<EOF
name = "${PROJECT_NAME}"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".open-next"

[[kv_namespaces]]
binding = "KV"
id = "${KV_ID}"

[[d1_databases]]
binding = "DB"
database_name = "${PROJECT_NAME}"
database_id = "${D1_ID}"
migrations_dir = "migrations"
EOF

# 4. Create Pages project (idempotent)
pnpm exec wrangler pages project create "$PROJECT_NAME" --production-branch main || true

# 5. Apply all D1 migrations (migrations/0001..0005)
pnpm exec wrangler d1 migrations apply "$PROJECT_NAME" --remote

# 6. Build with OpenNext for Cloudflare
NODE_ENV=production pnpm exec opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion

# 7. Adapt .open-next for Cloudflare Pages (static assets + materialized / and /admin + _routes.json + _worker.js)
[ -d ".open-next/assets" ] && cp -r .open-next/assets/* .open-next/
CACHE_DIR="$(find .open-next/cache -mindepth 1 -maxdepth 1 -type d | head -1)"
CACHE_DIR="$CACHE_DIR" node -e '
  const fs = require("fs"), path = require("path");
  const cacheDir = process.env.CACHE_DIR, out = ".open-next";
  const entries = [["index.cache","index.html","/"],["admin.cache","admin.html","/admin"],["_not-found.cache","404.html",null]];
  const exclude = ["/_next/static/*","/favicon.ico","/*.png","/*.ico","/*.txt","/*.svg"];
  for (const [src, dst, route] of entries) {
    const p = path.join(cacheDir, src);
    if (!fs.existsSync(p)) continue;
    const html = JSON.parse(fs.readFileSync(p, "utf8"))?.html;
    if (!html) continue;
    fs.writeFileSync(path.join(out, dst), html);
    if (route) exclude.unshift(route);
  }
  fs.writeFileSync(path.join(out, "_routes.json"), JSON.stringify({ version: 1, include: ["/*"], exclude }));
'
[ -f ".open-next/worker.js" ] && mv .open-next/worker.js .open-next/_worker.js

# 8. Upload secrets BEFORE deploying (Pages binds secrets only to subsequent deployments!)
SECRETS_FILE="$(mktemp)"
trap 'rm -f "$SECRETS_FILE"' EXIT
chmod 600 "$SECRETS_FILE"
jq -n \
  --arg relay "$RELAY_API_KEY" \
  --arg cron "$CRON_SECRET" \
  '{RELAY_API_KEY: $relay, CRON_SECRET: $cron}' > "$SECRETS_FILE"
pnpm exec wrangler pages secret bulk "$SECRETS_FILE" --project-name="$PROJECT_NAME" --env production

# 9. Deploy to Cloudflare Pages
pnpm exec wrangler pages deploy .open-next --project-name="$PROJECT_NAME" --branch=main
```

**Cloudflare-specific notes**:
- **Secret ordering**: Always run `wrangler pages secret bulk` **before** `wrangler pages deploy`; changing secrets never affects already-deployed builds retroactively.
- **KV edge negative cache**: Cloudflare KV may cache a `null` miss at edge PoPs for up to 60 seconds across *different* Worker isolates. Same-isolate writes are immediate via write-through `globalThis` caches; if smoke-testing immediately after a cold miss across routes, allow a short retry window or verify via `GET /api/admin/setup?refresh=1`.

---

### 3.3 Self-Hosted Docker / VPS (Disk or PostgreSQL)

#### Quick Start (Recommended)

```bash
# Single-container persistent disk mode (generates .env + RELAY_API_KEY automatically)
bash scripts/quick-start.sh

# Multi-replica / PostgreSQL mode (auto-creates Postgres credentials + tables on boot)
bash scripts/quick-start.sh --postgres
```

#### Pre-Built Multi-Arch GHCR Image (Zero Local Build)

```bash
docker run -d --name ai-relay --restart unless-stopped \
  -p 3000:3000 \
  -e RELAY_API_KEY="$RELAY_API_KEY" \
  -e CRON_SECRET="$CRON_SECRET" \
  -e DEPLOY_URL="https://relay.example.com" \
  -v ai-relay-data:/app/data \
  ghcr.io/moyufamily/ai-relay:latest
```

**Self-Hosted operational notes**:
- Container healthchecks must probe `GET /health?liveness=1` (returns `200` even with 0 provider keys configured), while external traffic/readiness probes should use `GET /health` (`200` only when `>= 1` upstream key is available).
- Behind Nginx/Caddy/Traefik, set `DEPLOY_URL=https://your-domain` and forward `X-Forwarded-Proto` + `X-Forwarded-Host` so `airelay login` generates valid callback URLs.
- Built-in scheduler runs automatically (`ENABLE_SELF_HOSTED_CRON=true`); no external cron needed.

---

### 3.4 Local CLI (`airelay`)

For non-interactive agent setup on a developer workstation:

```bash
pnpm install
# Run directly without global link: pnpm run cli -- <cmd>
# Or register globally: pnpm link --global

# Non-interactive JSON config
mkdir -p ~/.ai-relay
cat > ~/.ai-relay/relay-config.json <<'EOF'
{
  "version": 1,
  "providers": {
    "openai": {
      "name": "openai",
      "displayName": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "modelPrefixes": ["gpt-"],
      "headerFormat": "openai",
      "envKeyField": "OPENAI_KEYS",
      "apiKeys": ["sk-REPLACE_ME"]
    }
  },
  "modelAliases": { "aliases": { "fast": "gpt-6-luna" }, "hidden": [] }
}
EOF
chmod 600 ~/.ai-relay/relay-config.json

# Start local relay (default 127.0.0.1:3147)
pnpm run local:start -- --config ~/.ai-relay/relay-config.json

# Inspect status / integrate local coding agents
pnpm run cli -- local:status
pnpm run cli -- agent:install codex --dry-run
pnpm run cli -- agent:doctor codex
```

See [CLI_GUIDE.md](../CLI_GUIDE.md) for cloud device binding (`airelay login`).

---

## 4. Post-Deploy Verification Suite (Deterministic Smoke Tests)

Run this exact sequence after every deploy or upgrade. Set `BASE_URL`, `ADMIN_KEY` (`RELAY_ADMIN_KEY` or `RELAY_API_KEY`), `RELAY_KEY` (`RELAY_API_KEY`), and `CRON_SECRET`:

```bash
set -euo pipefail
BASE_URL="${BASE_URL%/}"

# 1. Liveness (must be 200 even before provider keys are added)
curl -fsS "$BASE_URL/health?liveness=1" | jq '{status, runtime, storage, version, keys}'

# 2. Admin page serves directly (must be 200, no 308/404)
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/admin")" -eq 200

# 3. Security guard: unauthenticated Admin & spoofed x-vercel-cron must be 401
test "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/admin/setup")" -eq 401
test "$(curl -s -o /dev/null -w '%{http_code}' -H 'x-vercel-cron: 1' "$BASE_URL/api/cron/probe")" -eq 401

# 4. Admin setup diagnostics (verify persistent storage & auth checks)
curl -fsS -H "Authorization: Bearer $ADMIN_KEY" "$BASE_URL/api/admin/setup?refresh=1" \
  | jq '{runtime, storageBackend, checks}'
# Expect: checks.adminKey == true, checks.relayKey == true, checks.kv == true

# 5. Authenticated Cron verification (if CRON_SECRET is set)
if [ -n "${CRON_SECRET:-}" ]; then
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/cron/probe" | jq '.status // .ok // .'
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/cron/usage" | jq '.status // .ok // .'
fi

# 6. Readiness check (200 once >= 1 upstream key exists; 503 degraded if 0 keys)
curl -sS -w '\nHTTP %{http_code}\n' "$BASE_URL/health"
```

When an upstream provider key is configured, also run a live relay test:

```bash
# Test provider key via Admin API (supports optional model & prompt)
curl -fsS -X POST "$BASE_URL/api/admin/providers/openai/keys/test" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-6-luna","prompt":"Reply with OK"}' | jq .

# Test client /v1/models and /v1/chat/completions
curl -fsS -H "Authorization: Bearer $RELAY_KEY" "$BASE_URL/v1/models" | jq '.data | length'
curl -fsS -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $RELAY_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-6-luna","messages":[{"role":"user","content":"Reply with OK"}],"max_tokens":8}' | jq .
```

---

## 5. Day-2 Maintenance & Operations (API-Driven)

All `/api/admin/*` routes authenticate with `Authorization: Bearer $ADMIN_KEY` (`RELAY_ADMIN_KEY`, falling back to `RELAY_API_KEY`).

### 5.1 Admin API Quick Reference

| Area | Endpoint | Methods | Purpose / Payload |
|---|---|---|---|
| **Diagnostics** | `/api/admin/setup?refresh=1` | `GET` | Runtime, storage backend, auth/KV checks, provider key counts |
| **Provider Keys** | `/api/admin/providers/:provider/keys` | `GET`, `POST`, `DELETE` | List masked keys + `hash`; add `{key}` or `{keys:[...]}`; remove `{hash}` or `{key}` |
| **Key Connectivity Test** | `/api/admin/providers/:provider/keys/test` | `POST` | Test `{hash?, key?, model?, prompt?}` against live upstream |
| **Custom Providers** | `/api/admin/providers` | `POST`, `DELETE` | Register `{name, displayName, baseUrl, headerFormat, modelPrefixes, models}` or delete `{name}` |
| **Fallbacks** | `/api/admin/providers/:provider/fallbacks` | `GET`, `PUT` | View/override provider fallback chain |
| **Model Aliases** | `/api/admin/aliases` | `GET`, `POST`, `PUT`, `DELETE` | Manage custom aliases (`POST {alias, target}`, `DELETE ?alias=...`) |
| **Smart Routing** | `/api/admin/routing` | `GET`, `PUT`, `POST` | View status, update strategy (`latency` \| `cost` \| `availability`), reset failures |
| **Global Quotas** | `/api/admin/quota` | `PUT`, `DELETE` | Override `{dailyLimit, monthlyLimit}` or reset to env defaults |
| **Temp Client Keys** | `/api/admin/temp-keys` | `POST` | Mint short-lived client key `{durationSeconds}` |
| **Webhooks** | `/api/admin/webhooks` & `/test` | `GET`, `POST`, `PUT`, `DELETE` | Configure alerts (`wecom`, `feishu`, `dingtalk`, `slack`, `generic`) |
| **Observability** | `/api/admin/usage`, `/usage-trend`, `/provider-health`, `/request-logs` | `GET` | Token/request stats, health probe history, recent logs |
| **Backup & Restore** | `/api/admin/backup` | `GET`, `POST` | Export/import all managed config (providers, keys, aliases, routing, quotas, webhooks) |
| **Stats Backup** | `/api/admin/backup/stats?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` | `GET`, `POST` | Export/import historical usage & error stats |

> Built-in provider IDs: `openai`, `anthropic`, `google`, `deepseek`, `openrouter`, `xiaomi`, `xiaomi_coding`, `xiaomi_sgp_coding`.

### 5.2 Common Maintenance Playbooks

#### A. Zero-Downtime Upstream Key Rotation

```bash
PROVIDER="openai"
# 1. List existing keys and note old hash
curl -fsS -H "Authorization: Bearer $ADMIN_KEY" "$BASE_URL/api/admin/providers/$PROVIDER/keys" | jq .

# 2. Add new key
NEW_HASH="$(curl -fsS -X POST "$BASE_URL/api/admin/providers/$PROVIDER/keys" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d "{\"key\":\"$NEW_UPSTREAM_KEY\"}" | jq -r '.keyHash')"

# 3. Verify new key works live BEFORE deleting the old key
curl -fsS -X POST "$BASE_URL/api/admin/providers/$PROVIDER/keys/test" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d "{\"hash\":\"$NEW_HASH\"}" | jq -e '.valid == true'

# 4. Remove old key by hash
curl -fsS -X DELETE "$BASE_URL/api/admin/providers/$PROVIDER/keys" \
  -H "Authorization: Bearer $ADMIN_KEY" -H "Content-Type: application/json" \
  -d "{\"hash\":\"$OLD_HASH\"}" | jq .
```

#### B. Backup & Cross-Platform Migration (e.g. Vercel ↔ Cloudflare ↔ Docker)

```bash
# 1. Export from source instance
curl -fsS -H "Authorization: Bearer $OLD_ADMIN_KEY" "$OLD_URL/api/admin/backup" > relay-config-backup.json
curl -fsS -H "Authorization: Bearer $OLD_ADMIN_KEY" \
  "$OLD_URL/api/admin/backup/stats?startDate=2026-01-01&endDate=$(date -u +%F)" > relay-stats-backup.json
chmod 600 relay-config-backup.json relay-stats-backup.json

# 2. Restore into target instance (must have persistent storage attached)
curl -fsS -X POST -H "Authorization: Bearer $NEW_ADMIN_KEY" -H "Content-Type: application/json" \
  --data-binary @relay-config-backup.json "$NEW_URL/api/admin/backup" | jq .
curl -fsS -X POST -H "Authorization: Bearer $NEW_ADMIN_KEY" -H "Content-Type: application/json" \
  --data-binary @relay-stats-backup.json "$NEW_URL/api/admin/backup/stats" | jq .

# 3. Verify target readiness & delete local backup files containing keys
curl -fsS "$NEW_URL/health" | jq '{status, providers, keys}'
rm -f relay-config-backup.json relay-stats-backup.json
```

#### C. Upgrading an Existing Deployment

- **Vercel**: Push/merge to `main` (auto-deploys) or run `vercel deploy --prod --yes`.
- **Cloudflare Pages**: Push/merge to `main` (runs `deploy-cf.yml`, automatically applying any new `migrations/*.sql` files before deploy). For manual CLI upgrades, always re-run `wrangler d1 migrations apply <db> --remote` before `wrangler pages deploy`.
- **Docker Compose**:
  - From source: `git pull origin main && docker compose up -d --build` (add `--profile postgres` if using bundled Postgres).
  - From GHCR: `docker compose pull && docker compose up -d`.
- Always re-run Section 4 smoke tests after upgrading.

#### D. Updating Built-In Models (Code Maintenance)

When adding or refreshing built-in provider models:
1. Verify current active official API model IDs via live vendor documentation (never rely on memory; remove retired/deprecated IDs).
2. Update model catalogs and defaults consistently across:
   - `src/lib/providers/registry.ts` & `src/lib/providers/resolver.ts`
   - `src/app/api/admin/aliases/route.ts` & `src/app/api/admin/providers/[provider]/keys/test/route.ts`
   - `src/app/admin/` templates/placeholders & `cli/` configs
   - `README.md`, `README_CN.md`, `CLI_GUIDE.md`, and Vitest test suites
3. Verify with `bash scripts/ci-local.sh` (runs `lint`, `type-check`, `test`, `build`).

#### E. Clean Teardown (Test / Ephemeral Deployments)

- **Vercel**:
  ```bash
  printf 'y\n' | vercel project rm "$PROJECT_NAME" $AUTH_FLAG
  # Also remove attached Upstash store in Vercel Storage / CLI if created for testing
  ```
- **Cloudflare**:
  ```bash
  CI=true WRANGLER_SEND_METRICS=false pnpm exec wrangler pages project delete "$PROJECT_NAME" --yes
  CI=true WRANGLER_SEND_METRICS=false pnpm exec wrangler d1 delete "$PROJECT_NAME" --skip-confirmation
  CI=true WRANGLER_SEND_METRICS=false pnpm exec wrangler kv namespace delete --namespace-id "$KV_ID" --skip-confirmation
  ```
- **Docker**: `docker compose down` (append `-v` **only** if you intentionally want to destroy persisted `/app/data` and Postgres volumes).

---

## 6. Troubleshooting Decision Table

| Symptom | Likely Root Cause | Deterministic Fix |
|---|---|---|
| `503` `server_not_configured` on `/api/admin/*` | `RELAY_API_KEY` (and `RELAY_ADMIN_KEY`) unset in runtime env | Set `RELAY_API_KEY` and **redeploy** (required on both Vercel & CF Pages). |
| `503` `storage_not_configured` when saving keys/aliases | No persistent KV/Redis/Disk/DB bound | Vercel: attach Upstash for Redis & Redeploy. CF: bind `KV` in `wrangler.toml` & redeploy. Self-host: verify `RELAY_DATA_DIR` is writable or set `DATABASE_URL`. |
| `GET /health` returns `503` (`status: "degraded"`) | Normal on fresh deploy with 0 upstream provider keys | Check `GET /health?liveness=1` (`200`), then add at least one key via `POST /api/admin/providers/:provider/keys` or env vars. |
| `401` on `/api/cron/probe` or `/api/cron/usage` | `CRON_SECRET` unset or caller sent only `x-vercel-cron: 1` | Set `CRON_SECRET` in runtime env (and GitHub Secrets for CF `cron.yml`) and send `Authorization: Bearer $CRON_SECRET` or `x-cron-secret: $CRON_SECRET`. |
| CF Pages `GET /admin` returns `308` or `404` | `admin.cache` not materialized to `admin.html` or excluded blindly in `_routes.json` | Follow Step 7 of Section 3.2 (exact logic in `.github/workflows/deploy-cf.yml`). |
| CF Pages newly written alias/key briefly unseen by next request | Cloudflare KV edge negative-cache (up to 60s across different isolates after cold miss) | Retry after a brief delay or query `GET /api/admin/setup?refresh=1`. |
| `GET /api/admin/request-logs` returns `"source": "memory"` | `ENABLE_REQUEST_LOGS` is unset or `false` (default to save KV/D1 writes) | Set `ENABLE_REQUEST_LOGS=true` and redeploy if persistent request logs are needed. |
| Vercel Preview URL returns SSO login HTML / `401` | Vercel Deployment Protection enabled on preview URLs by default | Test against the Production domain (`https://<project>.vercel.app`). |
| `504 Gateway Timeout` on long reasoning models | Serverless `50000ms` default timeout (60s platform cap) | Switch heavy/long-reasoning workloads to Docker self-hosted (`300000ms` default) or set `RELAY_UPSTREAM_TIMEOUT_MS`. |
| `wrangler` hangs indefinitely in agent shell | Interactive telemetry or AI skills prompt | Always prefix with `CI=true WRANGLER_SEND_METRICS=false`. |
