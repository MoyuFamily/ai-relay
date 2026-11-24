# 发布流程 / Release Flow

AI Relay 采用**单主干 (`main`) 直接发布**流程，不再维护 `pre-release` 中间分支或发布门禁，维护者与 Fork 用户完全共用同一套约定。

```text
feature/* (或小改动直接提交) ──▶ main ──▶ CI 验证 & 自动部署 (Vercel / Cloudflare / GHCR)
```

## 日常开发与发布

1. **常规开发**：开短生命周期分支（如 `feat/xxx`、`fix/xxx`），向 `main` 提 PR（或维护者小改动自测后直接推送 `main`）。
2. **CI 验证**：[ci.yml](../.github/workflows/ci.yml) 在每次 PR / push 到 `main` 时通过单 Job 依次执行 `lint → type-check → test → build`。
3. **自动部署**：合并或推送到 `main` 后，各平台自动发布：
   - **Vercel**：自动从 `main` 构建上线。
   - **Cloudflare Pages**：[deploy-cf.yml](../.github/workflows/deploy-cf.yml) 自动同步 D1/KV、密钥并部署到 `main` 生产环境（也可手动 `workflow_dispatch` 在任意分支部署 Preview）。
   - **Docker (GHCR)**：[docker-publish.yml](../.github/workflows/docker-publish.yml) 自动构建并推送 `latest` 多架构镜像。

## 版本号发布（可选）

需要对外标记一个正式版本时：

```bash
# 1. 更新 package.json 中的 version 与 CHANGELOG.md，提交到 main
git add package.json CHANGELOG.md
git commit -m "chore(release): v2.16.0"
git push origin main

# 2. 打 tag 推送（自动触发 GHCR 语义化版本镜像 tag，如 :2.16.0 / :2.16）
git tag v2.16.0
git push origin v2.16.0
```

> **从旧 `pre-release` 流程迁移提醒：**
> 如果之前在 Vercel Dashboard、Cloudflare Pages Dashboard 或 GitHub Actions Variables 中将生产分支切到了 `pre-release`，切回 `main`（并删除旧的 `CLOUDFLARE_DEPLOY_BRANCH` / `CLOUDFLARE_PAGES_PRODUCTION_BRANCH` 变量）即可。
