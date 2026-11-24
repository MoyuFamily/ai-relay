# AI Relay CLI (`airelay`) 使用指南

`airelay` 是 AI Relay 的本机轻量运行时工具。它默认在本机启动 `http://127.0.0.1:3147`，复用与云端完全一致的 Relay 核心转发引擎（多 Key 轮换、Fallback 链、模型别名、OpenAI ↔ Anthropic 跨协议转换），让 Codex、Claude Code、Cursor 等本地工具直接从本机发起上游请求，不消耗 Vercel / Cloudflare 的 Serverless 额度。

---

## 1. 安装与验证

```bash
git clone https://github.com/MoyuFamily/ai-relay.git
cd ai-relay
pnpm install

# 注册全局 airelay 命令（也可以直接使用 pnpm run cli -- <command>）
pnpm link --global

# 验证安装
airelay --help
```

> 无需全局链接也可以直接通过仓库脚本运行：`pnpm run local:start` 或 `pnpm run cli -- init`。

---

## 2. 命令一览

| 命令 | 说明 |
|------|------|
| `airelay init` | 交互式初始化向导，快速生成 `~/.ai-relay/relay-config.json` |
| `airelay login [cloud-url]` | 通过设备授权码流程绑定云端或自部署的 AI Relay 实例（可选） |
| `airelay local:start` | 启动本机 HTTP 转发服务（默认监听 `127.0.0.1:3147`） |
| `airelay local:status` | 查看本机设备配置、监听地址与有效配置来源 |
| `airelay agent:install <agent> [--dry-run]` | 配置本地编程工具（支持 `codex`、`claude-code`；Codex 会自动备份到 `~/.ai-relay/backups/`） |
| `airelay agent:doctor <agent>` | 检查 `codex` 或 `claude-code` 配置是否正确指向本地 Relay |
| `airelay agent:uninstall <agent> [--dry-run]` | 移除本地 Relay 配置块 |

`airelay local:start` 支持的参数：
- `-c, --config <source>`：指定本地 JSON 配置文件路径或远程快照 URL
- `-p, --port <port>`：自定义监听端口（默认 `3147`）
- `--host <host>`：自定义监听地址（默认 `127.0.0.1`；若设为 `0.0.0.0` 请务必配置 `RELAY_API_KEY`）

---

## 3. 四种配置来源（按优先级从高到低）

`airelay local:start` 会按以下顺序自动解析配置来源：

### 方式 1：命令行显式指定（`--config`）

```bash
cat > relay-config.json << 'EOF'
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
      "apiKeys": ["sk-your-openai-key"]
    },
    "anthropic": {
      "name": "anthropic",
      "displayName": "Anthropic",
      "baseUrl": "https://api.anthropic.com/v1",
      "modelPrefixes": ["claude-"],
      "headerFormat": "anthropic",
      "envKeyField": "CLAUDE_KEYS",
      "apiKeys": ["sk-ant-your-claude-key"]
    }
  },
  "modelAliases": {
    "aliases": { "fast": "gpt-6-luna" },
    "hidden": []
  }
}
EOF

airelay local:start --config ./relay-config.json
```

### 方式 2：环境变量指定配置源（`RELAY_CONFIG_PATH` / `RELAY_CLOUD_URL`）

```bash
export RELAY_CONFIG_PATH=./relay-config.json
airelay local:start
```

### 方式 3：本地默认配置文件（`~/.ai-relay/relay-config.json`）

运行 `airelay init` 可通过交互式向导生成 `~/.ai-relay/relay-config.json`，之后直接执行 `airelay local:start` 即可自动加载。

### 方式 4：绑定云端 / 自部署实例同步配置（推荐已有后台用户）

远端实例只要配置了 `RELAY_API_KEY`（或单独设置了 `DEVICE_TOKEN_SECRET`）即可开箱支持设备绑定：

```bash
# 1. 发起设备绑定，按终端提示打开浏览器并输入 Admin Key 批准设备
airelay login https://your-relay.example.com

# 2. 启动本机服务（每 30 秒检查配置版本并热更新，每 60 秒上报心跳与聚合用量）
airelay local:start
```

> 默认自动同步上游 Provider Key；如服务端希望禁止向本地设备下发明文 Key，可直接在 `/admin` → **辅助工具 → 运行时配置** 中关闭「允许本地 CLI 同步上游密钥」（或设置环境变量 `ALLOW_LOCAL_KEY_SYNC=false`）。也可以访问后台的 `/admin/local-relay` 页面查看当前在线设备列表与最近心跳时间。

### 方式 5：纯环境变量内联 Key（零配置文件最快启动）

自动扫描环境变量中的 `OPENAI_KEYS`、`CLAUDE_KEYS`、`DEEPSEEK_KEYS`、`XIAOMI_KEYS` 等 `*_KEYS` 变量（支持逗号分隔多 Key 轮换与对应的 `*_BASE_URL`）：

```bash
export OPENAI_KEYS="sk-key-1,sk-key-2"
export CLAUDE_KEYS="sk-ant-key-1"
airelay local:start
```

---

## 4. 本地目录与安全模型

- **Profile 路径**：`~/.ai-relay/config.json`（权限 `0600`，保存 `deviceName`、`listenHost`、`listenPort` 以及可选的 `cloudUrl` / `deviceId` / `deviceToken`）。
- **备份目录**：`~/.ai-relay/backups/`（执行 `agent:install` 修改客户端配置前自动生成备份）。
- **请求鉴权**：
  - 当监听回环地址（`127.0.0.1` / `localhost` / `::1`）且未设置 `RELAY_API_KEY` 时，允许本机工具免密或使用任意占位 Key 直接调用。
  - 若设置了 `RELAY_API_KEY`，或将 `--host` 暴露到非回环网卡（如 `0.0.0.0`），服务端会强制校验 `Authorization: Bearer <RELAY_API_KEY>` 或 `X-API-Key`。
- **云端同步安全**：`/api/local/config/version` 与 `/api/local/config/snapshot` 均要求有效的设备令牌（`deviceToken`）或 Admin 密钥鉴权，且设备授权码仅允许一次性换取令牌。

---

## 5. 本地接口验证

默认端口为 `3147`：

```bash
# 1. 健康检查
curl http://127.0.0.1:3147/health

# 2. 查看可用模型列表
curl http://127.0.0.1:3147/v1/models

# 3. 测试 OpenAI Chat Completions
curl http://127.0.0.1:3147/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-6-luna","messages":[{"role":"user","content":"Hello!"}]}'

# 4. 测试 Anthropic Messages
curl http://127.0.0.1:3147/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-5-5","max_tokens":512,"messages":[{"role":"user","content":"Hello!"}]}'

# 5. 测试 OpenAI Responses API
curl http://127.0.0.1:3147/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-6.2-sol","input":"Hello!"}'
```

---

## 6. 接入本地 AI 编程工具

### Codex CLI（自动配置）

```bash
# 预览变更
airelay agent:install codex --dry-run

# 写入 ~/.codex/config.toml 并自动备份原文件
airelay agent:install codex

# 诊断配置状态
airelay agent:doctor codex
```

### Claude Code / OpenAI SDK 工具（环境变量接入）

```bash
# Claude Code
export ANTHROPIC_BASE_URL="http://127.0.0.1:3147"
export ANTHROPIC_API_KEY="local-relay"

# 任意兼容 OpenAI SDK 的客户端
export OPENAI_BASE_URL="http://127.0.0.1:3147/v1"
export OPENAI_API_KEY="local-relay"
```

---

## 7. Shell 自动补全

仓库内置了 Bash 与 Zsh 补全脚本：

```bash
# Zsh
echo "source $(pwd)/cli/completions.zsh" >> ~/.zshrc
source ~/.zshrc

# Bash
echo "source $(pwd)/cli/completions.sh" >> ~/.bashrc
source ~/.bashrc
```

卸载全局链接：

```bash
npm unlink -g airelay
```
