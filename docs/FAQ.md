# ❓ 常见问题 (FAQ)

使用与部署 AI Relay 过程中的常见问题与排查方法。

---

## 1. 部署与环境配置

### Vercel 关联 Upstash for Redis 后 `/admin` 仍提示需要关联存储或保存失败？

1. **务必重新部署**：如果是部署之后才在 Vercel Dashboard → **Storage** 关联 Upstash for Redis，环境变量不会自动生效到旧部署，需进入 **Deployments** 点击 **Redeploy**。
2. 重新部署完成后打开 `/admin`，会自动进入首次初始化页生成并锁定随机访问密钥（无需提前手动填 `RELAY_API_KEY`）。
3. AI Relay 同时自动兼容新版 Vercel Marketplace 默认注入的 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 以及旧版 `KV_REST_API_URL` / `KV_REST_API_TOKEN`。

---

### Cloudflare Workers 一键部署后如何初始化？需要手动建表或配环境变量吗？

1. **无需手动配变量或建表**：通过 README 中的 Cloudflare Workers 一键部署按钮会自动新建并绑定 KV 与 D1，首次请求时自动幂等创建全部 D1 数据表。
2. **首次初始化**：部署上线后直接打开 `/admin`，复制页面自动生成的随机访问密钥并点击锁定，即可进入后台添加上游 API Key。
3. **验证服务状态**：添加上游 Provider Key 之前，`GET /health` 返回 `503 degraded` 属正常现象，请使用 `GET /health?liveness=1` 确认服务存活。

---

### 忘记首次初始化生成的访问密钥怎么办？

直接在你部署平台的环境变量/密钥设置中配置新的 `RELAY_API_KEY`（或单独配置 `RELAY_ADMIN_KEY`）并重新部署即可覆盖首次初始化的密钥：
- **Cloudflare Workers**：Worker 的 **Settings → Variables and Secrets** 添加 `RELAY_API_KEY` 并重新部署。
- **Vercel**：项目 **Settings → Environment Variables** 添加 `RELAY_API_KEY` 后点击 **Redeploy**。
- **Docker 自部署**：在 `.env` 或容器启动参数中传入 `-e RELAY_API_KEY=...` 并重启容器。
- **旧版 Cloudflare Pages + GitHub Actions 用户**：在仓库 **Settings → Secrets and variables → Actions** 更新 `RELAY_API_KEY` 后重新触发 `Deploy to Cloudflare Pages` 工作流。

---

### Docker / Coolify / Kubernetes 自部署容器为何需要 `/health?liveness=1`？

- 默认 `GET /health` 是**业务就绪探针 (Readiness)**：当尚未配置任何可用上游 Provider Key 时，它会返回 HTTP `503`（`status: "degraded"`），用于提醒外部监控当前无可用上游密钥。
- 如果刚启动全新容器、准备稍后进入 `/admin` 网页完成初始化，容器编排器的存活检查（Liveness）应使用 `GET /health?liveness=1`（仓库内置 `Dockerfile` 已默认配置）。该参数只要 Node.js 服务正常响应即返回 HTTP `200`（`status: "unconfigured"`），避免空密钥阶段被容器平台误判重启。

---

### 自部署单机磁盘模式与 PostgreSQL 模式如何选择与切换？

- **单机磁盘模式（推荐个人自部署）**：无需配置 `DATABASE_URL`，直接挂载 `/app/data` 目录（`docker compose up -d` 默认行为），所有配置与统计都会原子持久化到 `/app/data/kv-store.json`。
- **PostgreSQL 模式**：设置 `DATABASE_URL=postgresql://user:pass@host:5432/dbname`，服务启动时会自动创建所有数据表与索引，无需手动跑迁移脚本。
- **数据迁移**：在旧实例 `/admin` 导出「配置备份」与「统计备份」JSON，切换到新存储后再导入即可完整迁移。

---

## 2. 接口调用与鉴权

### 请求 `/v1/*` 返回 `401 Unauthorized`

1. 检查请求头是否携带了正确的访问密钥（首次初始化生成或 `RELAY_API_KEY`）：
   - OpenAI 格式：`Authorization: Bearer <your-access-key>`
   - Anthropic / 通用格式：`x-api-key: <your-access-key>`
2. 如需给不同设备/客户端分配多个独立调用密钥，无需重启或重部署，直接到 `/admin` → **辅助工具 → 运行时配置** 中添加额外客户端密钥（或用英文逗号在 `RELAY_API_KEY` 中分隔）。
3. 若使用的是后台签发的 `rk_temp.` 临时密钥，检查该密钥是否已过期、超出调用次数上限或请求了不在白名单内的模型。

---

### 请求返回 `504 Gateway Timeout`

- **Vercel / Cloudflare Serverless** 默认上游超时为 `50000ms`（50 秒），以便在 Serverless 60 秒硬限制前安全返回结构化 JSON 错误。
- **Docker / VPS 自部署与本地 CLI** 默认上游超时已自动放宽至 `300000ms`（5 分钟）；如需进一步调整或关闭超时限制，可直接到 `/admin` → **辅助工具 → 运行时配置** 中修改「上游超时时间」实时生效（设为 `0` 关闭限制），或设置环境变量 `RELAY_UPSTREAM_TIMEOUT_MS`。

---

## 3. 本地 CLI (`airelay`) 相关

### 运行 `airelay` 提示 `command not found`

1. 在项目根目录执行 `pnpm install && pnpm link --global`。
2. 确认 pnpm 全局 bin 目录已加入 `PATH`（可执行 `pnpm bin -g` 查看路径）。
3. 或者无需全局链接，直接在仓库内使用：`pnpm run local:start` 或 `pnpm run cli -- --help`。

---

### `airelay local:start` 默认监听哪个端口？配置文件在哪里？

- **默认监听地址**：`http://127.0.0.1:3147`（可通过 `--port` 与 `--host` 修改）。
- **本机配置目录**：`~/.ai-relay/config.json`（Profile）与 `~/.ai-relay/relay-config.json`（由 `airelay init` 生成）。
- **连通性自检**：
  ```bash
  curl http://127.0.0.1:3147/health
  airelay local:status
  ```

---

### `airelay login` 设备绑定失败或提示未配置密钥？

1. 远端实例只要已完成 `/admin` 首次初始化（或配置了 `RELAY_API_KEY` / `DEVICE_TOKEN_SECRET`）即可使用设备绑定。
2. 打开终端输出的 `/admin/local-relay/verify?code=...` 链接后，输入后台访问密钥点击批准，终端即可在 3 秒内自动完成绑定。
3. 若远端位于 Nginx / Caddy 等反向代理之后，可在 `/admin` → **辅助工具 → 运行时配置** 中填写「对外访问地址」（或设置 `DEPLOY_URL=https://你的域名`），并确保反代传递 `X-Forwarded-Proto` 与 `X-Forwarded-Host` 请求头。

---

## 4. 获取更多帮助

如果以上内容未能解决你的问题，欢迎前往 [GitHub Issues](https://github.com/MoyuFamily/ai-relay/issues) 提交反馈，并附上部署方式（Vercel / Cloudflare / Docker 自部署 / 本地 CLI）、复现步骤与脱敏后的错误日志。
