export type ProviderHeaderFormat = 'openai' | 'anthropic' | 'azure';

export interface ProviderTemplate {
  id: string;
  label: string;
  description: string;
  name: string;
  displayName: string;
  baseUrl: string;
  headerFormat: ProviderHeaderFormat;
  modelPrefixes: string[];
  envKeyField: string;
  isCustom?: boolean;
  requiresBaseUrl?: boolean;
  requiresModelPrefixes?: boolean;
}

export interface ProviderTemplateForm {
  id: string;
  displayName: string;
  baseUrl: string;
  headerFormat: ProviderHeaderFormat;
  modelPrefixes: string[];
  envKeyField: string;
}

export interface DraftProviderPayload {
  name: string;
  displayName: string;
  baseUrl: string;
  headerFormat: ProviderHeaderFormat;
  modelPrefixes: string[];
  envKeyField: string;
  userAgent?: string;
  models: Array<{
    id: string;
    displayName: string;
    contextWindow: number;
    maxOutput?: number;
    supportsStream?: boolean;
    supportsVision?: boolean;
    supportsTools?: boolean;
    pricing?: { input: number; output: number };
  }>;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT-6 / GPT-6.2 / embeddings / audio models',
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    headerFormat: 'openai',
    modelPrefixes: ['gpt-', 'chatgpt-', 'whisper-', 'tts-', 'text-embedding-'],
    envKeyField: 'OPENAI_KEYS',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude 5.5 / Fable 5.2 via x-api-key auth',
    name: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    headerFormat: 'anthropic',
    modelPrefixes: ['claude-'],
    envKeyField: 'CLAUDE_KEYS',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    description: 'Gemini 4 (Neon / Argon / Hydrogen) & 3.8 Flash OpenAI-compatible endpoint',
    name: 'google',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    headerFormat: 'openai',
    modelPrefixes: ['gemini-'],
    envKeyField: 'GEMINI_KEYS',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    description: 'Unified aggregator for 300+ models via one key',
    name: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    headerFormat: 'openai',
    modelPrefixes: ['openrouter/', 'openai/', 'anthropic/', 'google/', 'deepseek/', 'meta-llama/', 'x-ai/', 'qwen/', 'mistralai/'],
    envKeyField: 'OPENROUTER_KEYS',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    description: 'DeepSeek / Qwen / GLM high-speed OpenAI-compatible API',
    name: 'siliconflow',
    displayName: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    headerFormat: 'openai',
    modelPrefixes: ['deepseek-ai/', 'Qwen/', 'THUDM/', 'Pro/'],
    envKeyField: 'SILICONFLOW_KEYS',
  },
  {
    id: 'aliyun',
    label: '阿里云通义',
    description: 'Qwen / 通义千问 via DashScope OpenAI-compatible API',
    name: 'aliyun',
    displayName: '阿里云通义',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    headerFormat: 'openai',
    modelPrefixes: ['qwen-'],
    envKeyField: 'ALIYUN_KEYS',
  },
  {
    id: 'volcengine',
    label: '火山方舟 Ark',
    description: '豆包 Doubao & DeepSeek via Volcengine Ark OpenAI API',
    name: 'volcengine',
    displayName: '火山方舟 Ark',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    headerFormat: 'openai',
    modelPrefixes: ['doubao-', 'ep-'],
    envKeyField: 'VOLCENGINE_KEYS',
  },
  {
    id: 'zhipu',
    label: '智谱清言 Zhipu',
    description: 'GLM models via BigModel OpenAI-compatible API',
    name: 'zhipu',
    displayName: '智谱清言 Zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    headerFormat: 'openai',
    modelPrefixes: ['glm-'],
    envKeyField: 'ZHIPU_KEYS',
  },
  {
    id: 'baidu',
    label: '百度文心',
    description: 'ERNIE / 文心大模型 via Qianfan OpenAI-compatible API',
    name: 'baidu',
    displayName: '百度文心',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    headerFormat: 'openai',
    modelPrefixes: ['ernie-'],
    envKeyField: 'BAIDU_KEYS',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    description: 'Grok models via xAI OpenAI-compatible API',
    name: 'xai',
    displayName: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    headerFormat: 'openai',
    modelPrefixes: ['grok-'],
    envKeyField: 'XAI_KEYS',
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    description: 'Azure endpoint + deployment prefixes supplied by user',
    name: 'azure_openai',
    displayName: 'Azure OpenAI',
    baseUrl: '',
    headerFormat: 'azure',
    modelPrefixes: [],
    envKeyField: 'AZURE_OPENAI_KEYS',
    requiresBaseUrl: true,
    requiresModelPrefixes: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    description: 'Mistral and Codestral OpenAI-compatible API',
    name: 'mistral',
    displayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    headerFormat: 'openai',
    modelPrefixes: ['mistral-', 'codestral-'],
    envKeyField: 'MISTRAL_KEYS',
  },
  {
    id: 'groq',
    label: 'Groq',
    description: 'Fast OpenAI-compatible Llama / Mixtral / Gemma inference',
    name: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    headerFormat: 'openai',
    modelPrefixes: ['llama-', 'mixtral-', 'gemma-'],
    envKeyField: 'GROQ_KEYS',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek OpenAI-compatible endpoint',
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    headerFormat: 'openai',
    modelPrefixes: ['deepseek-'],
    envKeyField: 'DEEPSEEK_KEYS',
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    description: 'Local Ollama / LM Studio OpenAI-compatible endpoint',
    name: 'ollama',
    displayName: 'Ollama Local',
    baseUrl: 'http://127.0.0.1:11434/v1',
    headerFormat: 'openai',
    modelPrefixes: ['llama', 'qwen', 'mistral', 'gemma'],
    envKeyField: 'OLLAMA_KEYS',
  },
  {
    id: 'custom',
    label: '自定义 / Custom',
    description: 'Manual provider configuration for any compatible upstream',
    name: '',
    displayName: '',
    baseUrl: '',
    headerFormat: 'openai',
    modelPrefixes: [],
    envKeyField: '',
    isCustom: true,
    requiresBaseUrl: true,
    requiresModelPrefixes: true,
  },
];

export function findProviderTemplate(templateId: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((template) => template.id === templateId);
}

export function buildEnvKeyField(providerId: string): string {
  return providerId.trim() ? `${providerId.trim().toUpperCase()}_KEYS` : '';
}

export function applyProviderTemplate(template: ProviderTemplate): ProviderTemplateForm {
  return {
    id: template.name,
    displayName: template.displayName,
    baseUrl: template.baseUrl,
    headerFormat: template.headerFormat,
    modelPrefixes: [...template.modelPrefixes],
    envKeyField: template.envKeyField,
  };
}

export function parseModelPrefixes(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((prefix) => prefix.trim())
    .filter(Boolean);
}

export function buildDraftProvider(input: {
  id: string;
  displayName: string;
  baseUrl: string;
  headerFormat: ProviderHeaderFormat;
  modelPrefixesText: string;
  userAgent?: string;
  models: DraftProviderPayload['models'];
}): DraftProviderPayload {
  const name = input.id.trim();
  const userAgent = input.userAgent?.trim();
  return {
    name,
    displayName: input.displayName.trim(),
    baseUrl: input.baseUrl.trim(),
    headerFormat: input.headerFormat,
    modelPrefixes: parseModelPrefixes(input.modelPrefixesText),
    envKeyField: buildEnvKeyField(name),
    userAgent: userAgent || undefined,
    models: input.models,
  };
}

export const buildDraftProviderFromForm = buildDraftProvider;

export function validateApiKeyInput(apiKey: string, minLength = 20): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return 'missing-api-key';
  }
  if (minLength > 0 && trimmed.length < minLength) {
    return 'api-key-too-short';
  }
  if (/\s/.test(trimmed)) {
    return 'api-key-has-space';
  }
  return null;
}

function isAllowedBaseUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('https://')) return true;
  // Allow plain HTTP only for local/LAN model servers (Ollama, LM Studio, vLLM, Docker host)
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      host === 'host.docker.internal' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  } catch {
    return false;
  }
}

export function validateDraftProvider(provider: DraftProviderPayload): string | null {
  if (!provider.name.trim() || !/^[a-zA-Z0-9_]+$/.test(provider.name.trim())) {
    return 'invalid-provider-id';
  }
  if (!provider.displayName.trim()) {
    return 'missing-display-name';
  }
  if (!isAllowedBaseUrl(provider.baseUrl)) {
    return 'invalid-base-url';
  }
  if (!provider.modelPrefixes.length) {
    return 'missing-model-prefixes';
  }
  return null;
}
