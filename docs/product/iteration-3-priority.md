# AI Relay 迭代三 PRD — 优先级规则编辑器 + 冲突检测

> **版本**：v1.0 · **作者**：饼哥（产品总监） · **日期**：2026-05-26
> **状态**：Draft
> **分支**：`feature/relay-ux-iteration`
> **仓库**：`/Users/parsifal/Repo/Service/ai-relay`
> **前置迭代**：迭代一（供应商 CRUD + 模板）、迭代二（模型别名 + CSV）

---

## 1. 背景与目标

### 1.1 问题

当前 AI Relay 的供应商路由采用 **"最长前缀匹配"** 策略（`resolver.ts` L73-91）：当多个供应商声明相同的 modelPrefix 时，系统随机选择一个，管理员无法控制请求的优先级分配。

具体痛点：

- **无优先级控制**：当 OpenAI 和 GW2 Oops Asia 都声明 `gpt-4o` 前缀时，无法指定谁优先
- **无条件路由**：无法实现"国内请求走 DeepSeek，海外请求走 OpenAI"等场景化路由
- **冲突不可见**：多条规则产生歧义时，系统静默选择，管理员无感知
- **Fallback 与优先级割裂**：现有 fallback 链是独立配置，与路由优先级没有统一视图

### 1.2 目标

| 维度 | 指标 |
|------|------|
| 优先级配置完成时间 | 管理员从零到配好 3 条规则 ≤ 2 分钟 |
| 冲突发现率 | 100% 冲突在保存前被前端拦截 |
| 首次操作无求助率 | ≥ 75% 用户不看文档独立完成规则配置 |
| P95 配置生效延迟 | 稳态 ≤ 60s（内存 TTL），冷启动 ≤ 5min |

### 1.3 成功标准

- 管理员通过拖拽排序 + 条件匹配完成供应商优先级配置
- 保存前 100% 冲突被前端实时检测并高亮提示
- 现有 fallback 链机制不受影响（向后兼容）
- 规则限 20 条，KV 开销 +1 GET（缓存后 +0）

---

## 2. 用户故事

### 2.1 运营配置主备切换

> 作为**负责成本优化的运营人员**，
> 我想**配置 OpenAI 为主力供应商、DeepSeek 为备选**，
> 以便**OpenAI 限流时自动降级到 DeepSeek，同时日常请求优先走 OpenAI 保证质量**。

**验收条件**：
1. 打开 Admin → 供应商管理 → 优先级规则
2. 拖拽 OpenAI 到第一位（优先级 1），DeepSeek 到第二位
3. 保存 → 规则立即出现在规则列表中
4. 发送 `gpt-4o` 请求 → 命中 OpenAI；OpenAI 429 后 → 自动 fallback 到 DeepSeek

### 2.2 按条件分流

> 作为**小团队管理员**，
> 我想**对推理类模型（o1/o3）优先走 OpenAI，对普通对话模型优先走国内供应商**，
> 以便**平衡成本和推理质量**。

**验收条件**：
1. 创建规则 A：条件 `model:o1-*` → 优先级 OpenAI > 其他
2. 创建规则 B：条件 `model:gpt-*` → 优先级 DeepSeek > OpenAI
3. 前端实时校验：两条规则无冲突（条件不重叠），边框绿色
4. 保存 → 请求 `o1-mini` 命中规则 A，请求 `gpt-4o` 命中规则 B

### 2.3 发现并修复冲突

> 作为**系统管理员**，
> 我想**在保存前看到规则冲突并修复**，
> 以便**避免路由逻辑混乱导致请求失败**。

**验收条件**：
1. 创建规则 A：`model:gpt-*` → OpenAI 优先
2. 创建规则 B：`model:gpt-4o` → DeepSeek 优先
3. 前端实时检测到冲突：两条规则的条件有交集（`gpt-4o` 同时匹配两条）
4. 规则卡片边框变红 + ⚠️ 徽标 + 文字提示「规则 A 和规则 B 的条件存在交集，`gpt-4o` 将按规则 A 的优先级执行」
5. 管理员调整后冲突消失，边框恢复绿色

## 3. 功能范围

### 本期包含（Iteration 3）

| # | 功能 | 优先级 |
|---|------|--------|
| 1 | 优先级规则编辑器（拖拽排序 + 条件匹配） | P0 |
| 2 | 冲突实时检测（前端本地校验） | P0 |
| 3 | 规则引擎（限 20 条，KV 存储 + 内存缓存） | P0 |
| 4 | 规则生效 — 覆盖 `resolveProvider` 的默认路由 | P0 |
| 5 | 冲突提示 UI（红框 + ⚠️ 徽标 + 文字说明） | P1 |
| 6 | 移动端适配（长按上下箭头替代拖拽） | P1 |
| 7 | 规则导入/导出（JSON 格式） | P2 |

### 本期不包含

- 基于地理位置的自动路由（需要 IP 解析服务）
- 基于请求量的动态负载均衡（属于迭代四）
- 规则版本历史与回滚
- 模型级别的 Token 配额控制（属于迭代四）

---

## 4. 数据结构

### 4.1 优先级规则

```typescript
interface PriorityRule {
  id: string;                    // 唯一 ID，如 'rule_a1b2c3'
  name: string;                  // 规则名称，如 'GPT-4o 走 OpenAI'
  priority: number;              // 优先级排序，数字越小越优先（从 1 开始）
  conditions: Condition[];       // 条件列表（扁平结构，AND 关系）
  targetProvider: string;        // 目标供应商 name，如 'openai'
  enabled: boolean;              // 是否启用
  createdAt: number;             // 创建时间戳
  updatedAt: number;             // 更新时间戳
}

interface Condition {
  field: 'model' | 'provider';   // 匹配字段
  operator: 'prefix' | 'exact' | 'glob';  // 匹配操作符
  value: string;                 // 匹配值，如 'gpt-4o', 'claude-*'
}
```

### 4.2 冲突类型

```typescript
interface ConflictInfo {
  type: 'overlap' | 'duplicate' | 'shadow';
  ruleA: string;                 // 冲突规则 A 的 ID
  ruleB: string;                 // 冲突规则 B 的 ID
  description: string;           // 人类可读描述
  matchedModels: string[];       // 交集中的示例模型 ID
}

// overlap: 条件有交集（如 gpt-* 和 gpt-4o）
// duplicate: 完全相同的条件 + 不同的目标供应商
// shadow: 高优先级规则完全覆盖低优先级规则（低优先级永远不会生效）
```

### 4.3 存储结构

**KV Key**: `relay:priority:rules`

```typescript
// KV 存储格式
interface PriorityRulesStore {
  version: number;               // 格式版本，当前为 1
  rules: PriorityRule[];         // 规则列表，按 priority 排序
  updatedAt: number;             // 最后更新时间戳
}
```

**内存缓存**：
- TTL: 60 秒（复用 `admin-config.ts` 的 `CONFIG_CACHE_TTL_MS` 常量）
- 缓存 Key: `priority:rules`
- 缓存命中时 +0 KV 查询；缓存 miss 时 +1 GET

### 4.4 条件匹配语义

| 操作符 | 语义 | 示例 | 匹配 |
|--------|------|------|------|
| `prefix` | 前缀匹配 | `gpt-4o` | `gpt-4o`, `gpt-4o-mini`, `gpt-4o-2024-08-06` |
| `exact` | 精确匹配 | `gpt-4o` | 仅 `gpt-4o` |
| `glob` | 通配符匹配 | `gpt-*` | 所有以 `gpt-` 开头的模型 |
| `glob` | 通配符匹配 | `o?-mini` | `o1-mini`, `o3-mini` |

**默认操作符**：`prefix`（最常用，降低配置门槛）

## 5. 规则引擎

### 5.1 路由决策流程

```
请求进入（model: "gpt-4o"）
    │
    ▼
┌─────────────────────────┐
│ 1. 加载优先级规则        │  ← relay:priority:rules（内存 TTL 60s）
│    按 priority 升序排列   │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│ 2. 遍历规则，条件匹配    │  ← 第一条命中的规则胜出
│    model → conditions    │
└─────────┬───────────────┘
          │
    ┌─────┴─────┐
    │ 命中规则？ │
    └─────┬─────┘
     Yes  │  No
     │    │
     ▼    ▼
┌────────┐ ┌──────────────────┐
│ 使用规则│ │ 回退到现有逻辑    │
│ 指定的  │ │ 最长前缀匹配      │
│ 供应商  │ │ (resolver.ts)    │
└────────┘ └──────────────────┘
```

### 5.2 与现有 Fallback 链的关系

| 层级 | 机制 | 作用 |
|------|------|------|
| **路由层**（新增） | 优先级规则 | 决定请求的**首选**供应商 |
| **容错层**（现有） | Fallback 链 | 首选失败后的**降级**供应商 |

优先级规则决定"第一选择去哪"，Fallback 链决定"失败后去哪"。两者独立配置，互不干扰。

### 5.3 规则匹配算法

```typescript
function matchRule(model: string, rules: PriorityRule[]): PriorityRule | null {
  const lowerModel = model.toLowerCase();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const allMatch = rule.conditions.every(c => matchCondition(lowerModel, c));
    if (allMatch) return rule;
  }
  return null;
}

function matchCondition(model: string, cond: Condition): boolean {
  const target = cond.value.toLowerCase();
  switch (cond.operator) {
    case 'prefix': return model.startsWith(target);
    case 'exact':  return model === target;
    case 'glob':   return minimatch(model, target);
  }
}
```

**关键约束**：
- 条件之间为 **AND** 关系（一条规则的所有条件都必须匹配）
- 规则之间为 **优先级顺序** 关系（第一条命中的规则胜出）
- 最多 20 条规则（防止 N² 复杂度）

### 5.4 KV 开销分析

| 场景 | KV 操作 | 说明 |
|------|---------|------|
| 缓存命中 | +0 | 内存直接返回 |
| 缓存 miss | +1 GET | 读取 `relay:priority:rules` |
| 保存规则 | +1 SET | 写入 `relay:priority:rules` + 清除缓存 |

**稳态**：缓存命中，每请求 +0 KV
**峰值**：首次请求或缓存过期，每请求 +1 KV

---

## 6. API 设计

### 6.1 新增端点

#### `GET /api/admin/priority-rules` — 获取所有规则

```typescript
// Response
{
  rules: PriorityRule[];
  total: number;                 // 规则总数
  maxRules: 20;                  // 上限提示
}
```

#### `POST /api/admin/priority-rules` — 创建规则

```typescript
// Request Body
{
  name: string;                  // 规则名称
  conditions: Condition[];       // 条件列表
  targetProvider: string;        // 目标供应商 name
  enabled?: boolean;             // 默认 true
}

// Response
{
  success: boolean;
  rule: PriorityRule;            // 创建后的规则（含自动生成的 id 和 priority）
  conflicts: ConflictInfo[];     // 后端二次校验的冲突列表
}
```

#### `PUT /api/admin/priority-rules/:id` — 更新规则

```typescript
// Request Body（部分更新）
{
  name?: string;
  conditions?: Condition[];
  targetProvider?: string;
  enabled?: boolean;
  priority?: number;             // 拖拽排序后更新
}

// Response
{
  success: boolean;
  rule: PriorityRule;
  conflicts: ConflictInfo[];
}
```

#### `DELETE /api/admin/priority-rules/:id` — 删除规则

```typescript
// Response
{
  success: boolean;
  deleted: { id: string; name: string };
}
```

#### `PUT /api/admin/priority-rules/reorder` — 批量重排

```typescript
// Request Body（拖拽排序后一次性提交）
{
  orderedIds: string[];          // 按新优先级排列的规则 ID 列表
}

// Response
{
  success: boolean;
  rules: PriorityRule[];         // 重排后的完整规则列表
}
```

### 6.2 复用端点

| 端点 | 迭代三改动 |
|------|-----------|
| `GET /api/admin` | 响应中新增 `priorityRulesCount` 字段 |
| `resolveProvider()` | 新增优先级规则匹配逻辑（在现有前缀匹配之前） |

## 7. 冲突检测

### 7.1 检测时机

| 时机 | 检测方式 | 阻断 |
|------|---------|------|
| **编辑时**（实时） | 前端本地校验 | 不阻断，仅高亮提示 |
| **保存时** | 前端 + 后端双重校验 | 阻断保存，展示冲突详情 |

### 7.2 冲突检测算法

```typescript
function detectConflicts(rules: PriorityRule[]): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  const enabled = rules.filter(r => r.enabled);

  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i];
      const b = enabled[j];

      // 检查条件交集
      const overlap = findConditionOverlap(a.conditions, b.conditions);
      if (overlap) {
        if (a.targetProvider === b.targetProvider) {
          // shadow: 同一目标，低优先级永远不会生效
          conflicts.push({
            type: 'shadow',
            ruleA: a.id,
            ruleB: b.id,
            description: `规则「${b.name}」被「${a.name}」完全覆盖，永远不会生效`,
            matchedModels: overlap,
          });
        } else {
          // overlap: 不同目标，按优先级执行
          conflicts.push({
            type: 'overlap',
            ruleA: a.id,
            ruleB: b.id,
            description: `「${a.name}」和「${b.name}」的条件存在交集，${overlap.join(', ')} 将按「${a.name}」的优先级执行`,
            matchedModels: overlap,
          });
        }
      }
    }
  }
  return conflicts;
}
```

### 7.3 冲突严重程度

| 类型 | 严重程度 | UI 表现 | 能否保存 |
|------|---------|---------|---------|
| `overlap` | ⚠️ 警告 | 黄色边框 + ⚠️ 徽标 | 可以保存（高优先级规则胜出） |
| `duplicate` | 🔴 错误 | 红色边框 + ❌ 徽标 | 不可保存（必须修改） |
| `shadow` | ⚠️ 警告 | 黄色边框 + 👻 徽标 | 可以保存（但建议删除低优先级规则） |

### 7.4 示例场景

**场景 1：条件交集（overlap）**
```
规则 A（优先级 1）：model prefix "gpt-" → OpenAI
规则 B（优先级 2）：model prefix "gpt-4o" → DeepSeek

冲突：gpt-4o 同时匹配两条规则，按规则 A 执行
提示：⚠️ 「GPT 全系列走 OpenAI」和「GPT-4o 走 DeepSeek」的条件存在交集，gpt-4o, gpt-4o-mini 将按「GPT 全系列走 OpenAI」的优先级执行
```

**场景 2：完全覆盖（shadow）**
```
规则 A（优先级 1）：model prefix "claude-" → Anthropic
规则 B（优先级 2）：model prefix "claude-3" → Anthropic

冲突：规则 B 被规则 A 完全覆盖
提示：👻 规则「Claude 3 系列」被「Claude 全系列」完全覆盖，永远不会生效
```

**场景 3：无冲突**
```
规则 A（优先级 1）：model prefix "gpt-" → OpenAI
规则 B（优先级 2）：model prefix "claude-" → Anthropic

无冲突：条件无交集
```

---

## 8. 交互规范

### 8.1 优先级规则编辑器

**页面位置**：Admin → 供应商管理 → 优先级规则 Tab

**布局**：
```
┌─────────────────────────────────────────────────┐
│  优先级规则                              [+ 新建] │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ ≡ 规则 1: GPT 全系列走 OpenAI        ⚠️ 编辑 │ │
│  │   条件: model prefix "gpt-"                 │ │
│  │   目标: OpenAI                              │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ ≡ 规则 2: Claude 走 Anthropic         ✕ 删除 │ │
│  │   条件: model prefix "claude-"              │ │
│  │   目标: Anthropic                           │ │
│  └─────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────┐ │
│  │ ≡ 规则 3: DeepSeek 走国内            ✕ 删除 │ │
│  │   条件: model prefix "deepseek-"            │ │
│  │   目标: DeepSeek                            │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  已用 3/20 条 · 稳态 KV +0                        │
└─────────────────────────────────────────────────┘
```

**交互细节**：
- **拖拽排序**：左侧 `≡` 图标为拖拽手柄，拖拽后自动更新 priority
- **新建规则**：点击「+ 新建」弹出 Modal，填写名称、条件、目标供应商
- **编辑规则**：点击「编辑」展开内联编辑区域
- **删除规则**：点击「✕」二次确认后删除
- **实时冲突提示**：编辑时实时检测，冲突卡片边框变色 + 徽标

### 8.2 条件编辑器

```
┌─────────────────────────────────────────────────┐
│  条件配置                                         │
│                                                   │
│  [model ▾] [prefix ▾] [gpt-4o        ] [+ 添加] │
│  [model ▾] [exact  ▾] [claude-3-5-son] [+ 添加] │
│                                                   │
│  条件关系: AND（所有条件都必须匹配）               │
└─────────────────────────────────────────────────┘
```

- **field 下拉**：model / provider
- **operator 下拉**：prefix / exact / glob
- **value 输入**：文本输入，支持自动补全（基于已知模型列表）
- **添加/删除**：可添加多个条件，每个条件右侧有删除按钮

### 8.3 冲突提示 UI

**警告级别（可保存）**：
```
┌─────────────────────────────────────────────┐ ⚠️
│ 规则 1: GPT 全系列走 OpenAI                   │
│ 条件: model prefix "gpt-"                     │
│ 目标: OpenAI                                  │
│                                               │
│ ⚠️ 与「GPT-4o 走 DeepSeek」条件存在交集        │
│    gpt-4o, gpt-4o-mini 将按本规则执行          │
└─────────────────────────────────────────────┘
```
- 边框：`2px solid #f59e0b`（amber-500）
- 徽标：⚠️ 黄色圆点
- 文字：amber-700 色

**错误级别（不可保存）**：
```
┌─────────────────────────────────────────────┐ ❌
│ 规则 1: GPT 全系列走 OpenAI                   │
│                                               │
│ ❌ 规则重复：已存在相同条件的规则               │
└─────────────────────────────────────────────┘
```
- 边框：`2px solid #ef4444`（red-500）
- 徽标：❌ 红色圆点
- 文字：red-700 色

### 8.4 移动端适配

| 交互 | 桌面 | 移动端 |
|------|------|--------|
| 排序 | 拖拽 | 长按 + 上下箭头按钮 |
| 条件编辑 | 内联 | Modal 弹窗 |
| 冲突提示 | 卡片内嵌 | Toast 通知 + 卡片高亮 |

## 9. 技术实现

### 9.1 文件结构

```
src/
├── lib/
│   ├── priority/
│   │   ├── rules.ts              # 规则引擎核心（加载、匹配、冲突检测）
│   │   ├── conditions.ts         # 条件匹配逻辑（prefix/exact/glob）
│   │   ├── conflicts.ts          # 冲突检测算法
│   │   └── types.ts              # 类型定义
│   └── providers/
│       └── resolver.ts           # 修改：resolveProvider 增加规则匹配
├── app/
│   ├── api/admin/priority-rules/
│   │   ├── route.ts              # GET/POST 规则列表
│   │   ├── [id]/route.ts         # PUT/DELETE 单条规则
│   │   └── reorder/route.ts      # PUT 批量重排
│   └── admin/components/
│       ├── PriorityRulesTab.tsx   # 规则编辑器主组件
│       ├── RuleCard.tsx           # 单条规则卡片
│       ├── ConditionEditor.tsx    # 条件编辑器
│       └── ConflictBadge.tsx      # 冲突徽标组件
```

### 9.2 resolver.ts 改动

```typescript
// 新增：在 resolveProvider 之前检查优先级规则
export async function resolveProvider(model: string): Promise<ProviderConfig | null> {
  const resolved = resolveModelAlias(model);

  // 1. 优先级规则匹配（新增）
  const { matchPriorityRule } = await import('../priority/rules');
  const rule = await matchPriorityRule(resolved);
  if (rule) {
    const allProviders = await getAllProviders();
    const provider = allProviders[rule.targetProvider];
    if (provider) return provider;
  }

  // 2. 原有最长前缀匹配（兜底）
  const lowerModel = resolved.toLowerCase();
  let bestProvider: ProviderConfig | null = null;
  let longestPrefixLength = 0;

  const allProviders = await getAllProviders();
  for (const provider of Object.values(allProviders)) {
    for (const prefix of provider.modelPrefixes) {
      if (lowerModel.startsWith(prefix)) {
        if (prefix.length > longestPrefixLength) {
          longestPrefixLength = prefix.length;
          bestProvider = provider;
        }
      }
    }
  }
  return bestProvider;
}
```

### 9.3 KV Key 追加

在 `kv-keys.ts` 中新增：

```typescript
export const kvKeys = {
  // ... 现有 keys ...
  priorityRules: () => 'relay:priority:rules',
};
```

### 9.4 内存缓存

复用 `admin-config.ts` 的缓存模式：

```typescript
const PRIORITY_RULES_CACHE_KEY = 'priority:rules';
const PRIORITY_RULES_TTL_MS = 60_000; // 60s

export async function getPriorityRules(forceRefresh = false): Promise<PriorityRule[]> {
  if (!forceRefresh) {
    const cached = getCached<PriorityRule[]>(PRIORITY_RULES_CACHE_KEY);
    if (cached) return cached;
  }
  const kv = await getKV();
  const raw = await kv.get('relay:priority:rules');
  const store: PriorityRulesStore = raw ? JSON.parse(raw) : { version: 1, rules: [], updatedAt: 0 };
  setCached(PRIORITY_RULES_CACHE_KEY, store.rules, PRIORITY_RULES_TTL_MS);
  return store.rules;
}
```

---

## 10. 验收标准

### 10.1 功能验收

| # | 场景 | 预期结果 |
|---|------|---------|
| 1 | 创建 3 条优先级规则 | 规则列表显示 3 条，priority 从 1 开始 |
| 2 | 拖拽调整顺序 | 规则顺序更新，priority 自动重算 |
| 3 | 条件有交集时 | 卡片边框变黄 + ⚠️ 徽标 + 文字提示 |
| 4 | 条件完全重复时 | 卡片边框变红 + ❌ 徽标，保存按钮禁用 |
| 5 | 保存规则 | KV 写入成功，缓存清除 |
| 6 | 请求匹配规则的模型 | 命中规则指定的供应商 |
| 7 | 请求不匹配任何规则 | 回退到原有最长前缀匹配 |
| 8 | 规则数达到 20 条 | 新建按钮禁用，提示已达上限 |
| 9 | 禁用某条规则 | 请求不再命中该规则 |
| 10 | 删除规则 | 规则从列表移除，KV 更新 |

### 10.2 性能验收

| 指标 | 阈值 | 测试方法 |
|------|------|---------|
| 规则加载延迟 | 缓存命中 ≤ 1ms | 连续请求 100 次，P99 ≤ 1ms |
| 冲突检测延迟 | 20 条规则 ≤ 50ms | 前端性能 Profiler |
| KV 开销 | 稳态 +0 | 监控 KV 调用计数 |
| 配置生效延迟 | 稳态 ≤ 60s | 修改规则后计时 |

### 10.3 兼容性验收

| 场景 | 预期 |
|------|------|
| 无规则时 | 行为与迭代二完全一致 |
| 有规则但不匹配 | 回退到最长前缀匹配 |
| 规则 + Fallback | 规则决定首选，Fallback 决定降级 |
| 现有 Admin 功能 | 不受影响 |

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 规则引擎 N² 复杂度 | 20 条规则时 190 次比较 | 限制 20 条上限 + 前端实时检测（不阻塞请求链路） |
| 缓存不一致 | 修改后 60s 内请求仍命中旧规则 | 保存时主动清除缓存 + 前端提示"配置将在 60s 内生效" |
| glob 匹配性能 | minimatch 库可能较重 | 仅在条件使用 glob 时调用，prefix/exact 用原生字符串操作 |
| KV 单 key 限制 | 20 条规则 JSON 可能接近 1MB | 乐观估计 20 条规则 JSON < 10KB，无需拆分 |
| 前端状态管理 | 拖拽 + 实时检测状态复杂 | 使用 React DnD + useReducer 集中管理 |

---

## 12. 工作量估算

| 模块 | 工作量 | 负责人 |
|------|--------|--------|
| 规则引擎核心（rules.ts + conditions.ts） | 1.5 人日 | 码飞 |
| 冲突检测算法（conflicts.ts） | 1 人日 | 码飞 |
| API 端点（4 个） | 1 人日 | 码飞 |
| resolver.ts 改动 | 0.5 人日 | 码飞 |
| 前端规则编辑器 | 2 人日 | 码飞 + 像素姐 |
| 冲突提示 UI | 0.5 人日 | 像素姐 |
| 移动端适配 | 0.5 人日 | 像素姐 |
| 测试 + 联调 | 1 人日 | 全员 |

**总计**：约 **5 人日**（2 名全栈并行约 **1 周**）

---

## 附录 A：圆桌讨论纪要

详见 `docs/internal/roundtable-ux-improvements.md`（讨论 ID: rt_262195df）

## 附录 B：相关代码文件

| 文件 | 说明 |
|------|------|
| `src/lib/providers/resolver.ts` | 现有路由逻辑，需改造 |
| `src/lib/admin/admin-config.ts` | KV 缓存模式参考 |
| `src/lib/usage/storage/kv-keys.ts` | KV Key 定义 |
| `src/lib/relay/relay.ts` | 核心 Relay 逻辑 |
| `src/lib/providers/registry.ts` | 供应商注册表 |
