# AI Relay 迭代四 PRD — Cron 巡检 + 用量仪表盘

> **版本**：v1.0 · **作者**：饼哥（产品总监） · **日期**：2026-05-26
> **状态**：Draft
> **分支**：`feature/relay-ux-iteration`
> **仓库**：`/Users/parsifal/Repo/Service/ai-relay`
> **前置迭代**：迭代一（供应商 CRUD + 模板）、迭代二（模型别名 + CSV）、迭代三（优先级规则）

---

## 1. 背景与目标

### 1.1 问题

当前 AI Relay 的供应商健康状态依赖 **Admin 面板实时查询**（`/api/admin/provider-health`），存在以下痛点：

- **无主动巡检**：健康状态仅在管理员打开面板时才刷新，凌晨供应商宕机无人知晓
- **无历史趋势**：只能看到当前快照，无法判断"这个供应商最近一周是否频繁抖动"
- **状态粒度粗**：仅有 `available / degraded / unavailable` 三态，缺少"数据不足"的兜底表达
- **用量可视化不足**：`/api/admin/usage` 仅返回当日汇总，管理员无法在面板内直接查看历史用量趋势

### 1.2 目标

| 维度 | 指标 |
|------|------|
| 故障感知延迟 | 供应商宕机后 ≤30 分钟被系统自动标记 |
| 巡检覆盖率 | 100% 已配置供应商纳入巡检 |
| 状态准确率 | 连续 2 次失败才标记 Down，避免瞬时抖动误报 |
| 用量面板可用性 | 管理员可在面板内选择日期范围查看用量折线图 |

### 1.3 成功标准

- Vercel Cron 每 30 分钟自动巡检所有供应商，结果持久化到 KV
- 四态指示灯（Healthy / Degraded / Down / Unknown）在 Admin 面板实时展示
- 巡检历史保留最近 7 天，支持趋势可视化
- 每日凌晨 Cron 聚合用量数据，Admin 面板提供日期选择器 + 折线图
- KV 开销 +0（后台 Cron 任务，不增加请求链路负担）

---

## 2. 用户故事

### 2.1 凌晨供应商宕机自动感知

> 作为**个人开发者 / 小团队管理员**，
> 我想**系统自动巡检供应商可用性，不用一直盯着面板**，
> 以便**供应商宕机时我能及时感知并切换备用供应商**。

**验收条件**：
1. Vercel Cron 每 30 分钟触发 `/api/cron/probe`
2. 对每个已配置供应商发送轻量探测请求（`GET /v1/models` 或等价端点）
3. 连续 2 次失败 → 标记为 Down；单次失败 → Degraded
4. 结果写入 `relay:health:log:{provider}:{timestamp}`
5. 打开 Admin → 监控面板，看到最新巡检状态

### 2.2 巡检趋势分析

> 作为**关注服务稳定性的管理员**，
> 我想**查看供应商最近 7 天的健康趋势**，
> 以便**判断是否需要更换频繁抖动的供应商**。

**验收条件**：
1. Admin → 监控面板 → 健康状态 Tab
2. 每个供应商卡片显示最近一次状态 + 最近 7 天趋势小图
3. 点击供应商卡片展开详细巡检日志（时间戳 + 状态 + 响应时间）

### 2.3 用量趋势回顾

> 作为**关注成本的管理员**，
> 我想**在面板内查看历史用量趋势，而不只是当日汇总**，
> 以便**发现用量异常波动并及时调整策略**。

**验收条件**：
1. Admin → 用量报告 Tab
2. 日期选择器（预设：7天 / 30天 / 自定义）
3. 折线图展示请求数 + Token 消耗趋势
4. 按供应商分组展示（复用现有 `TokenTrendChart` 组件）

---

## 3. 功能规格

### 3.1 Cron 巡检端点

**端点**：`GET /api/cron/probe`

**触发方式**：Vercel Cron（`vercel.json` 配置）

**执行频率**：每 30 分钟

**认证**：
- 优先检查 `x-vercel-cron: 1` 请求头
- 非 Vercel Cron 请求需 Admin Auth

**执行逻辑**：

```
对每个已配置供应商 (provider):
  1. 从 Key Pool 取一个可用 Key（无 Key 则跳过，标记 Unknown）
  2. 发送 GET /v1/models 请求（超时 10s）
  3. 记录：status_code, response_time_ms, error_message
  4. 读取上一次巡检结果 (relay:health:last:{provider})
  5. 判定状态：
     - 成功 → Healthy
     - 单次失败 + 上次成功 → Degraded
     - 连续 2 次失败 → Down
     - 无 Key / 跳过 → Unknown
  6. 写入 KV：
     - relay:health:last:{provider}  ← 最新状态（覆盖）
     - relay:health:log:{provider}:{timestamp}  ← 历史记录（7天 TTL）
  7. 如有状态变化（上一次 ≠ 这一次），触发 Webhook 通知（可选）
```

**响应格式**：
```json
{
  "success": true,
  "timestamp": "2026-05-26T10:30:00Z",
  "providers": [
    {
      "id": "openai",
      "name": "OpenAI",
      "status": "healthy",
      "responseTimeMs": 234,
      "consecutiveFailures": 0,
      "lastCheckedAt": "2026-05-26T10:30:00Z"
    },
    {
      "id": "deepseek",
      "name": "DeepSeek",
      "status": "down",
      "responseTimeMs": null,
      "consecutiveFailures": 2,
      "lastCheckedAt": "2026-05-26T10:30:00Z",
      "error": "ETIMEDOUT"
    }
  ]
}
```

### 3.2 四态状态机

| 状态 | 颜色 | 图标 | 含义 | 判定条件 |
|------|------|------|------|---------|
| Healthy | 绿色 `#34d399` | ● | 正常可用 | 探测请求成功 |
| Degraded | 黄色 `#fbbf24` | ⚠ | 性能下降或单次失败 | 单次失败 / 响应时间 >5s / 部分 Key 不可用 |
| Down | 红色 `#f87171` | ✕ | 不可用 | 连续 2 次探测失败 |
| Unknown | 灰色 `#6b7280` | ? | 数据不足 | 无可用 Key / 首次巡检 / 巡检跳过 |

**状态转换图**：
```
          成功           成功           成功
Unknown ───→ Healthy ───→ Healthy ───→ Healthy
  │            │            │            │
  │          失败         失败         失败
  │            ↓            ↓            ↓
  │        Degraded ──→  Degraded ──→  Down
  │                         ↑            │
  │                       成功           │ 成功
  │                         ↓            ↓
  └──────────────────────────────── Healthy
```

**降级判定细化**：
- 响应时间 > 5000ms → Degraded（即使成功）
- HTTP 429 (Rate Limited) → Degraded（非 Down）
- HTTP 5xx / 超时 → 计入失败计数
- HTTP 401/403 → 标记 Key 异常，不计入供应商 Down

### 3.3 KV 存储设计

| Key 模式 | 类型 | TTL | 用途 |
|----------|------|-----|------|
| `relay:health:last:{provider}` | JSON | 无 | 每个供应商最新巡检结果 |
| `relay:health:log:{provider}:{ts}` | JSON | 7 天 | 巡检历史记录 |
| `relay:health:consecutive:{provider}` | Number | 无 | 连续失败计数器 |
| `relay:report:daily:{date}` | JSON | 30 天 | 每日用量聚合（已有） |

**KV 开销分析**：
- 巡检写入：每 30 分钟 N 次 PUT（N = 供应商数量）+ N 次 GET（读取上次状态）
- 巡检读取：Admin 面板查看时 GET，但走内存缓存（60s TTL）
- **对用户请求链路无影响**（+0 KV/请求）


### 3.4 用量 Cron 聚合

**端点**：`GET /api/cron/usage`

**触发方式**：Vercel Cron

**执行频率**：每日 00:05 UTC（北京时间 08:05）

**执行逻辑**：

```
1. 计算昨日日期 (YYYY-MM-DD)
2. 读取昨日所有小时级 usage 数据
3. 聚合为日报：
   - 总请求数
   - 总 Token（prompt / completion / total）
   - 按供应商分组统计
   - 按模型分组统计（Top 10）
   - 错误率 / P95 延迟（如有埋点数据）
4. 写入 relay:report:daily:{date}（TTL 30 天）
5. 如有 Webhook 配置，推送日报通知
```

**日报数据结构**：
```json
{
  "date": "2026-05-25",
  "summary": {
    "totalRequests": 1234,
    "totalTokens": 5678900,
    "promptTokens": 3456700,
    "completionTokens": 2222200,
    "errorRate": 0.02,
    "p95LatencyMs": 3200
  },
  "byProvider": {
    "openai": { "requests": 800, "tokens": 4000000 },
    "deepseek": { "requests": 434, "tokens": 1678900 }
  },
  "topModels": [
    { "model": "gpt-4o", "requests": 500, "tokens": 2500000 },
    { "model": "deepseek-chat", "requests": 300, "tokens": 1200000 }
  ]
}
```

### 3.5 Admin 面板 — 监控与报告页

**信息架构调整**：将现有"健康状态"Tab 和"用量趋势"Tab 合并为 **"监控与报告"** 模块。

#### 3.5.1 健康状态区域

**布局**：卡片网格（每行 2-3 个供应商卡片）

**每个卡片包含**：
- 供应商名称 + 服务图标
- 状态指示灯（四态颜色 + 文字标签）
- 可用 Key 数 / 总 Key 数
- 最近一次巡检时间
- 最近 7 天迷你趋势图（sparkline）
- 响应时间（最近一次）

**交互**：
- 点击卡片 → 展开巡检日志面板（时间线视图）
- 手动刷新按钮（触发 `/api/cron/probe?manual=1`）
- 全局刷新间隔：60s 自动轮询 `relay:health:last:*`

#### 3.5.2 用量报告区域

**复用现有** `TokenTrendChart` 组件，新增功能：

- **日期范围选择器**：预设 7d / 30d + 自定义日期范围
- **数据源切换**：实时（`/api/admin/usage-trend`）/ 日报（`/api/admin/usage-report`）
- **指标切换**：请求数 / Token 总量 / Prompt Token / Completion Token
- **供应商筛选**：多选 checkbox 过滤供应商

**新增 API**：

`GET /api/admin/usage-report?from=2026-05-01&to=2026-05-25`

从 KV 读取 `relay:report:daily:{date}` 聚合返回，用于日报模式。

---

## 4. 技术约束

### 4.1 Vercel Cron 限制

| 限制项 | Hobby | Pro | 应对方案 |
|--------|-------|-----|---------|
| Cron 数量 | 2 个 | 16 个 | 巡检 + 日报 = 2 个，在 Hobby 限制内 |
| 执行时长 | 10s | 60s | 巡检超时 10s/供应商，10 个供应商 ≈ 100s（需 Pro 或分批） |
| 并发 | 1 | 1 | 顺序执行，无并发问题 |

**Hobby 方案**：如执行超时，改为每轮只巡检 3-5 个供应商（轮转制），状态存 KV 记录上次巡检到哪。

### 4.2 探测请求策略

- **端点选择**：`GET /v1/models`（OpenAI 兼容端点，多数供应商支持）
- **非标供应商**：对不支持 `/v1/models` 的供应商，使用 `POST /v1/chat/completions` + 最小化请求体（`max_tokens: 1`）
- **超时**：10s（fetch AbortController）
- **重试**：无（单次探测即判定，连续 2 次失败才 Down）

### 4.3 向后兼容

- 现有 `/api/admin/provider-health` 保持不变（实时查询）
- 现有 `/api/admin/usage-trend` 保持不变
- 新增 `/api/admin/usage-report` 为独立端点
- 新增 `/api/cron/probe` 和 `/api/cron/usage` 为独立端点

---

## 5. 非功能需求

### 5.1 性能

| 指标 | 目标 |
|------|------|
| 巡检端点总耗时 | ≤ 60s（10 个供应商 × 10s 超时上限） |
| Admin 面板健康数据加载 | ≤ 1s（KV 缓存命中） |
| 用量报告 API 响应 | ≤ 2s（30 天日报聚合） |

### 5.2 可靠性

- 巡检任务失败不影响用户请求链路
- KV 写入失败静默降级（不抛错，日志记录）
- 巡检结果 7 天自动过期，无手动清理负担

### 5.3 安全

- `/api/cron/probe` 和 `/api/cron/usage` 仅接受 Vercel Cron 头或 Admin Auth
- 巡检使用的 Key 从 Key Pool 随机选取，不暴露完整 Key
- 巡检日志不存储请求/响应 body，仅记录状态码和响应时间

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|---------|
| 巡检请求触发供应商限流 | 中 | 中 | 使用低优先级 Key，限制频率（30min/次），429 标记 Degraded 非 Down |
| Hobby 计划 Cron 超时 | 高 | 中 | 轮转巡检（每轮 5 个供应商），或提示用户升级 Pro |
| KV 存储量增长 | 低 | 低 | 7 天 TTL 自动过期，单条 < 1KB |
| 探测请求产生额外费用 | 低 | 低 | 使用 `/v1/models` 端点（免费），避免 chat/completions |
| 巡检误报（瞬时抖动） | 中 | 中 | 连续 2 次失败才 Down + Degraded 作为缓冲态 |

---

## 7. 开放问题

| # | 问题 | 默认方案 | 需确认 |
|---|------|---------|--------|
| 1 | Hobby 计划下巡检超时如何处理？ | 轮转制（每轮巡检 5 个，下一轮巡检剩余） | Boss 确认是否升级 Pro |
| 2 | 巡检失败是否触发 Webhook 通知？ | 默认关闭，Admin 可配置开启 | 像素姐设计通知配置 UI |
| 3 | 用量日报是否需要邮件推送？ | MVP 仅 Webhook，后续迭代加邮件 | Boss 确认 |
| 4 | 巡检日志保留时长 7 天是否足够？ | 默认 7 天，可配置 | Boss 确认 |
| 5 | 是否需要公开状态页（/status）？ | MVP 不做，后续迭代 | Boss 确认 |

---

## 8. 交付物清单

| 交付物 | 路径 | 负责人 |
|--------|------|--------|
| 本 PRD | `docs/product/iteration-4-monitor.md` | 饼哥 |
| 巡检 API | `src/app/api/cron/probe/route.ts` | 码飞 |
| 日报聚合 API | `src/app/api/cron/usage/route.ts` | 码飞 |
| 用量日报查询 API | `src/app/api/admin/usage-report/route.ts` | 码飞 |
| 健康状态存储模块 | `src/lib/health/` | 码飞 |
| 健康状态 Tab 组件 | `src/app/admin/components/HealthMonitorTab.tsx` | 像素姐 |
| 用量报告 Tab 组件 | `src/app/admin/components/UsageReportTab.tsx` | 像素姐 |
| Vercel Cron 配置 | `vercel.json` | 码飞 |

---

## 9. 里程碑

| 阶段 | 内容 | 预估工时 |
|------|------|---------|
| M1 | 巡检 API + KV 存储 + 四态状态机 | 1.5 人日 |
| M2 | 用量日报 Cron + 聚合逻辑 | 1 人日 |
| M3 | Admin 面板健康状态 Tab UI | 1 人日 |
| M4 | Admin 面板用量报告 Tab + 日期选择器 | 0.5 人日 |
| **总计** | | **4 人日** |

---

## 10. 验收清单

### 10.1 Cron 巡检验收

| 检查项 | 通过标准 |
|--------|----------|
| Vercel Cron 配置 | `vercel.json` 中存在 `/api/cron/probe`，调度频率为每 30 分钟 |
| Cron 鉴权 | Vercel Cron 请求可通过，普通未授权请求返回 401/403 |
| 供应商覆盖 | 已启用且配置了 Key 的供应商全部进入巡检队列 |
| Unknown 兜底 | 无可用 Key、配置缺失、首次无记录时展示 Unknown，不误报 Down |
| Degraded 过渡 | 单次超时、单次 5xx、响应时间 >5s 或 429 展示 Degraded |
| Down 判定 | 连续 2 次失败才展示 Down |
| 历史保留 | `relay:health:log:{provider}:{timestamp}` 设置 7 天 TTL |
| 请求链路影响 | 普通 `/v1/*` 转发请求不因巡检新增 KV 读写 |

### 10.2 Admin 监控页验收

| 检查项 | 通过标准 |
|--------|----------|
| 状态灯可读性 | Healthy / Degraded / Down / Unknown 同时具备颜色、图标、文字，不只依赖颜色 |
| 最近状态 | 卡片展示最近巡检时间、响应时间、可用 Key 数 |
| 趋势信息 | 卡片展示最近 7 天 sparkline 或等价趋势摘要 |
| 日志展开 | 点击供应商卡片可查看巡检时间线，包含时间、状态、响应时间、错误摘要 |
| 手动刷新 | 管理员可手动触发一次巡检，按钮有 loading 和失败反馈 |
| 空状态 | 无供应商、无 Key、无历史数据时有明确引导文案 |

### 10.3 用量报告验收

| 检查项 | 通过标准 |
|--------|----------|
| 日报 Cron | `vercel.json` 中存在 `/api/cron/usage`，每日 00:05 UTC 触发 |
| 日报存储 | 成功写入 `relay:report:daily:{date}`，TTL 30 天 |
| 查询 API | `/api/admin/usage-report?from=&to=` 支持 7 天、30 天、自定义范围 |
| 折线图 | 支持请求数、Token 总量、Prompt Token、Completion Token 指标切换 |
| 供应商筛选 | 可按供应商过滤趋势，默认展示全部供应商 |
| 数据缺口 | 某天无日报时图表不断线崩溃，展示 0 或缺口提示 |

### 10.4 埋点与观测

| 事件 | 字段 |
|------|------|
| `probe_cron_started` | provider_count, trigger_type |
| `probe_provider_completed` | provider_id, status, response_time_ms, error_type |
| `probe_status_changed` | provider_id, from_status, to_status |
| `usage_report_generated` | date, total_requests, total_tokens, provider_count |
| `monitor_page_viewed` | health_status_count, date_range |

---

## 11. 研发拆分建议

### 后端任务
1. 新增健康状态存储模块：封装 `last / log / consecutive` 三类 KV 读写。
2. 新增 `/api/cron/probe`：完成 Cron 鉴权、供应商遍历、状态机判定、KV 写入。
3. 新增 `/api/cron/usage`：聚合昨日用量并写入日报。
4. 新增 `/api/admin/usage-report`：按日期范围读取日报并补齐缺口。
5. 补充单元测试：覆盖四态状态机、连续失败计数、日报聚合边界。

### 前端任务
1. 新增监控与报告模块入口，承接健康状态与用量报告两个区域。
2. 实现供应商健康卡片：状态灯、最新数据、7 天趋势、展开日志。
3. 实现用量报告筛选：日期范围、指标切换、供应商筛选。
4. 补齐加载态、错误态、空状态，保证首次使用不迷路。

### 联调顺序
1. 先用 mock KV 数据验证 Admin UI。
2. 再接入 `/api/admin/usage-report` 与健康状态读取 API。
3. 最后接入真实 Vercel Cron，在 Preview 环境手动触发验证。

---

*本文档由饼哥（产品总监）编写，基于圆桌讨论纪要 docs/internal/roundtable-ux-improvements.md*
*讨论 ID: rt_262195df · 阶段四：巡检 + 仪表盘（4 人日）*
