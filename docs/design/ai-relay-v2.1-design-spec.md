# AI Relay v2.1 交互/UI 设计规范

> 版本：v1.0 · 设计师：像素姐 · 日期：2026-05-25
> 范围：Setup Wizard / Provider Health / Request Logs

## 1. 设计目标

AI Relay v2.1 的设计重点不是新增复杂入口，而是让 Admin 从“能管理配置”变成“能完成部署激活、运行观测、故障定位”的生产可用工作台。

核心体验目标：
- 新用户 5 分钟内完成首条真实请求。
- 管理员 3 秒内判断 Provider 是否健康。
- 出错后能通过 Trace ID、Provider、错误类型快速定位原因。

## 2. 信息架构

沿用现有 Admin 顶部 Header + Tab 结构，不做侧边栏大重构。建议在现有 Tabs 中增补：

```text
Admin
├── Overview / 运行概览
├── Setup / 快速开始      ← 新增，首次未完成时高亮
├── Keys / 密钥管理
├── Health / 健康状态     ← 新增
├── Logs / 请求日志       ← 新增
├── Tools / 辅助工具
└── Webhooks / 通知设置
```

首页顶部保留 Logo、语言切换、刷新按钮；Setup 未完成时在 Overview 顶部出现一条玻璃态引导 Banner。

## 3. 现有 Admin UI 复用原则

视觉继续使用 dark glassmorphism：径向深色背景、半透明玻璃卡片、蓝紫渐变高亮、圆角 12-16px、细边框和柔和发光。不要引入全新品牌色或大面积彩虹渐变。

关键 token：
- 背景：`radial-gradient(circle at top, #1e293b, #09090b)`
- 面板：`rgba(30, 41, 59, 0.45)` + `backdrop-filter: blur(12px)`
- 边框：`rgba(255,255,255,0.08)`
- 主文字：`#e5e7eb`，次文字：`#9ca3af`
- Active Tab：蓝紫半透明渐变 + `#60a5fa`
- Success：`#10b981`，Warning/Degraded：`#f59e0b`，Down/Error：`#ef4444`

布局原则：桌面最大宽度沿用 `1000px`，新增页面使用 12 列感知但实际可用 CSS grid；移动端 Tab 横向滚动，表格降级为卡片列表。

## 4. Setup Wizard 设计

入口：首次登录 Admin 自动打开轻量 Modal；非首次在 Overview Banner 和 Setup Tab 中进入。若用户关闭 Modal，Banner 保留“继续配置”按钮。

步骤条建议 5 步：
1. Environment Check / 环境检查
2. Provider Key / 添加 Provider Key
3. Code Sample / 生成调用示例
4. Test Request / 测试首条请求
5. Done / 完成

### 4.1 环境检查

用三张状态卡展示 Relay API Key、Admin Key、KV Storage。每张卡包含状态点、说明、修复提示和“重新检查”按钮。

状态：
- loading：骨架条 + spinning dot，文案“Checking environment...”
- success：绿色勾，说明“Ready for requests”
- warning：黄色提示，如 KV 可读但写入失败，允许继续但提示影响日志
- error：红色提示，展示缺失 env key 名称与 docs 链接

### 4.2 添加 Provider Key

采用两栏：左侧 Provider 选择，右侧 Key 输入与测试结果。API Key 输入默认 password，可切换显示；测试连接按钮固定 44px 高，loading 时禁用二次点击。

测试结果卡：展示 Provider、命中模型、延迟、是否支持 stream/tools/vision。失败时展示可读错误摘要，不显示原始 Authorization 或 Key。

### 4.3 示例代码与测试请求

示例代码使用 Tab 切换 curl / OpenAI SDK，自动注入当前部署域名。复制按钮反馈“Copied / 已复制”，2 秒后恢复。

测试请求区域包含 prompt 输入、发送按钮、响应预览、命中 Provider、Latency、Trace ID。成功后主按钮变为“Finish setup / 完成配置”。

### 4.4 完成与退出

完成页使用轻量庆祝但不喧宾夺主：绿色状态环 + 下一步卡片：查看健康状态、打开请求日志、回到 Overview。完成后写入 setupCompleted，不再强制弹出。

## 5. Provider Health 面板

Provider Health 放在独立 Health Tab，同时在 Overview 顶部提供 3 个汇总指标：Healthy、Degraded、Down。用户的眼睛是最诚实的，状态色要克制但一眼可读。

### 5.1 列表结构

桌面端使用玻璃态表格/卡片混合：
- Provider：名称、模型数量、小标签 built-in/custom
- Status：Healthy / Degraded / Down / Unknown
- Latency：最近一次耗时，超过阈值变黄
- Success Rate：最近 N 次成功率，用细进度条
- Available Keys：可用 Key 数 / 总 Key 数
- Last Check：相对时间 + 具体 tooltip
- Last Error：一行摘要，点击打开详情
- Actions：Run check、Enable/Disable、View keys

移动端每个 Provider 变为独立卡片，优先显示 Provider、Status、Latency、Last Error，次级字段折叠到 “Details”。

### 5.2 状态模型

- Healthy：最近测试成功且成功率 >= 95%；绿色点 + `Operational`
- Degraded：最近测试成功但成功率 < 95% 或延迟高；黄色点 + `Degraded`
- Down：最近测试失败或连续失败超过阈值；红色点 + `Down`
- Unknown：无检查数据或刚添加；灰蓝点 + `Not checked`
- Loading：手动检查中；旋转 ring + 行内禁用操作

降级状态不应使用大面积黄色背景，只在状态 pill、延迟数字和卡片左侧 2px 细线体现，避免后台长期黄色造成焦虑。

### 5.3 错误详情 Drawer

点击 Last Error 打开右侧 Drawer：错误类型、HTTP Status、Provider 原始错误摘要、脱敏后的 request metadata、最近 5 次失败时间线、建议动作。Drawer 底部提供“Copy diagnostics”复制脱敏诊断信息。

空状态：如果没有 Provider，展示“Add your first Provider Key”并跳转 Keys/Setup。错误态：健康检查 API 失败时页面顶部用 inline alert，不覆盖旧数据。

## 6. Request Logs 与错误追踪

Logs Tab 默认展示“最近错误优先”的请求列表：失败和高延迟请求置顶，其余按时间倒序。顶部使用过滤器栏，保持轻量，不做复杂 BI。

### 6.1 筛选与搜索

过滤器：Time Range、Provider、Model、Status、Error Type；右侧 Trace ID 搜索框。桌面端一行展示，移动端折叠为 Filter 按钮 + bottom sheet。

列表字段：Time、Trace ID、API Key masked、Model、Provider、Status、HTTP Status、Latency、Tokens、Error Type。Trace ID 使用等宽字体，可一键复制。

### 6.2 日志详情

点击行打开详情 Drawer：
- Summary：成功/失败、模型、Provider、Latency、Token 用量
- Routing：原始模型、选中 Provider、fallback 是否发生
- Error：错误类型、脱敏错误摘要、建议修复
- Metadata：Trace ID、时间、Relay Key masked、request id

安全规则：默认不展示完整 prompt/completion；API Key、Authorization、Provider Key 必须脱敏；错误内容只显示摘要和标准化类型。

### 6.3 页面状态

- Empty：无日志时提示“Send your first request”，附 curl 示例入口
- Loading：表格骨架 + 保留过滤器区域
- Success：正常列表；错误行使用红色 status pill，不整行染红
- Warning：日志写入降级时顶部黄色 alert，说明不影响主请求链路
- Error：读取日志失败时保留空壳和重试按钮

## 7. 组件规范

按钮：主按钮使用蓝紫渐变；次按钮透明玻璃；危险按钮红色描边。所有可点击目标不小于 44px。

Status Pill：圆角 999px，左侧 6px 状态点，文字中英切换。Healthy/Success 绿色，Degraded/Warning 黄色，Down/Error 红色，Unknown 灰蓝。

Stepper：桌面横向 5 步，移动端显示当前步骤 `Step 2 of 5` + 进度条。完成步骤显示勾，错误步骤显示可回退提示。

Code Block：沿用首页代码块规范，深色背景、顶部语言标签、复制按钮；移动端允许横向滚动。

Drawer：桌面右侧 420px，移动端全屏；Esc/遮罩关闭；保留清晰 focus ring。

## 8. 响应式规则

桌面 >= 960px：Header 两端对齐，Tabs 换行但不滚动；Health/Logs 使用表格密度；Drawer 右侧浮层。

平板 640-959px：核心指标两列；Setup 左右栏改为上下布局；过滤器可换两行。

手机 < 640px：主容器 padding 16px；Tabs 横向滚动；Health/Logs 表格改为卡片；Drawer 全屏；所有输入和按钮 44px 以上。排版要舒服才好呀，移动端宁可多滚动，也不要把诊断信息挤成小字。

## 9. i18n key 建议

| Key | zh | en |
|---|---|---|
| tabSetup | 🚀 快速开始 | 🚀 Setup |
| tabHealth | 🟢 健康状态 | 🟢 Health |
| tabLogs | 🧾 请求日志 | 🧾 Logs |
| setupBannerTitle | 完成 5 分钟快速配置 | Finish setup in 5 minutes |
| setupEnvCheck | 环境检查 | Environment check |
| setupProviderKey | 添加 Provider Key | Add Provider key |
| setupCodeSample | 调用示例 | Code sample |
| setupTestRequest | 测试请求 | Test request |
| setupDone | 配置完成 | Setup complete |
| healthRunCheck | 手动检查 | Run check |
| healthHealthy | 正常 | Healthy |
| healthDegraded | 波动 | Degraded |
| healthDown | 不可用 | Down |
| healthUnknown | 未检查 | Not checked |
| logsSearchTrace | 搜索 Trace ID | Search Trace ID |
| logsRecentErrorsFirst | 最近错误优先 | Recent errors first |
| logsCopyDiagnostics | 复制诊断信息 | Copy diagnostics |
| emptyNoProvider | 暂无 Provider，请先添加 Key | No providers yet. Add a key first. |
| emptyNoLogs | 暂无请求日志 | No request logs yet |

## 10. 开发实现建议

1. 在现有 `activeTab` 枚举中增补 `setup`、`health`、`logs`，保持当前 Header、Tab button、glass-panel CSS。
2. 新增组件建议：`SetupTab`、`ProviderHealthTab`、`RequestLogsTab`、`StatusPill`、`DiagnosticsDrawer`、`CodeSampleBlock`。
3. Provider Health 与 Logs 都应使用脱敏后的后端 DTO，不在前端做敏感字段清洗兜底。
4. Logs 读取失败、写入降级都不要影响主请求链路；UI 用 warning alert 表达“观测降级”。
5. Loading 时尽量保留旧数据，只在局部显示 refreshing 状态，减少 dashboard 闪烁。

## 11. 交付检查清单

- [x] Setup Wizard 流程、入口、状态、完成逻辑
- [x] Provider Health 信息架构、状态模型、错误详情
- [x] Request Logs 列表、筛选、Trace ID、详情 Drawer
- [x] 空/loading/success/error/warning/degraded/down 状态说明
- [x] 中英双语 i18n key 建议
- [x] 移动/桌面响应式规则
- [x] 现有 Admin dark glassmorphism 复用说明
