# AI Relay 迭代一 PRD：供应商 CRUD + 模板

> **版本**：v1.0 · **作者**：饼哥（产品总监） · **日期**：2026-05-26
> **分支**：`feature/relay-ux-iteration`
> **仓库**：`/Users/parsifal/Repo/Service/ai-relay`

---

## 1. 背景与目标

### 1.1 问题

当前 AI Relay Admin 的供应商管理存在以下痛点：

- **手动配置门槛高**：新增供应商需要手动填写 baseUrl、headerFormat、modelPrefixes 等字段，新用户容易出错
- **无连通性反馈**：配置完 API Key 后无法立即验证是否可用，只能等真实请求失败才发现问题
- **缺少引导流程**：散落在 Keys Tab 各处的操作入口，没有清晰的线性路径

### 1.2 目标

| 维度 | 指标 |
|------|------|
| 首次操作无求助率 | ≥ 80% 用户不看文档独立完成供应商添加 |
| 配置完成时间 | 新用户从零到可用 ≤ 3 分钟 |
| 配置错误率 | 模板创建场景下字段错误率 ≤ 5% |

### 1.3 成功标准

- 用户通过模板完成供应商创建并成功发出测试请求
- 连通性测试返回真实可用/不可用状态
- 现有自定义供应商流程不受影响（向后兼容）

---

## 2. 用户故事

### 2.1 新用户首次添加供应商

> 作为**刚部署 AI Relay 的开发者**，
> 我想**快速添加 OpenAI 供应商并验证 API Key 可用**，
> 以便**5 分钟内发出第一条真实请求**。

**验收条件**：
1. 打开 Admin → 看到「快速开始」引导或供应商列表中的「添加供应商」按钮
2. 选择 OpenAI 模板 → 自动填充 baseUrl、headerFormat、modelPrefixes
3. 填入 API Key → 点击「测试连接」→ 看到延迟和可用模型列表
4. 点击「保存」→ 供应商出现在列表中，状态显示「正常」

### 2.2 运营人员添加国内供应商

> 作为**负责成本优化的运营人员**，
> 我想**添加阿里云通义和百度文心作为备选供应商**，
> 以便**在 OpenAI 限流时自动 fallback 到国内供应商**。

**验收条件**：
1. 从模板列表选择「阿里云通义」→ 自动填充 baseUrl 和 headerFormat
2. 填入 API Key → 测试通过
3. 保存后供应商列表显示新条目，可拖拽调整优先级（迭代三范围）

### 2.3 管理员编辑现有供应商

> 作为**系统管理员**，
> 我想**更新某个供应商的 API Key 或修改 baseUrl**，
> 以便**密钥轮换或切换代理地址**。

**验收条件**：
1. 在供应商列表中点击某供应商的「编辑」按钮
2. 进入编辑模式，预填现有配置
3. 修改后测试 → 保存 → 配置生效

### 2.4 管理员删除供应商

> 作为**系统管理员**，
> 我想**移除不再使用的供应商**，
> 以便**减少列表干扰和无效 fallback**。

**验收条件**：
1. 点击供应商的「删除」按钮 → 弹出确认对话框
2. 确认后供应商从列表移除
3. 关联的 API Keys 同步清除

---

## 3. 功能清单

### P0 — 必须交付

| # | 功能 | 说明 |
|---|------|------|
| P0-1 | 供应商模板化创建 | 预置 7 个模板 + 自定义，三步 Stepper 引导 |
| P0-2 | Stepper 三步引导流程 | 选模板 → 配密钥 → 测试保存 |
| P0-3 | 连通性测试 | 保存前测试 API Key 可用性，返回延迟和可用模型 |
| P0-4 | 供应商列表展示 | 表格形式展示所有供应商，含状态、Key 数量、可用数 |
| P0-5 | 供应商编辑 | 修改已有供应商的 Key、baseUrl 等配置 |
| P0-6 | 供应商删除 | 删除供应商及关联 Key，需二次确认 |
| P0-7 | 向后兼容 | 现有 env var 方式配置的供应商继续正常工作 |

### P1 — 重要但可降级

| # | 功能 | 说明 |
|---|------|------|
| P1-1 | 多 Key 管理 | 每个供应商支持多个 API Key，round-robin 轮换 |
| P1-2 | Key 脱敏展示 | 列表中 API Key 显示为 `sk-***abc` 格式 |
| P1-3 | 测试结果详情 | 展示命中模型列表、延迟、stream/vision/tools 能力 |
| P1-4 | 空状态引导 | 无供应商时展示引导卡片，引导进入创建流程 |
| P1-5 | 错误提示优化 | API Key 无效、网络超时等场景的友好错误信息 |

### P2 — 锦上添花

| # | 功能 | 说明 |
|---|------|------|
| P2-1 | 模板搜索/过滤 | 模板列表支持关键词搜索 |
| P2-2 | 批量导入 Key | 支持粘贴多个 Key（换行分隔） |
| P2-3 | 创建成功动画 | 轻量庆祝效果（绿色勾 + 淡入） |
| P2-4 | 国内供应商额外模板 | 阿里云通义、百度文心、智谱 GLM |

---

## 4. 模板数据定义

### 4.1 预置模板清单

| 模板 ID | 显示名 | baseUrl | headerFormat | modelPrefixes | envKeyField | 备注 |
|---------|--------|---------|-------------|---------------|-------------|------|
| `openai` | OpenAI | `https://api.openai.com/v1` | `openai` | `gpt-`, `o1-`, `o3-`, `dall-e-`, `whisper-`, `tts-`, `text-embedding-` | `OPENAI_KEYS` | 默认首选 |
| `anthropic` | Anthropic | `https://api.anthropic.com` | `anthropic` | `claude-` | `ANTHROPIC_KEYS` | x-api-key 认证 |
| `google` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | `openai` | `gemini-` | `GOOGLE_KEYS` | OpenAI 兼容中继 |
| `azure` | Azure OpenAI | *(用户填写)* | `azure` | *(用户填写)* | `AZURE_OPENAI_KEYS` | 需自定义 baseUrl |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | `openai` | `mistral-`, `codestral-` | `MISTRAL_KEYS` | |
| `groq` | Groq | `https://api.groq.com/openai/v1` | `openai` | `llama-`, `mixtral-`, `gemma-` | `GROQ_KEYS` | 快速推理 |
| `deepseek` | DeepSeek | `https://api.deepseek.com/v1` | `openai` | `deepseek-` | `DEEPSEEK_KEYS` | |
| `custom` | 自定义 | *(用户填写)* | `openai`(默认) | *(用户填写)* | *(用户填写)* | 全手动配置 |

### 4.2 模板数据结构

```typescript
interface ProviderTemplate {
  id: string;                    // 唯一标识，如 'openai'
  label: string;                 // 显示名称，如 'OpenAI'
  description: string;           // 一句话描述
  name: string;                  // 内部 provider name
  displayName: string;           // 展示用名称
  baseUrl: string;               // 上游 API 地址
  headerFormat: 'openai' | 'anthropic' | 'azure';  // 认证头格式
  modelPrefixes: string[];       // 模型 ID 前缀，用于路由匹配
  envKeyField: string;           // 对应的环境变量名
  isCustom?: boolean;            // 是否自定义模板
  requiresBaseUrl?: boolean;     // 是否需要用户填写 baseUrl
  requiresModelPrefixes?: boolean;  // 是否需要用户填写 modelPrefixes
}
```

### 4.3 headerFormat 说明

| 格式 | Authorization Header | 典型供应商 |
|------|---------------------|-----------|
| `openai` | `Authorization: Bearer <key>` | OpenAI、Groq、Mistral、DeepSeek、Gemini |
| `anthropic` | `x-api-key: <key>` | Anthropic |
| `azure` | `api-key: <key>` | Azure OpenAI |

### 4.4 自定义模板特殊规则

自定义模板（`isCustom: true`）要求用户手动填写：
- **baseUrl**（必填）：上游 API 地址，需校验 URL 格式
- **modelPrefixes**（必填）：至少一个前缀，逗号分隔
- **headerFormat**（必填）：下拉选择，默认 `openai`
- **envKeyField**（自动）：基于 provider name 自动生成，如 `custom_xxx_KEYS`

---

## 5. Stepper 三步引导流程

### 5.1 流程概览

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Step 1     │    │  Step 2     │    │  Step 3     │
│  选择模板    │ →  │  配置密钥    │ →  │  测试保存    │
│             │    │             │    │             │
│ 模板卡片网格 │    │ API Key 输入 │    │ 连通性测试   │
│ 搜索过滤    │    │ baseUrl 编辑 │    │ 结果展示     │
│ 自定义入口   │    │ 高级选项折叠 │    │ 保存/返回    │
└─────────────┘    └─────────────┘    └─────────────┘
```

### 5.2 Step 1 — 选择模板

**入口**：
- 供应商列表顶部「添加供应商」按钮（主入口）
- Setup Wizard 中「添加 Provider Key」步骤（集成入口）
- 空状态页面的引导卡片

**交互规范**：
- 模板以卡片网格展示（桌面 3 列，平板 2 列，手机 1 列）
- 每张卡片包含：供应商 Logo/图标、名称、一句话描述
- 自定义模板卡片放在最后，使用虚线边框区分
- 支持关键词搜索（匹配 label 和 description）
- 点击卡片选中，高亮边框，进入下一步

**预选逻辑**：
- 如果通过 Setup Wizard 进入且已有环境变量 Key，自动预选对应模板
- 自定义模板选中后直接跳过 Step 1 进入 Step 2

### 5.3 Step 2 — 配置密钥

**必填字段**：
- **API Key**：password 输入框，可切换明文显示
  - 校验：非空、长度 ≥ 20 字符、不含空格
  - 支持多 Key（换行分隔，P1 范围）

**自动填充字段**（来自模板，可编辑）：
- **Base URL**：text 输入框，校验 URL 格式
  - 自定义模板必填
  - 预置模板预填但允许覆盖（如使用代理地址）
- **Header Format**：下拉选择，预填但允许修改
- **Model Prefixes**：tag 输入，预填但允许增删

**高级选项**（默认折叠）：
- 自定义 Base URL（预置模板场景）
- Fallback 供应商链配置

**导航**：
- 「上一步」返回模板选择
- 「测试连接」进入 Step 3（同时触发测试）

### 5.4 Step 3 — 测试保存

**测试流程**：
1. 点击「测试连接」→ 显示 loading 状态
2. 后端调用目标供应商 API（轻量请求，如 `/models` 或简单 completion）
3. 返回结果卡片

**成功卡片**：
- ✅ 绿色状态指示
- 延迟：xxx ms
- 可用模型列表（最多展示 10 个，可展开）
- 支持能力标签：Stream / Vision / Tools
- 「保存供应商」按钮

**失败卡片**：
- ❌ 红色状态指示
- 错误类型：认证失败 / 网络超时 / 无效 Key / 未知错误
- 可读错误摘要（脱敏，不暴露完整 Key）
- 「返回修改」和「重试」按钮

**保存逻辑**：
- 点击「保存供应商」→ 写入 KV → 返回供应商列表
- 保存后自动刷新列表，新供应商出现在列表中
- 保存成功后显示轻量 toast 提示

### 5.5 Stepper 状态管理

```typescript
interface StepperState {
  currentStep: 1 | 2 | 3;
  selectedTemplate: ProviderTemplate | null;
  form: {
    apiKey: string;
    baseUrl: string;
    headerFormat: 'openai' | 'anthropic' | 'azure';
    modelPrefixes: string[];
    displayName: string;
  };
  testResult: {
    status: 'idle' | 'loading' | 'success' | 'error';
    latency?: number;
    models?: string[];
    capabilities?: { stream: boolean; vision: boolean; tools: boolean };
    error?: { type: string; message: string };
  } | null;
}
```

---

## 6. 连通性测试

### 6.1 测试策略

| 供应商类型 | 测试方式 | 请求内容 | 预期响应 |
|-----------|---------|---------|---------|
| OpenAI 兼容 | `GET /v1/models` | 无需 body | 200 + model list |
| Anthropic | `POST /v1/messages` | `{"model":"claude-3-haiku-20240307","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}` | 200 + completion |
| Azure | `GET /openai/deployments?api-version=2024-02-01` | 无需 body | 200 + deployment list |
| 自定义 | 尝试 `GET {baseUrl}/models` | 无需 body | 200 或 401（Key 有效但权限不足也算通过） |

### 6.2 测试结果判定

```
测试结果分类：
├── 成功 (success)
│   ├── 完全可用：200 + 有效响应体
│   └── Key 有效但受限：403/429 + 有效错误体（Key 本身没问题）
├── 部分成功 (partial)
│   └── models 端点不可用但其他端点可能正常（提示用户）
└── 失败 (error)
    ├── 认证失败：401 / 403 + 无效 Key 消息
    ├── 网络错误：超时 / DNS 解析失败 / 连接拒绝
    └── 未知错误：其他 5xx / 响应格式异常
```

### 6.3 超时与重试

- 单次测试超时：**10 秒**
- 不自动重试（用户手动点击「重试」）
- 超时提示：「连接超时，请检查网络或 Base URL 是否正确」

### 6.4 安全规则

- **API Key 不回传前端**：测试过程中 Key 只在服务端使用，前端只看到测试结果
- **错误信息脱敏**：不暴露完整 Authorization header 或 Key 值
- **测试请求不计入用量**：连通性测试产生的 token 不计入用户配额

---

## 7. API 设计

### 7.1 新增 API 端点

#### `POST /api/admin/providers` — 创建供应商

```typescript
// Request Body
{
  name: string;              // provider 内部名，如 'openai'
  displayName: string;       // 展示名
  baseUrl: string;           // 上游地址
  headerFormat: 'openai' | 'anthropic' | 'azure';
  modelPrefixes: string[];   // 模型前缀
  apiKey: string;            // API Key（明文传输，HTTPS 保护）
  envKeyField: string;       // 环境变量字段名
  testBeforeSave?: boolean;  // 是否先测试再保存，默认 true
}

// Response
{
  success: boolean;
  provider: ProviderInfo;    // 创建后的供应商信息
  testResult?: {             // 如果 testBeforeSave=true
    status: 'success' | 'error';
    latency?: number;
    models?: string[];
    error?: string;
  };
}
```

#### `PUT /api/admin/providers/:name` — 更新供应商

```typescript
// Request Body（部分更新）
{
  displayName?: string;
  baseUrl?: string;
  headerFormat?: 'openai' | 'anthropic' | 'azure';
  modelPrefixes?: string[];
  apiKey?: string;           // 新增 Key（追加到 Key Pool）
  replaceKeys?: string[];    // 完整替换 Key 列表
}
```

#### `DELETE /api/admin/providers/:name` — 删除供应商

```typescript
// Response
{
  success: boolean;
  deleted: {
    name: string;
    keysRemoved: number;     // 移除的 Key 数量
  };
}
```

#### `POST /api/admin/providers/test` — 连通性测试

```typescript
// Request Body
{
  baseUrl: string;
  headerFormat: 'openai' | 'anthropic' | 'azure';
  apiKey: string;
  providerHint?: string;     // 可选，帮助选择测试策略
}

// Response
{
  status: 'success' | 'partial' | 'error';
  latency: number;           // 毫秒
  models?: Array<{
    id: string;
    name?: string;
  }>;
  capabilities?: {
    stream: boolean;
    vision: boolean;
    tools: boolean;
  };
  error?: {
    type: 'auth' | 'network' | 'timeout' | 'unknown';
    message: string;         // 脱敏后的错误信息
    httpStatus?: number;
  };
}
```

### 7.2 复用现有端点

| 端点 | 用途 | 迭代一改动 |
|------|------|-----------|
| `GET /api/admin` | 获取 Admin 数据（含供应商列表） | 无改动 |
| `POST /api/admin/keys` | 管理 API Key | 无改动，新创建流程内部调用 |
| `GET /api/admin/templates` | 获取模板列表 | 新增端点，返回预置模板 |

#### `GET /api/admin/templates` — 获取供应商模板

```typescript
// Response
{
  templates: ProviderTemplate[];
}
```

---

## 8. UI 交互规范

### 8.1 视觉风格

沿用现有 Admin 的 dark glassmorphism 设计语言：

| 元素 | 规范 |
|------|------|
| 背景 | `radial-gradient(circle at top, #1e293b, #09090b)` |
| 面板 | `rgba(30, 41, 59, 0.45)` + `backdrop-filter: blur(12px)` |
| 边框 | `rgba(255,255,255,0.08)` |
| 主按钮 | 蓝紫渐变，44px 最小高度 |
| 次按钮 | 透明玻璃态 |
| 危险按钮 | 红色描边 |
| 成功色 | `#10b981` |
| 错误色 | `#ef4444` |
| 警告色 | `#f59e0b` |

### 8.2 Stepper 组件规范

- **桌面端**：横向步骤条，3 步，当前步骤蓝紫高亮，已完成步骤绿色勾
- **移动端**：显示 `Step 2 of 3` + 进度条
- 步骤之间可点击返回（不可跳步前进）
- 每步内容区域最大宽度 650px，居中

### 8.3 模板卡片规范

```
┌─────────────────────────┐
│  [Logo]  OpenAI         │
│                         │
│  GPT / o-series /       │
│  embeddings / audio     │
│                         │
│  ● 7 models  ● Ready   │  ← 小标签
└─────────────────────────┘

选中态：边框变为 #60a5fa + 外发光
悬停态：边框变为 rgba(255,255,255,0.15)
```

### 8.4 供应商列表规范

桌面端表格字段：

| 列 | 内容 | 宽度 |
|----|------|------|
| Provider | 名称 + built-in/custom 标签 | 自适应 |
| Status | Status Pill（Healthy/Degraded/Down/Unknown） | 120px |
| Keys | Key 总数 | 80px |
| Available | 可用 Key 数（绿色/红色） | 80px |
| Model Prefixes | 等宽字体，逗号分隔 | 自适应 |
| Actions | 编辑 / 删除 / 测试按钮 | 150px |

移动端：降级为卡片列表，每个供应商一张卡片。

### 8.5 状态指示灯

| 状态 | 颜色 | 文字 | 说明 |
|------|------|------|------|
| Healthy | `#10b981` | 正常 / Healthy | 最近测试成功 |
| Degraded | `#f59e0b` | 波动 / Degraded | 延迟高或部分失败 |
| Down | `#ef4444` | 不可用 / Down | 测试失败 |
| Unknown | `#6b7280` | 未检查 / Not checked | 新添加未测试 |
| Loading | 旋转 ring | 检测中... | 手动测试进行中 |

### 8.6 删除确认对话框

```
┌──────────────────────────────────────┐
│  ⚠️ 确认删除供应商                    │
│                                      │
│  即将删除 "OpenAI" 及其 3 个 API Key。│
│  此操作不可撤销。                     │
│                                      │
│  [取消]              [确认删除]       │  ← 红色按钮
└──────────────────────────────────────┘
```

---

## 9. 边界条件与异常场景

### 9.1 输入校验

| 字段 | 校验规则 | 错误提示 |
|------|---------|---------|
| API Key | 非空、≥ 20 字符、无空格 | 「API Key 格式不正确」 |
| Base URL | 合法 URL 格式、必须 https（自定义除外） | 「请输入有效的 URL」 |
| Model Prefixes | 至少一个、不含空格 | 「至少需要一个模型前缀」 |
| Display Name | 非空、≤ 50 字符 | 「名称不能为空」 |
| Provider ID (自定义) | 唯一、仅字母数字下划线、≤ 30 字符 | 「ID 已存在」/「格式不正确」 |

### 9.2 异常场景

| 场景 | 处理方式 |
|------|---------|
| KV 不可用 | 保存按钮禁用 + 提示「存储服务不可用，请稍后重试」 |
| 测试超时 | 展示超时提示 + 「重试」按钮，不阻断保存流程 |
| 供应商已存在（同名） | 编辑模式 vs 新建冲突 → 引导用户编辑现有 |
| 删除时有关联请求 | 警告「该供应商近 24h 有 N 条请求记录」，确认后仍可删除 |
| 模板列表加载失败 | 降级到自定义创建流程，显示提示 |
| 网络断开 | 本地校验通过但保存失败 → 保留表单数据 + 重试提示 |
| 多 Key 部分失败 | 测试时展示每个 Key 的独立状态，标记失败 Key |

### 9.3 并发与锁

- 同一供应商不支持并行编辑（最后写入胜出，不做复杂锁机制）
- 保存操作幂等：相同 name 的创建请求转为更新

---

## 10. 数据流与存储

### 10.1 KV 存储结构

| Key Pattern | 类型 | 内容 | TTL |
|-------------|------|------|------|
| `admin:keys:{provider}` | String (JSON) | API Key 数组 `["sk-...","sk-..."]` | 无 |
| `admin:keys:version:{provider}` | String (Number) | Key 版本号（单调递增） | 无 |
| `admin:fallbacks:{provider}` | String (JSON) | Fallback 供应商链 `["openai","anthropic"]` | 无 |
| `relay:provider:health:{provider}` | Hash | 健康状态、延迟、最近检查时间 | 无 |
| `relay:provider:config:{provider}` | Hash | 供应商配置（baseUrl、headerFormat 等） | 无 |

### 10.2 创建流程数据流

```
前端 Stepper
    │
    ├─ Step 1: 选择模板 → 本地 state
    │
    ├─ Step 2: 填写 Key → 本地 state
    │
    └─ Step 3: 测试保存
         │
         ├─ POST /api/admin/providers/test → 测试 API Key
         │
         └─ POST /api/admin/providers → 保存到 KV
              │
              ├─ admin:keys:{provider} = [key1, key2, ...]
              ├─ admin:keys:version:{provider}++
              ├─ clearCache()
              └─ 返回 ProviderInfo
```

### 10.3 KV 预算

迭代一的 KV 开销分析：

| 操作 | KV 调用 | 说明 |
|------|---------|------|
| 加载供应商列表 | +1 GET (缓存 60s) | `admin:keys:*` scan |
| 创建供应商 | +1 SET + 1 INCR | 写入 Key + 版本号 |
| 连通性测试 | +0 | 直接调用上游 API |
| 删除供应商 | +1 DEL | 清除 Key |

**结论**：在现有 KV 预算（25-30 次/请求）内，迭代一不增加稳态开销。

---

## 11. 验收标准

### 11.1 功能验收

| # | 测试场景 | 预期结果 | 优先级 |
|---|---------|---------|--------|
| AC-1 | 选择 OpenAI 模板 → 填入有效 Key → 测试连接 | 成功显示延迟和模型列表 | P0 |
| AC-2 | 选择自定义模板 → 填写 baseUrl/headerFormat/Key → 测试 | 成功连接并保存 | P0 |
| AC-3 | 填入无效 Key → 测试连接 | 显示认证失败错误，不泄露 Key | P0 |
| AC-4 | 测试成功后点击保存 | 供应商出现在列表中，状态正确 | P0 |
| AC-5 | 点击供应商编辑 → 修改 Key → 保存 | 更新成功，新 Key 生效 | P0 |
| AC-6 | 点击供应商删除 → 确认 | 供应商和关联 Key 被移除 | P0 |
| AC-7 | Stepper 中点击「上一步」| 返回上一步，表单数据保留 | P0 |
| AC-8 | 网络断开时保存 | 表单数据不丢失，显示重试提示 | P1 |
| AC-9 | 多 Key 换行输入 → 测试 | 每个 Key 独立测试，展示各自状态 | P1 |
| AC-10 | 搜索模板列表 | 关键词匹配 label/description | P1 |
| AC-11 | 移动端访问 Stepper | 单列布局，步骤可用 | P1 |
| AC-12 | 无供应商时空状态页 | 展示引导卡片和「添加供应商」入口 | P1 |
| AC-13 | 删除有请求记录的供应商 | 显示警告，确认后删除 | P1 |
| AC-14 | env var 配置的供应商 | 正常显示和工作，不受影响 | P0 |

### 11.2 性能验收

| 指标 | 目标 |
|------|------|
| 模板列表加载 | ≤ 200ms |
| 连通性测试响应 | ≤ 10s（含上游延迟） |
| 保存操作 | ≤ 500ms |
| 页面首次渲染 | ≤ 1.5s |

### 11.3 安全验收

| 检查项 | 要求 |
|--------|------|
| API Key 不暴露 | 前端网络请求中不出现完整 Key |
| 错误信息脱敏 | 错误响应不包含 Authorization header |
| HTTPS Only | Base URL 校验强制 https（localhost 除外） |
| CSRF 保护 | POST/PUT/DELETE 端点需 Admin Auth |

---

## 12. i18n Key 建议

| Key | zh | en |
|-----|----|----|
| `providerAdd` | 添加供应商 | Add Provider |
| `providerEdit` | 编辑供应商 | Edit Provider |
| `providerDelete` | 删除供应商 | Delete Provider |
| `providerDeleteConfirm` | 确认删除供应商 | Confirm Delete |
| `providerDeleteDesc` | 即将删除 "{name}" 及其 {count} 个 API Key。此操作不可撤销。 | Will delete "{name}" and its {count} API key(s). This cannot be undone. |
| `stepperSelectTemplate` | 选择模板 | Select Template |
| `stepperConfigureKey` | 配置密钥 | Configure Key |
| `stepperTestSave` | 测试保存 | Test and Save |
| `stepperPrev` | 上一步 | Previous |
| `stepperNext` | 下一步 | Next |
| `testConnection` | 测试连接 | Test Connection |
| `testing` | 测试中... | Testing... |
| `testSuccess` | 连接成功 | Connection successful |
| `testFailed` | 连接失败 | Connection failed |
| `testTimeout` | 连接超时 | Connection timeout |
| `authFailed` | 认证失败，请检查 API Key | Auth failed, check your API Key |
| `networkError` | 网络错误，请检查 Base URL | Network error, check Base URL |
| `latency` | 延迟 | Latency |
| `availableModels` | 可用模型 | Available Models |
| `capabilities` | 支持能力 | Capabilities |
| `saveProvider` | 保存供应商 | Save Provider |
| `searchTemplate` | 搜索模板... | Search templates... |
| `customTemplate` | 自定义 | Custom |
| `customTemplateDesc` | 手动配置任意兼容供应商 | Manually configure any compatible provider |
| `emptyNoProvider` | 暂无供应商，添加您的第一个 | No providers yet. Add your first one. |

---

## 13. 实施计划

### 13.1 任务拆分

| 任务 | 负责人 | 估时 | 依赖 |
|------|--------|------|------|
| T1: 后端 — 创建/更新/删除 API | 码飞 | 1.5d | 无 |
| T2: 后端 — 连通性测试 API | 码飞 | 1d | T1 |
| T3: 后端 — 模板列表 API | 码飞 | 0.5d | 无 |
| T4: 前端 — Stepper 组件 | 码飞 | 1.5d | T1, T3 |
| T5: 前端 — 模板卡片 + 搜索 | 码飞 | 0.5d | T3 |
| T6: 前端 — 连通性测试结果展示 | 码飞 | 0.5d | T2 |
| T7: 前端 — 供应商列表增强（编辑/删除） | 码飞 | 1d | T1 |
| T8: 集成测试 + 边界场景 | 码飞 | 0.5d | T1-T7 |

**总计**：7 人日，1 名全栈开发约 **1.5 周**

### 13.2 里程碑

```
Week 1:
├── Day 1-2: T1 + T3（后端 API 基础）
├── Day 3: T2（连通性测试）
├── Day 4-5: T4 + T5（前端 Stepper + 模板）

Week 2:
├── Day 1: T6 + T7（测试展示 + 列表增强）
├── Day 2: T8（集成测试）
└── Done ✅
```

### 13.3 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 上游 API 测试端点变更 | 低 | 中 | 每个供应商至少 2 个测试端点备选 |
| Anthropic 测试消耗 token | 中 | 低 | 使用最小请求（max_tokens=1），成本可控 |
| Azure API version 差异 | 中 | 中 | 默认使用最新稳定版，配置中允许指定 |
| KV 单 key 超 1MB | 低 | 高 | Key 数量超 100 时拆分存储 |

---

## 14. 与后续迭代的衔接

| 迭代 | 衔接点 | 迭代一预留 |
|------|--------|-----------|
| 迭代二：模型别名 + CSV | 供应商列表需要展示关联模型 | ProviderInfo.models 字段预留 |
| 迭代三：优先级 + 冲突 | 供应商卡片支持拖拽排序 | 列表行支持 draggable 属性 |
| 迭代四：巡检 + 仪表盘 | 连通性状态需要周期刷新 | relay:provider:health:{provider} 存储结构统一 |

---

## 15. 附录

### 15.1 参考文档

- 圆桌讨论纪要：`docs/internal/roundtable-ux-improvements.md`
- 设计规范：`docs/design/ai-relay-v2.1-design-spec.md`
- 现有代码：`src/app/admin/`、`src/lib/admin/admin-config.ts`

### 15.2 现有模板代码

已有的 `provider-templates.ts` 包含 8 个预置模板（含自定义），数据结构可直接复用。迭代一主要工作是：
1. 包装成 Stepper 引导流程
2. 接入连通性测试 API
3. 增强供应商列表的编辑/删除操作

### 15.3 设计决策记录

| 决策 | 选项 | 选择 | 理由 |
|------|------|------|------|
| 创建流程 | 弹窗 vs Stepper | Stepper | 步骤清晰，移动端友好 |
| 测试时机 | 保存后 vs 保存前 | 保存前 | 避免保存无效配置 |
| 模板数量 | 5 个 vs 全部 | 8 个（含自定义） | 覆盖主流，不过度膨胀 |
| 多 Key 管理 | 内联 vs 独立页 | Step 2 内联 | 减少页面跳转 |

---

*文档结束 · 饼哥 🥧 · 2026-05-26*
