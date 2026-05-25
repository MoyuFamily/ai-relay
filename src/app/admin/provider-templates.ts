import type { ProviderConfig } from '@/lib/providers/types';

export type ProviderTemplateId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'aliyun'
  | 'baidu'
  | 'azure'
  | 'custom';

export interface ProviderTemplate {
  id: ProviderTemplateId;
  label: string;
  description: string;
  name: string;
  displayName: string;
  baseUrl: string;
  headerFormat: ProviderConfig['headerFormat'];
  modelPrefixes: string[];
  envKeyField: string;
  accentColor: string;
  badge?: string;
  testModel?: string;
  isCustom?: boolean;
  requiresBaseUrl?: boolean;
  requiresModelPrefixes?: boolean;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'GPT / o 系列模型，默认首选模板',
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    headerFormat: 'openai',
    modelPrefixes: ['gpt-', 'o1-', 'o3-', 'o4-', 'dall-e-', 'whisper-', 'tts-', 'text-embedding-'],
    envKeyField: 'OPENAI_KEYS',
    accentColor: '#10b981',
    badge: 'Popular',
    testModel: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude 系列，使用 x-api-key 认证',
    name: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    headerFormat: 'anthropic',
    modelPrefixes: ['claude-'],
    envKeyField: 'ANTHROPIC_KEYS',
    accentColor: '#f97316',
    testModel: 'claude-3-5-haiku-latest',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    description: 'Gemini API，OpenAI 兼容中继格式',
    name: 'google',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    headerFormat: 'openai',
    modelPrefixes: ['gemini-'],
    envKeyField: 'GOOGLE_KEYS',
    accentColor: '#60a5fa',
    testModel: 'gemini-1.5-flash',
  },
  {
    id: 'aliyun',
    label: '阿里云通义',
    description: 'DashScope 百炼 OpenAI 兼容接口',
    name: 'aliyun',
    displayName: '阿里云通义',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    headerFormat: 'openai',
    modelPrefixes: ['qwen-', 'qwq-', 'wanx-', 'text-embedding-v'],
    envKeyField: 'ALIYUN_KEYS',
    accentColor: '#f59e0b',
    badge: 'CN',
    testModel: 'qwen-turbo',
  },
  {
    id: 'baidu',
    label: '百度文心',
    description: '千帆大模型平台 OpenAI 兼容接口',
    name: 'baidu',
    displayName: '百度文心',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    headerFormat: 'openai',
    modelPrefixes: ['ernie-', 'deepseek-', 'yi-'],
    envKeyField: 'BAIDU_KEYS',
    accentColor: '#3b82f6',
    badge: 'CN',
    testModel: 'ernie-4.0-turbo-8k',
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    description: 'Azure 部署端点，需要填写专属 Base URL',
    name: 'azure_openai',
    displayName: 'Azure OpenAI',
    baseUrl: '',
    headerFormat: 'azure',
    modelPrefixes: ['gpt-', 'o1-', 'o3-'],
    envKeyField: 'AZURE_OPENAI_KEYS',
    accentColor: '#38bdf8',
    requiresBaseUrl: true,
  },
  {
    id: 'custom',
    label: '自定义',
    description: '手动配置任意 OpenAI/Anthropic/Azure 兼容服务商',
    name: '',
    displayName: '',
    baseUrl: '',
    headerFormat: 'openai',
    modelPrefixes: [],
    envKeyField: '',
    accentColor: '#8b5cf6',
    isCustom: true,
    requiresBaseUrl: true,
    requiresModelPrefixes: true,
  },
];

export function findProviderTemplate(id: ProviderTemplateId | string): ProviderTemplate {
  return PROVIDER_TEMPLATES.find((template) => template.id === id) ?? PROVIDER_TEMPLATES[0];
}

export function buildProviderFromTemplate(template: ProviderTemplate): ProviderConfig {
  const safeName = template.name || 'custom_provider';
  return {
    name: safeName,
    displayName: template.displayName || template.label,
    baseUrl: template.baseUrl,
    headerFormat: template.headerFormat,
    modelPrefixes: [...template.modelPrefixes],
    envKeyField: template.envKeyField || `${safeName.toUpperCase()}_KEYS`,
    models: [],
    isCustom: true,
  };
}
