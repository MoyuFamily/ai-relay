# ============================================================
# AI Relay — Multi-Stage Self-Hosted Production Dockerfile
# ============================================================
# Supports two storage modes out of the box:
#   1. Zero-dependency persistent disk mode (default):
#      Mounts `/app/data` (`RELAY_DATA_DIR=/app/data`) -> `kv-store.json`
#   2. Multi-instance PostgreSQL mode:
#      Pass `DATABASE_URL=postgresql://...` (tables auto-created on boot)
# ============================================================

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

# ── Stage 1: Install dependencies ────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build standalone Next.js server ─────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG COMMIT_SHA=""
ENV COMMIT_SHA=${COMMIT_SHA}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_STANDALONE=1
RUN pnpm run build

# ── Stage 3: Minimal non-root production runner ──────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV RELAY_DATA_DIR="/app/data"

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/data \
  && chown -R nextjs:nodejs /app/data

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health?liveness=1').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
