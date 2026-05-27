# 更新日志

本文档记录 AI Relay 的重要版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

（暂无）

## [2.4.0] - 2026-05-27

### Added
- **Responses API 支持**：新增 `/v1/responses` 端点，兼容 OpenAI Responses API，支持流式和非流式请求，复用现有 auth、rate limit 和 usage tracking 机制。(#9, #10)

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

