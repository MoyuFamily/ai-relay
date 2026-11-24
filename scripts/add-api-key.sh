#!/usr/bin/env bash
# ============================================================
# AI Relay — 快速添加 API Key 到当前关联的 Vercel 项目
# 用法: ./scripts/add-api-key.sh <provider> <api_key>
# 示例: ./scripts/add-api-key.sh xiaomi tp-xxxx
#       ./scripts/add-api-key.sh openai sk-xxxx
# 兼容 macOS 默认 bash 3.2 与 Linux bash 4+
# ============================================================

set -euo pipefail

PROVIDER="${1:-}"
API_KEY="${2:-}"

usage() {
  echo "用法: $0 <provider> <api_key>"
  echo ""
  echo "支持的 provider:"
  echo "  openai            — OpenAI (GPT 系列)"
  echo "  anthropic         — Anthropic (Claude 系列)"
  echo "  deepseek          — DeepSeek"
  echo "  xiaomi_sgp_coding — Xiaomi SGP (Coding Plan)"
  echo "  xiaomi            — Xiaomi (API Key)"
  echo "  xiaomi_coding     — Xiaomi (Coding Plan)"
  echo ""
  echo "示例:"
  echo "  $0 xiaomi tp-xxxx"
  echo "  $0 openai sk-proj-xxxx"
  exit 1
}

if [ -z "$PROVIDER" ] || [ -z "$API_KEY" ]; then
  usage
fi

case "$PROVIDER" in
  openai)
    ENV_KEY="OPENAI_KEYS"
    TEST_MODEL="gpt-6-luna"
    TEST_URL="https://api.openai.com/v1/chat/completions"
    DISPLAY="OpenAI"
    FMT="openai"
    ;;
  anthropic)
    ENV_KEY="CLAUDE_KEYS"
    TEST_MODEL="claude-haiku-5-5"
    TEST_URL="https://api.anthropic.com/v1/messages"
    DISPLAY="Anthropic (Claude)"
    FMT="anthropic"
    ;;
  google|gemini)
    ENV_KEY="GEMINI_KEYS"
    TEST_MODEL="gemini-4-hydrogen"
    TEST_URL="https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    DISPLAY="Google Gemini"
    FMT="openai"
    ;;
  deepseek)
    ENV_KEY="DEEPSEEK_KEYS"
    TEST_MODEL="deepseek-flash"
    TEST_URL="https://api.deepseek.com/v1/chat/completions"
    DISPLAY="DeepSeek"
    FMT="openai"
    ;;
  xiaomi_sgp_coding)
    ENV_KEY="XIAOMIMIMO_SGP_CODING_KEYS"
    TEST_MODEL="mimo-v2.6-pro"
    TEST_URL="https://token-plan-sgp.xiaomimimo.com/v1/chat/completions"
    DISPLAY="Xiaomi SGP (Coding Plan)"
    FMT="azure"
    ;;
  xiaomi)
    ENV_KEY="XIAOMI_KEYS"
    TEST_MODEL="mimo-v2.6-flash"
    TEST_URL="https://api.xiaomimimo.com/v1/chat/completions"
    DISPLAY="Xiaomi (API Key)"
    FMT="openai"
    ;;
  xiaomi_coding)
    ENV_KEY="XIAOMI_CODING_KEYS"
    TEST_MODEL="mimo-v2.6-pro"
    TEST_URL="https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
    DISPLAY="Xiaomi (Coding Plan)"
    FMT="openai"
    ;;
  *)
    echo "❌ 不支持的 provider: $PROVIDER"
    usage
    ;;
esac

echo "🔑 添加 $DISPLAY API Key"
echo "   Env: $ENV_KEY"
echo "   Key: ${API_KEY:0:8}...${API_KEY: -4}"
echo ""

TMP_RESP="$(mktemp)"
TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_RESP" "$TMP_ENV"' EXIT

# ── Step 1: 测试 Key 可用性 ──────────────────────────────
echo "📡 测试 Key 可用性..."

if [ "$FMT" = "anthropic" ]; then
  HTTP_CODE=$(curl -s -o "$TMP_RESP" -w "%{http_code}" \
    "$TEST_URL" \
    -H "x-api-key: $API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -d "{\"model\":\"$TEST_MODEL\",\"max_tokens\":5,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" 2>/dev/null || echo "000")
elif [ "$FMT" = "azure" ]; then
  HTTP_CODE=$(curl -s -o "$TMP_RESP" -w "%{http_code}" \
    "$TEST_URL" \
    -H "api-key: $API_KEY" \
    -H "content-type: application/json" \
    -d "{\"model\":\"$TEST_MODEL\",\"max_tokens\":5,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" 2>/dev/null || echo "000")
else
  HTTP_CODE=$(curl -s -o "$TMP_RESP" -w "%{http_code}" \
    "$TEST_URL" \
    -H "Authorization: Bearer $API_KEY" \
    -H "content-type: application/json" \
    -d "{\"model\":\"$TEST_MODEL\",\"max_tokens\":5,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" 2>/dev/null || echo "000")
fi

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Key 可用！(HTTP $HTTP_CODE)"
elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  echo "❌ Key 无效 (HTTP $HTTP_CODE)"
  echo "   响应: $(head -c 200 "$TMP_RESP" 2>/dev/null || true)"
  exit 1
elif [ "$HTTP_CODE" = "429" ]; then
  echo "⚠️  Key 被限流 (HTTP 429)，但 key 本身可能是有效的，继续添加..."
elif [ "$HTTP_CODE" = "000" ]; then
  echo "❌ 网络连接失败"
  exit 1
else
  echo "⚠️  未知状态码 $HTTP_CODE"
  echo "   响应: $(head -c 200 "$TMP_RESP" 2>/dev/null || true)"
  read -r -p "   是否继续添加？(y/N) " REPLY
  case "$REPLY" in
    [Yy]*) ;;
    *) exit 1 ;;
  esac
fi

# ── Step 2: 获取当前 Vercel 环境变量 ─────────────────────
echo ""
echo "📦 获取 Vercel 环境变量..."
VERCEL_TOKEN_ARGS=()
if [ -n "${VERCEL_TOKEN:-}" ]; then
  VERCEL_TOKEN_ARGS=(--token "$VERCEL_TOKEN")
fi

EXISTING=$(npx vercel env pull "$TMP_ENV" --yes "${VERCEL_TOKEN_ARGS[@]}" >/dev/null 2>&1 && grep "^${ENV_KEY}=" "$TMP_ENV" | cut -d'=' -f2- | tr -d '"' || echo "")

# ── Step 3: 检查 Key 是否已存在 ──────────────────────────
if printf '%s' "$EXISTING" | grep -Fq "$API_KEY"; then
  echo "⚠️  该 Key 已存在于 $ENV_KEY 中，跳过"
  exit 0
fi

# ── Step 4: 追加新 Key ──────────────────────────────────
if [ -n "$EXISTING" ]; then
  NEW_VALUE="${EXISTING},${API_KEY}"
else
  NEW_VALUE="$API_KEY"
fi

echo "📝 更新 Vercel 环境变量 $ENV_KEY..."
npx vercel env rm "$ENV_KEY" production --yes "${VERCEL_TOKEN_ARGS[@]}" >/dev/null 2>&1 || true
printf '%s' "$NEW_VALUE" | npx vercel env add "$ENV_KEY" production "${VERCEL_TOKEN_ARGS[@]}" >/dev/null

echo ""
echo "✅ Done! $DISPLAY key 已添加"
echo "   $ENV_KEY 现在有 $(printf '%s' "$NEW_VALUE" | tr ',' '\n' | wc -l | tr -d ' ') 个 key"
echo ""
echo "🚀 部署以激活: npx vercel --prod --yes"
