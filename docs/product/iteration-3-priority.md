# AI Relay 迭代三 PRD — 优先级规则编辑器 + 冲突检测

> 版本：v1.0
> 作者：饼哥（产品总监）
> 日期：2026-05-26
> 状态：Draft
> 前置迭代：v2.1（供应商 CRUD + 模板）、v2.2（模型别名 + CSV）

---

## 1. 背景

AI Relay 的供应商 fallback 机制目前采用**固定优先级**：按供应商注册顺序依次尝试，无法根据请求特征（模型前缀、请求来源等）动态选择最优供应商。

圆桌讨论（rt_262195df）确认迭代三需要解决两个核心问题：

1. **优先级不可控** — 用户无法指定「GPT 系列优先走 OpenAI，Claude 系列优先走 Anthropic」这类条件路由
2. **规则冲突无感知** — 多条规则可能互相覆盖，用户配置时缺乏实时反馈

---

## 2. 产品定位

> 让管理员通过拖拽排序 + 条件匹配，可视化定义供应商优先级规则；配置过程中实时检测冲突，避免无效规则导致路由异常。

## 3. 目标用户

| 角色 | 场景 |
|------|------|
| 个人开发者 | 按模型前缀指定首选供应商（`gpt-*` → OpenAI，`claude-*` → Anthropic） |
| 小团队管理员 | 按请求来源设置备选链（内部服务 → 主供应商，外部 API → 备用供应商） |
| 运维人员 | 配置主备切换规则，主供应商故障时自动降级 |

## 4. 功能范围

### 本期包含（Iteration 3）

| # | 功能 | 优先级 |
|---|------|--------|
| 1 | 优先级规则编辑器（拖拽排序） | P0 |
| 2 | 条件匹配（模型前缀、请求来源等） | P0 |
| 3 | 冲突实时检测 + 可视化提示 | P0 |
| 4 | 规则引擎（限 20 条） | P0 |
| 5 | 规则生效 + 缓存（TTL 60s） | P1 |
| 6 | 移动端适配（长按上下箭头排序） | P2 |

### 本期不包含

- 模型级别的 Token 配额控制（属于迭代四）
- 用量预警仪表盘（属于迭代四）
- 规则版本管理 / 回滚
- 规则模板（预置常见路由策略）

---

## 5. 核心概念

### 5.1 优先级规则（Priority Rule）

一条规则由**排序权重**和**条件**两部分组成，采用扁平结构：

```typescript
interface PriorityRule {
  id: string;              // UUID，规则唯一标识
  priority: number;        // 排序权重，数字越小优先级越高（从 1 开始）
  provider: string;        // 目标供应商名称，如 'openai'
  conditions: Condition[]; // 条件列表（AND 关系）
  enabled: boolean;        // 是否启用
  createdAt: string;       // 创建时间
  updatedAt: string;       // 更新时间
}
```

### 5.2 条件（Condition）

条件是规则的匹配逻辑，支持多种匹配类型：

```typescript
interface Condition {
  field: 'model_prefix' | 'model_exact' | 'request_source' | 'header';
  operator: 'equals' | 'starts_with' | 'ends_with' | 'contains' | 'regex';
  value: string;           // 匹配值
}
```

**字段说明**：

| field | 含义 | 示例 |
|-------|------|------|
| `model_prefix` | 模型 ID 前缀 | `gpt-`、`claude-`、`gemini-` |
| `model_exact` | 模型 ID 精确匹配 | `gpt-4-turbo` |
| `request_source` | 请求来源标识 | `internal`、`external`、`partner-xxx` |
| `header` | 自定义 Header 值 | `X-Tenant: acme` |

### 5.3 规则匹配流程

```
请求到达 → 按 priority 从小到大遍历规则
  ├─ 规则 1：conditions 全部满足？ → 使用该供应商
  ├─ 规则 2：conditions 全部满足？ → 使用该供应商
  ├─ ...
  └─ 无规则命中 → 走默认 fallback 顺序（供应商注册顺序）
```

**关键设计**：
- 规则按 `priority` 数字排序，**数字越小优先级越高**
- 一条规则的多个 conditions 是 **AND 关系**（全部满足才命中）
- **第一个命中的规则胜出**，后续规则不再评估
- 无规则命中时走现有的默认 fallback 逻辑

---

## 6. 功能详细设计

### 6.1 优先级规则编辑器

#### 目标

通过拖拽排序 + 可视化条件编辑，让用户直观地管理供应商优先级。

#### 入口

侧边栏「供应商管理」→「优先级规则」标签页。

#### 布局

```
┌─────────────────────────────────────────────────────────┐
│  优先级规则                                    [+ 添加规则] │
│                                                          │
│  ┌─ 规则卡片 ─────────────────────────────────────────┐  │
│  │  ≡  #1  OpenAI                                     │  │
│  │       条件: model_prefix = gpt-*                    │  │
│  │       └─ AND model_prefix = o1-*                    │  │
│  │                                        [编辑] [删除] │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ 规则卡片 ─────────────────────────────────────────┐  │
│  │  ≡  #2  Anthropic                                  │  │
│  │       条件: model_prefix = claude-*                 │  │
│  │                                        [编辑] [删除] │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ 规则卡片 ─────────────────────────────────────────┐  │
│  │  ≡  #3  Groq                                       │  │
│  │       条件: model_prefix = llama-*                  │  │
│  │       ⚠️ 与 #2 冲突：model_prefix 重叠              │  │
│  │                                        [编辑] [删除] │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  最多 20 条规则 · 拖拽调整优先级顺序                        │
└─────────────────────────────────────────────────────────┘
```

#### 交互规范

| 交互 | 行为 |
|------|------|
| 拖拽排序 | 拖拽卡片左侧 `≡` 手柄，释放后自动更新 priority 数字 |
| 添加规则 | 点击右上角「+ 添加规则」→ 弹出规则编辑弹窗 |
| 编辑规则 | 点击卡片「编辑」→ 弹出规则编辑弹窗，预填现有配置 |
| 删除规则 | 点击「删除」→ 二次确认弹窗 → 删除后自动重排 priority |
| 冲突提示 | 冲突卡片边框变红 + 左上角 ⚠️ 徽标 + 卡片底部红色文字说明 |
| 禁用规则 | 卡片右上角 Toggle 开关，禁用后卡片半透明 + 不参与匹配 |

#### 规则编辑弹窗

点击「添加规则」或「编辑」按钮后弹出模态框：

```
┌──────────────────────────────────────────────────┐
│  编辑优先级规则                              [✕]  │
│                                                   │
│  供应商 *                                         │
│  ┌─────────────────────────────────────────────┐  │
│  │ OpenAI                              ▼       │  │
│  └─────────────────────────────────────────────┘  │
│  下拉选择已有供应商，或输入自定义名称                │
│                                                   │
│  启用规则                           [Toggle: ON]  │
│                                                   │
│  ── 匹配条件 ────────────────────────────────────  │
│                                                   │
│  ┌─ 条件行 ─────────────────────────────────────┐  │
│  │ [模型前缀 ▼]  [starts_with ▼]  [gpt-      ] │  │
│  │                                          [✕] │  │
│  └─────────────────────────────────────────────┘  │
│  ┌─ 条件行 ─────────────────────────────────────┐  │
│  │ [模型前缀 ▼]  [starts_with ▼]  [o1-       ] │  │
│  │                                          [✕] │  │
│  └─────────────────────────────────────────────┘  │
│                                                   │
│  [+ 添加条件]                                     │
│                                                   │
│  多个条件之间为 AND 关系（全部满足才匹配）           │
│                                                   │
│          [取消]              [保存规则]            │
└──────────────────────────────────────────────────┘
```

**弹窗交互规范**：

| 元素 | 行为 |
|------|------|
| 供应商下拉 | 列出所有已注册供应商，支持搜索过滤 |
| 条件字段 | 下拉选择：模型前缀 / 模型精确 / 请求来源 / Header |
| 操作符 | 根据字段类型动态显示可用操作符 |
| 值输入 | 文本输入框，`regex` 类型显示正则语法提示 |
| 添加条件 | 最多 5 个条件（单条规则） |
| 删除条件 | 至少保留 1 个条件 |
| 保存 | 校验通过后写入，触发冲突检测 |

### 6.2 冲突实时检测

#### 目标

在用户配置规则时实时检测潜在冲突，避免无效或互相覆盖的规则。

#### 冲突类型

| 冲突类型 | 严重级别 | 说明 | 示例 |
|---------|---------|------|------|
| 条件完全重叠 | 🔴 错误 | 两条规则条件完全相同，低优先级规则永远不会命中 | 规则 A：`model_prefix=gpt-*`，规则 B：`model_prefix=gpt-*` |
| 条件包含重叠 | 🟡 警告 | 一条规则的条件是另一条的子集，高优先级规则会"吞掉"低优先级 | 规则 A：`model_prefix=gpt-*`，规则 B：`model_prefix=gpt-4-*` |
| 同供应商重复 | 🟡 警告 | 多条规则指向同一供应商，可能合并 | 规则 A：OpenAI（gpt-*），规则 B：OpenAI（o1-*） |
| 规则上限 | 🔴 错误 | 规则数达到 20 条上限 | — |

#### 检测时机

| 时机 | 行为 |
|------|------|
| 实时编辑 | 用户在编辑弹窗中修改条件时，每 500ms 防抖检测一次 |
| 保存时 | 提交规则前做一次完整检测 |
| 拖拽排序后 | 排序变更后立即检测所有规则 |
| 页面加载 | 首次加载时检测已有规则 |

#### 检测算法

```
检测流程（伪代码）：
for each rule_pair (A, B) where A.priority < B.priority:
  if A.provider == B.provider:
    标记「同供应商重复」（警告）
  if conditions_overlap(A, B):
    if conditions_equal(A, B):
      标记 B「条件完全重叠」（错误）
    else if conditions_subset(B, A):
      标记 B「条件包含重叠」（警告）

conditions_overlap(A, B):
  检查是否存在 model_prefix 重叠：
    如 "gpt-*" 和 "gpt-4-*" → 重叠
    如 "gpt-*" 和 "claude-*" → 不重叠
  检查是否存在 model_exact 重复
  检查 request_source 重复
```

#### 冲突可视化

| 状态 | 卡片样式 | 提示 |
|------|---------|------|
| 无冲突 | 默认样式（玻璃态边框） | — |
| 警告 | 边框变黄 `#f59e0b` + 左上角 ⚠️ | 卡片底部黄色文字说明 |
| 错误 | 边框变红 `#ef4444` + 左上角 ⚠️ | 卡片底部红色文字说明，阻止保存 |

**冲突文字示例**：
- ⚠️ 与 #1 冲突：条件完全重叠，此规则永远不会命中
- ⚠️ 与 #1 条件重叠：`gpt-4-*` 是 `gpt-*` 的子集
- ⚠️ 与 #1 指向同一供应商，建议合并条件

---

## 7. 规则引擎

### 7.1 存储设计

**KV Key**: `relay:priority:rules`

**Value**: JSON 数组

```json
{
  "rules": [
    {
      "id": "r_a1b2c3",
      "priority": 1,
      "provider": "openai",
      "conditions": [
        { "field": "model_prefix", "operator": "starts_with", "value": "gpt-" },
        { "field": "model_prefix", "operator": "starts_with", "value": "o1-" }
      ],
      "enabled": true,
      "createdAt": "2026-05-26T00:00:00Z",
      "updatedAt": "2026-05-26T00:00:00Z"
    }
  ],
  "version": 1
}
```

### 7.2 缓存策略

| 层 | TTL | 说明 |
|----|-----|------|
| 内存缓存 | 60 秒 | Edge Function 内 `Map<string, {data, expiresAt}>` |
| KV 持久层 | 永久 | 写入即生效，读取走缓存 |

**解析优先级**：内存缓存 → KV 读取 → 无规则（走默认 fallback）

**KV 预算**：+1 GET（首次请求或缓存过期），缓存命中时 +0

### 7.3 规则评估引擎

```typescript
// 伪代码 — 请求路由时调用
function evaluatePriorityRules(request: Request): string | null {
  const rules = getCachedRules(); // 内存缓存 → KV
  
  for (const rule of rules) {
    if (!rule.enabled) continue;
    
    const allConditionsMet = rule.conditions.every(condition => {
      return matchCondition(condition, request);
    });
    
    if (allConditionsMet) {
      return rule.provider; // 命中，返回目标供应商
    }
  }
  
  return null; // 无规则命中，走默认 fallback
}

function matchCondition(condition: Condition, request: Request): boolean {
  const fieldValue = extractField(condition.field, request);
  
  switch (condition.operator) {
    case 'equals':       return fieldValue === condition.value;
    case 'starts_with':  return fieldValue.startsWith(condition.value);
    case 'ends_with':    return fieldValue.endsWith(condition.value);
    case 'contains':     return fieldValue.includes(condition.value);
    case 'regex':        return new RegExp(condition.value).test(fieldValue);
  }
}
```

### 7.4 性能约束

| 约束 | 应对 |
|------|------|
| 规则数量上限 | 单租户最多 20 条规则 |
| 单条规则条件上限 | 最多 5 个条件 |
| 正则性能 | 禁止用户输入可能 ReDoS 的正则（前端 + 后端双重校验） |
| 评估复杂度 | O(R × C)，R=20, C=5 → 最多 100 次匹配，< 1ms |
| 冷启动 | 首次请求读 KV（~50ms），后续缓存命中 |

---

## 8. API 设计

### 8.1 Admin API — 规则管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/priority-rules` | 获取所有规则 |
| `POST` | `/api/admin/priority-rules` | 新增规则 |
| `PUT` | `/api/admin/priority-rules/:id` | 更新规则 |
| `DELETE` | `/api/admin/priority-rules/:id` | 删除规则 |
| `PUT` | `/api/admin/priority-rules/reorder` | 批量更新排序 |
| `POST` | `/api/admin/priority-rules/detect` | 检测冲突（可选，前端可本地检测） |

#### GET /api/admin/priority-rules

```json
{
  "rules": [
    {
      "id": "r_a1b2c3",
      "priority": 1,
      "provider": "openai",
      "conditions": [
        { "field": "model_prefix", "operator": "starts_with", "value": "gpt-" }
      ],
      "enabled": true,
      "createdAt": "2026-05-26T00:00:00Z",
      "updatedAt": "2026-05-26T00:00:00Z"
    }
  ],
  "total": 3,
  "maxRules": 20
}
```

#### POST /api/admin/priority-rules

```json
// Request
{
  "provider": "openai",
  "conditions": [
    { "field": "model_prefix", "operator": "starts_with", "value": "gpt-" }
  ],
  "enabled": true
}

// Response
{
  "success": true,
  "rule": {
    "id": "r_a1b2c3",
    "priority": 4,
    "provider": "openai",
    "conditions": [...],
    "enabled": true,
    "createdAt": "2026-05-26T00:00:00Z",
    "updatedAt": "2026-05-26T00:00:00Z"
  }
}
```

#### PUT /api/admin/priority-rules/reorder

```json
// Request — 完整的排序顺序
{
  "order": ["r_a1b2c3", "r_d4e5f6", "r_g7h8i9"]
}

// Response
{
  "success": true,
  "rules": [...] // 更新后的规则列表
}
```

### 8.2 请求链路变更

在现有 `resolveProvider()` 函数前插入规则评估：

```
请求到达
  ├─ evaluatePriorityRules(request) → 命中？使用该供应商
  ├─ 未命中 → 走现有 fallback 逻辑（供应商注册顺序）
  └─ 发送到上游供应商
```

**向后兼容**：无规则时行为与当前完全一致。

---

## 9. 技术约束

| 约束 | 应对 |
|------|------|
| Edge Runtime 内存缓存 | `Map` + TTL，60 秒过期自动刷新 |
| Vercel KV 免费档 3000 次/日 | 内存缓存命中时不走 KV，稳态 +1 GET |
| KV 单 key 1MB 限制 | 20 条规则 ≈ 5KB，远低于限制 |
| Serverless 冷启动 | 首次请求读 KV（~50ms），后续缓存命中 |
| 前端冲突检测性能 | O(R² × C²)，R=20, C=5 → 最多 10000 次比较，< 5ms |
| 正则安全 | 前端禁止 `.*.*.*` 类型正则，后端 regex 执行设 10ms 超时 |

## 10. 用户故事与验收标准

### 10.1 用户故事

#### US-1：按模型前缀指定首选供应商

> 作为**个人开发者**，
> 我想**让 GPT 系列模型优先走 OpenAI、Claude 系列优先走 Anthropic**，
> 以便**获得最佳的模型兼容性和响应质量**。

**验收条件**：
1. 添加规则 #1：`model_prefix starts_with gpt-` → OpenAI
2. 添加规则 #2：`model_prefix starts_with claude-` → Anthropic
3. 拖拽排序使 #1 在 #2 前面
4. 请求 `gpt-4-turbo` 时路由到 OpenAI
5. 请求 `claude-3-5-sonnet` 时路由到 Anthropic

#### US-2：配置主备切换规则

> 作为**运维人员**，
> 我想**配置主供应商故障时自动 fallback 到备用供应商**，
> 以便**保证服务可用性**。

**验收条件**：
1. 添加规则：`model_prefix starts_with gpt-` → OpenAI（#1）
2. 添加规则：`model_prefix starts_with gpt-` → DeepSeek（#2）
3. 冲突检测标红 #2：「与 #1 条件完全重叠」
4. 修改 #2 条件为 `model_prefix starts_with gpt-4-turbo`（更精确）
5. 冲突降级为警告：「与 #1 条件重叠，gpt-4-turbo 是 gpt- 的子集」

#### US-3：禁用临时规则

> 作为**小团队管理员**，
> 我想**临时禁用某条规则而不删除它**，
> 以便**测试规则效果或应对临时需求**。

**验收条件**：
1. 点击规则卡片的 Toggle 开关 → 规则变为禁用态
2. 卡片半透明显示，不参与路由匹配
3. 重新启用后恢复正常

### 10.2 验收检查清单

- [ ] Admin 面板「优先级规则」标签页可查看所有规则
- [ ] 可通过拖拽调整规则优先级顺序
- [ ] 可添加新规则（选择供应商 + 配置条件）
- [ ] 可编辑已有规则的供应商和条件
- [ ] 可删除规则（二次确认）
- [ ] 可禁用/启用规则
- [ ] 冲突检测实时工作，错误/警告有明确视觉反馈
- [ ] 有冲突错误时阻止保存
- [ ] 规则保存后 60 秒内生效（缓存 TTL）
- [ ] 无规则时请求走默认 fallback（向后兼容）
- [ ] 有规则时按 priority 顺序评估，首个命中规则胜出
- [ ] 规则数量不超过 20 条
- [ ] 单条规则条件不超过 5 个
- [ ] 移动端可使用上下箭头调整排序

---

## 11. 指标

| 指标 | 定义 | 目标 |
|------|------|------|
| 规则配置率 | 使用优先级规则的部署实例比例 | > 20% |
| 首次配置成功率 | 用户首次配置规则无冲突错误的比例 | > 70% |
| 规则生效延迟 | 规则保存到请求路由变更的 P95 时间 | ≤ 60s |
| 规则命中率 | 请求被规则命中的比例（vs 走默认 fallback） | > 50%（有规则的实例） |
| KV 调用增量 | 每请求 KV 调用增加量 | +1（冷启动），+0（缓存命中） |

## 12. 风险

| 风险 | 影响 | 应对 |
|------|------|------|
| 规则配置错误导致路由异常 | 请求全部打到错误供应商 | 冲突检测 + 错误阻止保存；禁用规则可快速回滚 |
| 正则表达式性能问题 | ReDoS 导致请求延迟飙升 | 前端禁用危险正则模式，后端 regex 执行 10ms 超时 |
| 缓存不一致 | 修改后最多 60 秒延迟 | 提供「立即生效」按钮（主动清缓存） |
| 规则数量膨胀 | 20 条规则评估仍有开销 | 硬限 20 条 + O(R × C) 线性评估，< 1ms |
| 前端冲突检测精度 | 复杂正则条件的重叠难以静态判断 | 正则类型跳过自动检测，仅提示「请人工确认」 |

---

## 13. 里程碑

### M1：规则存储 + Admin API（1.5 人日）

- KV 存储 `relay:priority:rules`
- 内存缓存 TTL 60s
- Admin API（GET/POST/PUT/DELETE/reorder）
- 单元测试

### M2：规则编辑器 UI（2 人日）

- 规则卡片列表 + 拖拽排序
- 规则编辑弹窗（供应商选择 + 条件配置）
- 规则禁用/启用 Toggle
- 删除二次确认

### M3：冲突检测（1 人日）

- 冲突检测算法（前端本地）
- 冲突可视化（边框颜色 + ⚠️ 徽标 + 文字提示）
- 防抖实时检测

### M4：规则引擎集成（0.5 人日）

- `evaluatePriorityRules()` 接入请求链路
- 向后兼容验证
- 性能测试

**总计**：5 人日

---

## 14. 信息架构变更

```text
Admin Dashboard
├── ...
├── 供应商管理
│   ├── 供应商列表      ← 迭代一
│   └── 优先级规则      ← 本期新增（迭代三）
├── 模型配置            ← 迭代二
├── ...
```

---

## 15. 设计要求

- 规则卡片：沿用 dark glassmorphism 风格，拖拽手柄 `≡` 显示在左侧
- 冲突状态：错误卡片红色描边 `#ef4444`，警告卡片黄色描边 `#f59e0b`
- ⚠️ 徽标：左上角圆形徽标，红色/黄色背景 + 白色感叹号
- 条件标签：等宽字体，tag 样式，`starts_with` 用紫色背景
- 规则编辑弹窗：最大宽度 600px，条件行可增删，供应商下拉带搜索
- 移动端：卡片排序改为上下箭头按钮，编辑弹窗全屏
- 空状态：无规则时展示引导卡片「添加第一条优先级规则」

---

*本文档基于圆桌讨论 rt_262195df 结论编写*
*前置依赖：v2.1（供应商 CRUD + 模板）、v2.2（模型别名 + CSV）*
