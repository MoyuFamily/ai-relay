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
    description: 'GPT / o-series / embeddings / audio models',
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    headerFormat: 'openai',
    modelPrefixes: ['gpt-', 'o1-', 'o3-', 'dall-e-', 'whisper-', 'tts-', 'text-embedding-'],
    envKeyField: 'OPENAI_KEYS',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude family via x-api-key auth',
    name: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    headerFormat: 'anthropic',
    modelPrefixes: ['claude-'],
    envKeyField: 'ANTHROPIC_KEYS',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    description: 'Gemini models through OpenAI-compatible relay headers',
    name: 'google',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    headerFormat: 'openai',
    modelPrefixes: ['gemini-'],
    envKeyField: 'GOOGLE_KEYS',
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
  models: DraftProviderPayload['models'];
}): DraftProviderPayload {
  const name = input.id.trim();
  return {
    name,
    displayName: input.displayName.trim(),
    baseUrl: input.baseUrl.trim(),
    headerFormat: input.headerFormat,
    modelPrefixes: parseModelPrefixes(input.modelPrefixesText),
    envKeyField: buildEnvKeyField(name),
    models: input.models,
  };
}

export const buildDraftProviderFromForm = buildDraftProvider;

export function validateApiKeyInput(apiKey: string): string | null {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return 'missing-api-key';
  }
  if (trimmed.length < 20) {
    return 'api-key-too-short';
  }
  if (/\s/.test(trimmed)) {
    return 'api-key-has-space';
  }
  return null;
}

export function validateDraftProvider(provider: DraftProviderPayload): string | null {
  if (!provider.name.trim() || !/^[a-zA-Z0-9_]+$/.test(provider.name.trim())) {
    return 'invalid-provider-id';
  }
  if (!provider.displayName.trim()) {
    return 'missing-display-name';
  }
  if (!provider.baseUrl.trim() || !provider.baseUrl.trim().startsWith('https://')) {
    return 'invalid-base-url';
  }
  if (!provider.modelPrefixes.length) {
    return 'missing-model-prefixes';
  }
  return null;
}
