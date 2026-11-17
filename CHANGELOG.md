# 更新日志

本文档记录 AI Relay 的重要版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added
- **自部署服务完整支持（Docker / VPS）**：
  - 新增零外部依赖的本地持久化磁盘存储适配器 `FileKVAdapter`（内存 O(1) 读取 + `0600` 临时文件原子落盘），单机部署开箱即用。
  - 新增多副本安全的 PostgreSQL 存储适配器 `PostgresKVAdapter` 与关系型统计存储 `PostgresUsageStorage`，首次连接幂等自动建表，无需手动执行迁移脚本。
  - 新增自部署后台调度器 `self-hosted-scheduler`（通过 Next.js `instrumentation.ts` 自动启动），内置周期性上游健康探针、每日 UTC 报表聚合、过期数据清理与按时区投递的 Webhook 日报。
  - 新增多阶段生产级 `Dockerfile`、`docker-compose.yml`（支持默认磁盘模式与 `--profile postgres` 模式）及 `/health?liveness=1` 容器存活探针。
- **本地 CLI (`airelay`) 完整闭环**：打通本机 `/v1/chat/completions`、`/v1/messages`、`/v1/messages/count_tokens`、`/v1/responses` 与 `/v1/models` 全协议转发能力，补齐 `/admin/local-relay` 设备管理与授权验证鉴权交互。

### Fixed
- **多平台存储稳定性加固**：修复 `KVRequestLogStore` 非标准 `scan` 调用与数值型标志位解析问题；为 `CFKVAdapter` 增加单 Key 互斥锁、6 并发管道队列与 `<60s` TTL 安全钳制；修复 `worker.ts` D1 配额清理 SQL 条件与 Cloudflare D1 日报聚合缺失问题；防止瞬时 KV 超时用空值污染内存密钥池缓存。
- **网关安全与协议细节修复**：移除临时密钥签名的硬编码回退密钥并全面采用常量时间密钥比对；支持动态读取环境变量的并发闸门与 CORS 配置（补齐 `X-API-Key` / `Anthropic-*` 跨域头）；为所有 `/v1/*` 端点补齐 `Content-Length` O(1) 预检、多模态 Base64 体积校验、错误请求日志记录以及重试前上游响应流显式释放。

### Changed
- **CI 与文档体系重构**：在 GitHub Actions 与 `scripts/ci-local.sh` 中启用完整单元测试门禁，补齐 Cloudflare Pages 部署脚本缺失的环境变量同步，清理过时设计草稿并重写全项目架构与部署文档。

## [2.13.0] - 2026-06-11

### Added
- **Anthropic Messages API 支持**：新增 `/v1/messages` 端点，Claude CLI / Claude Desktop App 可直接对接 Relay，无需转换协议。支持流式和非流式响应。

### Fixed
- **上游 /v1 路径规范化**：修复 bare-origin Claude Provider（无 `/v1` 后缀）请求路径拼接错误的问题。
- **Claude Desktop 导出修复**：修复 Admin 后台 Claude App 配置导出使用无效深度链接的问题，改为复制原始配置。

### Changed
- **Cloudflare Free 性能优化**：精简每次请求的 CPU 开销，确保在 Cloudflare Free 免费 CPU 限制内稳定运行。

## [2.12.0] - 2026-06-08

### Added
- **CcSwitch 深度链接导出**：支持将 Provider 配置导出为 CcSwitch 兼容的深度链接格式，方便在 Cherry Studio 等客户端中一键导入。
- **NewAPI 频道连接 JSON 导入**：支持导入 NewAPI 的频道连接 JSON 格式，拓宽数据源兼容性。
- **上游请求超时配置**：新增 `RELAY_UPSTREAM_TIMEOUT_MS` 环境变量，支持自定义上游 Provider 请求超时时间，避免长时间挂起。

### Changed
- **发版流程规范化**：新增 pre-release CI 工作流与发版流程文档（`docs/RELEASE-FLOW.md`）。

## [2.11.1] - 2026-06-07

### Added
- **FAQ 文档**：新增常见问题文档 `docs/FAQ.md`，并在 README 中添加链接，方便用户自助排查问题。

### Fixed
- **Cloudflare 部署锚点导航**：修复 Cloudflare 部署详情 `<details>` 标签缺少 id 属性导致锚点链接无法跳转的问题。

### Changed
- **CI 手动触发部署**：启用 Cloudflare Pages 工作流的手动触发功能（`workflow_dispatch`）。

## [2.11.0] - 2026-06-04

### Added
- **Cherry Studio 链接导入 Provider**：支持通过 Cherry Studio 链接一键导入 Provider 配置，简化多 Provider 管理流程。
- **已有 Key 选择支持**：自定义 Provider 编辑弹窗中支持选择已有 API Key，无需重复输入。
- **Key 数量指示器**：Provider 编辑 UX 优化，展示当前 Key 数量便于管理。
- **Provider 自定义 User-Agent**：支持为每个 Provider 单独配置 User-Agent，避免上游服务商因默认 SDK 标识而封禁请求。
- **Provider 默认模型测试**：API Key 测试时自动使用 Provider 特定的默认模型。
- **精确模型优先级路由**：支持精确匹配模型名称的优先级路由，以及 Hash Key 解析。
- **Provider 导入暂存草稿**：导入 Provider 配置时先暂存为草稿，确认后再保存。
- **模型批量删除**：支持批量移除模型列表，提升管理效率。
- **User-Agent 透传与清理**：将客户端 User-Agent 透传至上游 Provider，清理 fallback 引用中的冗余字段。

### Fixed
- **上游请求重试与 User-Agent 兼容**：上游请求失败时使用浏览器兼容的 User-Agent 重试。
- **Provider Key 测试重试与错误处理**：改进 Key 测试的重试逻辑和错误消息展示。
- **NewAPI 导入 Base URL 与模型发现回退**：修复 NewAPI 导入时的 Base URL 拼接和模型发现 fallback 逻辑。
- **UI 错误消息展示**：改进上游返回 HTML 响应时的错误消息展示与摘要处理。

## [2.10.0] - 2026-06-03

### Added
- **可配置 API Key 最小长度**：新增 `RELAY_API_KEY_MIN_LENGTH` 环境变量，支持自定义 API Key 最小长度要求。
- **客户端 User-Agent 透传**：将客户端 User-Agent 转发至上游 Provider，提升请求兼容性。

### Changed
- **流式用量跟踪性能优化**：跳过流式传输中的逐 chunk JSON.parse，降低 CPU 开销。

### Fixed
- **D1 UUID 恢复**：修复重新部署时 D1 数据库已存在导致的 UUID 恢复问题。
- **KV Namespace ID 恢复**：修复重新部署时 KV namespace title 已存在导致的 ID 恢复问题。
- **上游 User-Agent 清理**：清理上游请求中的 User-Agent，避免 Provider 因 SDK 标识而封禁。
- **中性 SDK User-Agent 默认值**：默认 User-Agent 不再暴露 Relay 身份。
- **上游非 JSON 响应解析**：改进 Provider Key 测试时对非 JSON 响应体的错误解析。

## [2.9.0] - 2026-06-01

### Added
- **D1 per-key 错误统计**：新增每个 API Key 的错误统计功能，通过 D1 数据库记录各 Key 的错误详情，便于定位问题 Key。

### Changed
- **Vercel 部署跳过 Cloudflare 上下文**：Vercel 环境不再加载 Cloudflare 上下文，避免不必要的环境检测开销。
- **同步化 Cloudflare 环境访问**：重构 CF 环境检测逻辑为同步模式，优化静态路由预渲染，提升 Cloudflare Pages 部署性能。
- **重构部署脚本**：优化 GitHub Actions 部署工作流的 node 脚本部分。

### Fixed
- **Cloudflare 异步 fallback 兼容**：修复 Admin 配置和报表存储模块的 CF 环境解析，支持异步 fallback 机制。

## [2.8.0] - 2026-05-31

### Added
- **Cloudflare Pages 全自动部署**：支持通过 GitHub Actions 一键部署到 Cloudflare Pages，自动完成 D1 数据库创建、KV namespace 创建、D1 migrations 执行、环境变量配置和资源绑定，无需手动操作。
- **Cloudflare D1 + KV 存储**：CF 部署使用 Cloudflare D1（用量统计）+ KV（配置数据），自动检测 CF 环境并切换存储后端。
- **Cloudflare Cron 定时任务**：通过 CF Pages Cron Triggers + `worker.ts` 的 `scheduled()` handler 执行健康探测和用量聚合，支持 `DEPLOY_URL` 变量配置。
- **`_routes.json` CDN 静态资源路由**：CF 部署自动生成 `_routes.json`，静态资源直接从 CDN 边缘节点分发，减少 Worker 调用。
- **Scheduled GitHub Actions Workflow**：新增定时 GitHub Actions 工作流，定期执行 Provider 健康探测和用量聚合请求。
- **Favicon 迁移与 Metadata 配置**：favicon 迁移至 `public/` 目录，更新 metadata 配置以适配 CF Pages 部署。
- **CF 环境感知 Setup UI**：Admin 后台自动检测 Cloudflare 环境，展示平台专属配置界面。

### Changed
- **升级至 Next.js 15 + React 19**：全面升级框架版本，使用 `@opennextjs/cloudflare` 替代已废弃的 `@cloudflare/next-on-pages` 构建方案。(#18)
- **CF Secret 部署重构**：Cloudflare Pages secret 部署改为动态同步模式，自动从 GitHub Secrets 或 Project Vars 同步所有环境变量。
- **KV 操作并行化**：Admin 配置中 Key 和 Fallback 恢复的 KV 操作改为并行执行，提升加载性能。
- **用量存储初始化异步化**：使用存储初始化和 CF 环境检测改为异步模式，适配可靠异步上下文。
- **KV 不可用容错优化**：KV 未配置时改为抛出错误而非返回空备份数据，提升错误可诊断性。

### Fixed
- **无限 Keys 拉取 Bug**：修复 Key 池获取时可能出现的无限循环问题。
- **CF 环境日报为空**：修复 Cloudflare 部署环境下每日用量报告数据为空的问题。
- **KV 服务不可用韧性**：改善 KV 服务不可用时的容错能力，增加 CF 专属 UI 回退展示。
- **Key Recorder 失败问题**：修复 Key 记录器在特定场景下的失败问题。
- **CF 部署工作流稳定性**：修复 wrangler KV namespace 查找、D1/KV 资源配置、sed 命令转义等多个 CI 工作流问题。(#16, #17)

## [2.7.0] - 2026-05-29

### Added
- **概率性用量采样**：实现 `RELAY_KV_USAGE_SAMPLE_RATE` 采样机制，支持按概率写入用量统计，大幅降低 KV 写入频率（采样率 0.1 时约 10% 写入），配合批量写入可将请求与 KV 读写比降至 ~1:1。
- **选择性禁用全局计数器**：支持通过配置禁用全局计数器更新，进一步减少 KV 写入。

### Changed
- **Provider 添加 UX 优化**：改进 Admin 后台 Provider 添加流程的用户交互体验。
- **README 描述优化**：补充 KV 读写比例说明和 Upstash 免费层信息（每月 50 万次 KV 操作）。

## [2.6.0] - 2026-05-28

### Added
- **Anthropic Messages API 中继**：新增 `/v1/messages` 端点，支持 Claude 原生 Anthropic Messages 协议，Claude 客户端可直接将 `base_url` 指向 Relay 使用原生协议通信。只路由到 `headerFormat: anthropic` 的供应商，上游 Key 使用 `CLAUDE_KEYS` 或 Admin 后台配置的 Claude 供应商密钥。

## [2.5.0] - 2026-05-27

### Added
- **智能路由引擎**：新增延迟感知路由策略，支持延迟优先 / 成本优先 / 可用性优先三种模式，实时追踪 Provider 延迟并自动选择最优路径。(#11)
- **智能路由 Tab**：Admin 后台新增 Routing 管理页面，可视化路由策略配置、流量分配和 Provider 健康状态。
- **API Key 安全管理**：Admin 后台新增 Security Tab，Key 遮掩展示、健康指示、轮换告警、审计日志，提升密钥管理安全性。(#11)
- **路由 API**：新增 `/api/admin/routing` 和 `/api/admin/security` 管理接口。

### Fixed
- **Edge 兼容性**：替换 Node.js crypto 为 Edge 兼容的 FNV-1a 双哈希实现。
- **代码审查问题修复**：修复 PR #11 代码审查发现的 19 个问题。

## [2.4.0] - 2026-05-27

### Added
- **Responses API 支持**：新增 `/v1/responses` 端点，兼容 OpenAI Responses API，支持流式和非流式请求，复用现有 auth、rate limit 和 usage tracking 机制。(#9, #10)
- **错误体验系统**：新增 Toast 通知、ErrorBoundary 全局捕获、ErrorDetailPanel 详情展示，统一前端错误处理和用户反馈。
- **移动端 Admin 适配**：新增 BottomNav 底部导航栏、BottomSheet 底部弹窗，Admin 后台移动端响应式布局优化。
- **用量批量写入优化**：新增 Ring Buffer + Periodic Flush 机制，减少 KV 写入频率，提升高并发场景下的用量统计性能。

### Fixed
- **用量统计漏记**：修复批量写入模式下用量计数偏少的问题。
- **流式响应正确性**：修复流式请求中 chunk 处理的边界问题。
- **UI 布局问题**：修复多处移动端布局溢出和错位。

## [2.3.2] - 2026-05-26

### Added
- **Key 添加测试**：单个 Key 输入时支持"测试并添加"，提交前自动验证 Key 是否可用。

### Fixed
- **移动端 UI 溢出**：修复 Token 趋势图表 Provider 筛选器和 Fallback Chain 在窄屏下的溢出问题。
- **名称截断**：Provider 名称限制 8 字符，Model Select 在窄屏自适应截断，避免遮挡。

### Changed
- Provider 名称截断策略优化。
- 模型选择器最小宽度保障。

## [2.3.1] - 2026-05-26

### Changed
- 更新 README 和 Homepage 版本号至 v2.3.0。
- 补充 v2.3.0 新功能到文档特性列表：Provider 引导、模型别名管理、优先级规则、用量监控、上游模型发现。
- 更新 Admin 后台功能列表，体现最新能力。

## [2.3.0] - 2026-05-26

### Added
- 新增 Provider CRUD 引导流程（Stepper 三步式：选模板 → 配密钥 → 测试保存），支持 8 个预置模板和自定义 Provider。
- 新增模型别名管理能力，支持 CSV 批量导入导出、内联编辑、模型可见性隐藏。
- 新增优先级规则编辑器，支持拖拽排序、条件组合（AND）和冲突检测（重叠警告 / 重复报错 / 阴影规则）。
- 新增用量监控仪表盘，支持日期筛选、Provider 维度过滤和用量趋势图表。
- 新增上游 Provider 模型自动发现能力，可从上游 API 拉取可用模型列表并暂存确认后入库。
- 新增 Cron 巡检健康探测与用量定时聚合任务。
- 新增 Provider API Key 长度校验。
- 新增 Fallback 循环依赖检测与运行时防护，避免配置错误导致无限循环。

### Fixed
- 修复 Provider 弹窗滚动穿透问题。
- 修复 Vercel Hobby 计划下 Cron 调度频率不兼容问题。
- 修复 KV 用量统计在未配置限额时的冗余计数开销。
- 修复 Provider 删除失败问题 (#7)。

### Changed
- 优化部署指南文档结构和内容。
- 优化 Setup Wizard 在缺失环境变量配置时的引导提示。

## [2.2.0] - 2026-05-25

### Added
- 新增 Admin 后台批量导入 Provider API Key 能力，支持逗号或换行分隔的多 Key 一次性导入，并返回新增 / 重复计数。
- 新增首页导航栏「管理后台」入口，无需手动输入 URL 即可进入 Admin Dashboard。

### Changed
- 升级 DeepSeek 默认模型为 `deepseek-v4-flash` 和 `deepseek-v4-pro`，上下文窗口提升至 1M tokens。
- 保留 `deepseek-chat` / `deepseek-reasoner` 作为别名，现有调用无需修改即可平滑迁移到新模型。
- 优化 Admin 后台 Provider 状态指示器的布局，保持单行展示不换行。
- 更新 README 中 DeepSeek 模型示例为最新 v4 系列。

## [2.1.0] - 2026-05-25

### Added
- 新增 AI Relay v2.1 产品规划文档，明确下一阶段围绕 Setup Wizard、Provider Health Dashboard、Request Logs 提升部署后激活和排障体验。
- 新增 AI Relay v2.1 设计规范，为后台可观测性、状态展示和排障链路提供统一体验基线。
- 新增 Admin 可观测性能力，面向 Provider 健康状态、请求链路追踪和后台诊断体验做增强。
- 新增 GPT-5.3、GPT-5.4、GPT-5.5 系列模型到 gw2 Provider 注册表。
- 新增 `gw2_oops_asia` Provider，并将标准 GPT 模型路由到对应 Provider。
- 新增 Provider / Custom Provider 强制刷新参数，便于后台配置变更后绕过缓存读取最新状态。
- 新增月度用量聚合能力，并在未配置限额时优化配额统计路径，减少不必要计数开销。

### Changed
- README 进一步突出「Vercel 一键部署」和「Serverless AI API 网关」定位，强化 GitHub 首页首屏转化。
- 优化 Admin Dashboard 在页面可见性变化时的数据自动刷新逻辑，减少后台标签页不必要请求。

### Fixed
- 修复未配置限额时仍需要追踪配额用量的问题，提升免费层和轻量使用场景下的稳定性。

## [2.0.0] - 2026-05-25

### Added
- 新增 Vercel 一键部署入口，支持通过 Deploy with Vercel 快速创建自己的 AI API 网关。
- 新增 OpenAI 兼容接口，现有 OpenAI SDK 仅需修改 `base_url` 即可接入。
- 新增多 Provider 路由能力，支持 OpenAI、Claude、DeepSeek、MiMo、Xiaomi 以及自定义 Provider。
- 新增多 Key 轮换能力，支持 Key 池管理、Round-Robin 分发和 429 自动退避。
- 新增 Provider Fallback 链，在 Provider 或 Key 不可用时自动故障转移。
- 新增熔断触发后的 Fallback 机制，提升上游故障时的可用性。
- 新增虚拟模型映射能力，支持将虚拟模型名路由到真实 Provider / Model。
- 新增自定义 Provider 管理能力，支持在 Admin 后台进行 Provider CRUD 配置。
- 新增 Provider API Key 连接测试能力，Admin 后台可直接验证 Key 可用性并展示错误码反馈。
- 新增模型连通性测试工具，支持按模型验证 Provider 访问能力。
- 新增 Key 测试界面的模型选择能力，便于排查指定模型的连通性和权限问题。
- 新增临时 API Key 生成能力，基于 HMAC-SHA256 支持无状态签名和自动过期。
- 新增动态配额覆盖能力，支持通过 KV 持久化配额配置，并在 Admin UI 中调整。
- 新增 Webhook 通知系统，支持多平台适配器、自动日报和超限告警。
- 新增 Webhooks 管理 Tab，可配置告警阈值和日报通知。
- 新增 Vercel KV 内存 Mock，改善本地开发和测试体验。
- 新增 KV 用量、Key Pool、Provider 配置等核心状态的后台管理能力。
- 新增 MiMo v2.5 系列模型支持，并补充模型解析和验证测试。
- 新增 MiMo v2.5 视觉能力支持。
- 新增 Base64 图片大小校验和多模态 Token 估算逻辑，提升多模态请求安全性。
- 新增 CI/CD Pipeline、本地 CI 脚本和测试框架，提升开源协作质量。
- 新增安全审计与开源准备文档。
- 新增 MIT License。
- 新增中英文 README，中文作为默认首页，英文 README 面向国际开发者。
- 新增 Logo、Banner、Admin Dashboard 截图和开源项目视觉资产。

### Changed
- 将 README 调整为中文默认、英文独立 `README_EN.md` 的双语结构。
- 重构 Admin Dashboard，将 Provider 管理、配置、Webhook 等模块拆分为独立 Tab 和组件。
- 重构 Key Pool 初始化流程为异步模式，改善后台加载体验和状态展示。
- 重构模型选择逻辑，使用 Provider 前缀 ID 保证模型唯一性和校验准确性。
- 优化 KV 用量存储，使用 Lua 脚本和按 Key 指标管理提升统计性能。
- 优化 KV 错误处理与 Admin 配置管理的容错能力。
- 抽离 Homepage 组件和样式，提高首页维护性。
- 强化 README 中「无服务器、免费层、一键部署、低维护」的定位表达。
- 更新仓库地址为 `MoyuFamily/ai-relay`。
- 补充团队信息、致谢和 Linux Do 相关说明。

### Fixed
- 修复 Admin API 路由和客户端请求可能被缓存的问题，统一增加动态渲染和 `no-store` 处理。
- 修复 Provider Key 删除后关联错误日志未清理的问题。
- 修复测试中 Provider Models 访问缺少可选链导致的异常。
- 修复生产环境变量文件曾被追踪的问题，将敏感环境文件移出版本控制并加入 `.gitignore`。
- 修复 Provider Key 管理中 Base64 编码 Key 解析不一致的问题。
- 修复团队 Git 身份和联系邮箱配置，统一使用项目约定身份。

## [1.0.0] - 2026-05-23

### Added
- 初始版本：提供面向个人开发者和小团队的轻量化 AI API 中转能力。
- 支持基于 Next.js 14 和 Vercel Edge Runtime 的 Serverless 部署模式。
- 支持 `/v1/chat/completions` 风格的 OpenAI 兼容请求入口。
- 支持基础 Provider 配置、API Key 管理和后台管理页面。
- 支持基础用量统计、模型路由和请求转发能力。
- 提供本地开发环境示例、环境变量模板和项目基础脚手架。

