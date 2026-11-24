# AGENTS.md — AI Relay Repository Guide

This file provides repository-level instructions for AI coding and operations agents working in `MoyuFamily/ai-relay`.

## Key Documentation

- **Deployment, Verification & Maintenance Runbook**: [docs/AGENT-OPS.md](docs/AGENT-OPS.md) — **Read this first** before deploying, rotating keys, migrating storage, or troubleshooting Vercel, Cloudflare Pages, Docker/VPS, or Local CLI (`airelay`).
- **Release & CI Flow**: [docs/RELEASE-FLOW.md](docs/RELEASE-FLOW.md)
- **Technical Architecture & Storage**: [docs/TECH-DESIGN.md](docs/TECH-DESIGN.md), [docs/storage-architecture.md](docs/storage-architecture.md)
- **Local CLI Guide**: [CLI_GUIDE.md](CLI_GUIDE.md)

## Local Verification Commands

Run before committing or opening a PR:

```bash
pnpm run lint
pnpm run type-check
pnpm run test
DATABASE_URL=postgresql://localhost:5432/dummy pnpm run build
# Or run all stages at once:
bash scripts/ci-local.sh
```

Required GitHub Actions check on `main`: `Lint, Type-Check, Test & Build` (`.github/workflows/ci.yml`).

## Repository Invariants & Guardrails

1. **Single-branch workflow (`main`)**: Never force-push or push directly to protected `main`; use a short-lived branch and PR.
2. **Never weaken auth/cron security**:
   - `/api/admin/*` must return `503 server_not_configured` when no `RELAY_ADMIN_KEY`/`RELAY_API_KEY` is configured, and `401` on invalid/missing bearer token (`src/lib/admin/auth.ts`).
   - `/api/cron/*` must require constant-time `CRON_SECRET` (`Authorization: Bearer` or `x-cron-secret`) or Admin Bearer — **never** trust bare `x-vercel-cron: 1`.
3. **Multi-platform storage precedence (`src/lib/config/env.ts`)**:
   - Cloudflare (`KV` + `D1`) > Redis REST (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`) > Self-hosted PostgreSQL (`DATABASE_URL`, overrides default Docker `RELAY_DATA_DIR=/app/data`) > Persistent disk (`RELAY_STORAGE_PATH` / `RELAY_DATA_DIR`).
4. **Cross-route cache sharing on Next.js / OpenNext**:
   - Keep shared in-memory caches (`keyPools`, `cooldowns`, `configCache`, `providersCache`) on `globalThis` so separate route bundles in the same Worker isolate or Node process stay consistent.
5. **CLI & Account Isolation**:
   - Never run test `vercel` or `wrangler` commands against the user's primary account or modify tracked `.vercel/` / `wrangler.toml` with real IDs. Use isolated temp checkouts and `-Q` / `XDG_CONFIG_HOME` as documented in [docs/AGENT-OPS.md](docs/AGENT-OPS.md).
6. **Model Catalog Hygiene**:
   - Never add deprecated/retired model IDs. Always verify active vendor API model IDs against official documentation before editing `src/lib/providers/registry.ts` or defaults.
