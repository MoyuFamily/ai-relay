# ❓ 常见问题 (FAQ)

使用与部署 AI Relay 过程中的常见问题与排查方法。

---

## 1. 部署与环境配置

### Cloudflare Pages 部署后登录 `/admin` 提示 `Invalid API key`

**原因：** GitHub Actions Secrets 未配置或尚未同步到 Cloudflare Pages 项目。

**解决方案：**
1. 进入你的 GitHub Fork 仓库 → **Settings → Secrets and variables → Actions → Repository secrets**（注意不是 Environment secrets）。
2. 确认已设置 `RELAY_API_KEY`（以及可选的 `RELAY_ADMIN_KEY`）。
3. 进入 **Actions → Deploy to Cloudflare Pages → Run workflow** 手动触发一次部署，工作流会自动将密钥同步至 Cloudflare。

---

### Docker / Coolify / Kubernetes 自部署容器为何需要 `/health?liveness=1`？

- 默认 `GET /health` 是**业务就绪探针 (Readiness)**：当尚未配置任何可用上游 Provider Key 时，它会返回 HTTP `503`（`status: "degraded"`），用于提醒外部负载均衡或监控当前无可用上游密钥。
- 如果刚启动全新容器、准备稍后进入 `/admin` 网页添加密钥，容器编排器的存活检查（Liveness）应使用 `GET /health?liveness=1`（仓库内置 `Dockerfile` 已默认配置）。该参数只要 Node.js 服务正常响应即返回 HTTP `200`（`status: "unconfigured"`），避免空密钥阶段被容器平台误判重启。

---

### 自部署单机磁盘模式与 PostgreSQL 模式如何选择与切换？

- **单实例部署（推荐个人 / 小团队）**：无需配置 `DATABASE_URL`，直接挂载 `/app/data` 目录（`docker compose up -d` 默认行为），所有配置与统计都会原子持久化到 `/app/data/kv-store.json`。
- **多副本高可用部署**：设置 `DATABASE_URL=postgresql://user:pass@host:5432/dbname`，服务启动时会自动创建所有数据表与索引，无需手动跑迁移脚本。
- **数据迁移**：在旧实例 `/admin` 导出「配置备份」与「统计备份」JSON，切换到新存储后再导入即可完整迁移。

---

## 2. 接口调用与鉴权

### 请求 `/v1/*` 返回 `401 Unauthorized`

1. 检查请求头是否携带了正确的 `RELAY_API_KEY`：
   - OpenAI 格式：`Authorization: Bearer <your-relay-api-key>`
   - Anthropic / 通用格式：`x-api-key: <your-relay-api-key>`
2. 若配置了多个客户端密钥（英文逗号分隔，如 `RELAY_API_KEY=key1,key2`），确认客户端使用的是其中之一且不含多余空格。
3. 若使用的是后台签发的 `rk_temp.` 临时密钥，检查该密钥是否已过期、超出调用次数上限或请求了不在白名单内的模型。

---

### 请求返回 `504 Gateway Timeout`

- 默认上游请求超时为 `50000ms`（50 秒），这是为了在 Vercel Serverless 60 秒硬限制前安全返回结构化 JSON 错误。
- 如果你在 **Docker / VPS 自部署** 或 **本地 CLI** 环境下调用深度推理模型（耗时超过 50 秒），可以通过环境变量调大或关闭超时限制：
  ```bash
  RELAY_UPSTREAM_TIMEOUT_MS=300000   # 设为 5 分钟，或设为 0 关闭超时限制
  ```

---

## 3. 本地 CLI (`airelay`) 相关

### 运行 `airelay` 提示 `command not found`

1. 在项目根目录执行 `pnpm install && npm link`。
2. 确认 npm 全局 bin 目录已加入 `PATH`：`export PATH="$(npm config get prefix)/bin:$PATH"`。
3. 或者无需全局链接，直接在仓库内使用：`pnpm run local:start` 或 `pnpm run cli -- --help`。

---

### `airelay local:start` 默认监听哪个端口？配置文件在哪里？

- **默认监听地址**：`http://127.0.0.1:3147`（可通过 `--port` 与 `--host` 修改）。
- **本机配置目录**：`~/.ai-relay/config.json`。
- **连通性自检**：
  ```bash
  curl http://127.0.0.1:3147/health
  airelay local:status
  ```

---

### `airelay login` 设备绑定失败或提示未配置密钥？

1. 云端或自部署服务端必须配置环境变量 `DEVICE_TOKEN_SECRET`（可用 `openssl rand -hex 32` 生成），用于安全哈希存储设备令牌。
2. 打开终端输出的 `/admin/local-relay/verify?code=...` 链接后，输入后台的 `RELAY_ADMIN_KEY`（或 `RELAY_API_KEY`）点击批准，终端即可在 3 秒内自动完成绑定。

---

## 4. 获取更多帮助

如果以上内容未能解决你的问题，欢迎前往 [GitHub Issues](https://github.com/MoyuFamily/ai-relay/issues) 提交反馈，并附上部署方式（Vercel / Cloudflare / Docker 自部署 / 本地 CLI）、复现步骤与脱敏后的错误日志。
