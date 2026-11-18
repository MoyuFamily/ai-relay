#!/usr/bin/env bash
# AI Relay — 本地 CI 自检脚本
# 用法: bash scripts/ci-local.sh
# 会依次跑: install → lint → type-check → test → build

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }
step() { echo -e "\n${YELLOW}▶ $1${NC}"; }

if command -v pnpm >/dev/null 2>&1; then
  PKG_MGR="pnpm"
else
  PKG_MGR="npm"
fi

# ── Step 1: Install ──
step "Installing dependencies (${PKG_MGR})..."
if [ "$PKG_MGR" = "pnpm" ]; then
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
else
  npm ci 2>/dev/null || npm install
fi
pass "Dependencies installed"

# ── Step 2: Lint ──
step "Running lint..."
"$PKG_MGR" run lint
pass "Lint passed"

# ── Step 3: Type Check ──
step "Running type-check..."
"$PKG_MGR" run type-check
pass "Type check passed"

# ── Step 4: Tests ──
step "Running tests..."
"$PKG_MGR" run test
pass "Tests passed"

# ── Step 5: Build ──
step "Running build..."
DATABASE_URL="${DATABASE_URL:-postgresql://localhost:5432/dummy}" "$PKG_MGR" run build
pass "Build passed"

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}  All CI stages passed! ✓${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"
