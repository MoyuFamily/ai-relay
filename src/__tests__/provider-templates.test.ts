import { describe, expect, it } from 'vitest';
import {
  PROVIDER_TEMPLATES,
  applyProviderTemplate,
  buildEnvKeyField,
  findProviderTemplate,
  validateDraftProvider,
  parseModelPrefixes,
  buildDraftProvider,
} from '@/app/admin/components/provider-templates';

describe('provider templates', () => {
  it('contains the required built-in provider templates for iteration one', () => {
    expect(PROVIDER_TEMPLATES.map((template) => template.id)).toEqual([
      'openai',
      'anthropic',
      'google',
      'aliyun',
      'baidu',
      'azure',
      'mistral',
      'groq',
      'deepseek',
      'custom',
    ]);
  });

  it('prefills OpenAI template fields and env key naming', () => {
    const template = findProviderTemplate('openai');
    expect(template).toBeDefined();

    const form = applyProviderTemplate(template!);

    expect(form).toMatchObject({
      id: 'openai',
      displayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      headerFormat: 'openai',
      envKeyField: 'OPENAI_KEYS',
    });
    expect(form.modelPrefixes).toContain('gpt-');
    expect(form.modelPrefixes).toContain('text-embedding-');
  });

  it('prefills domestic provider templates', () => {
    expect(applyProviderTemplate(findProviderTemplate('aliyun')!)).toMatchObject({
      id: 'aliyun',
      displayName: '阿里云通义',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      headerFormat: 'openai',
      envKeyField: 'ALIYUN_KEYS',
      modelPrefixes: ['qwen-'],
    });
    expect(applyProviderTemplate(findProviderTemplate('baidu')!)).toMatchObject({
      id: 'baidu',
      displayName: '百度文心',
      baseUrl: 'https://qianfan.baidubce.com/v2',
      headerFormat: 'openai',
      envKeyField: 'BAIDU_KEYS',
      modelPrefixes: ['ernie-'],
    });
  });

  it('keeps Azure fields editable by leaving URL and prefixes blank', () => {
    const template = findProviderTemplate('azure');
    expect(template).toBeDefined();

    const form = applyProviderTemplate(template!);

    expect(form).toMatchObject({
      id: 'azure_openai',
      displayName: 'Azure OpenAI',
      baseUrl: '',
      headerFormat: 'azure',
      envKeyField: 'AZURE_OPENAI_KEYS',
    });
    expect(form.modelPrefixes).toEqual([]);
  });

  it('marks custom template as requiring the full manual form', () => {
    const template = findProviderTemplate('custom');

    expect(template?.isCustom).toBe(true);
    expect(template?.baseUrl).toBe('');
    expect(template?.modelPrefixes).toEqual([]);
  });

  it('builds env key field from custom provider id', () => {
    expect(buildEnvKeyField('my_provider')).toBe('MY_PROVIDER_KEYS');
    expect(buildEnvKeyField('')).toBe('');
  });

  it('validates draft provider payload before test/save', () => {
    const validDraft = {
      name: 'openai',
      displayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      headerFormat: 'openai' as const,
      modelPrefixes: ['gpt-'],
      envKeyField: 'OPENAI_KEYS',
      models: [],
    };

    expect(validateDraftProvider(validDraft)).toBeNull();
    expect(validateDraftProvider({ ...validDraft, name: 'bad-id' })).toBe('invalid-provider-id');
    expect(validateDraftProvider({ ...validDraft, baseUrl: 'http://api.openai.com/v1' })).toBe('invalid-base-url');
    expect(validateDraftProvider({ ...validDraft, modelPrefixes: [] })).toBe('missing-model-prefixes');
  });

  it('parses model prefixes from comma or newline separated input', () => {
    expect(parseModelPrefixes('gpt-, o1-\n text-embedding-')).toEqual(['gpt-', 'o1-', 'text-embedding-']);
    expect(parseModelPrefixes('  ,\n  ')).toEqual([]);
  });

  it('builds a draft provider payload including env key field and models', () => {
    const draft = buildDraftProvider({
      id: 'custom_openai',
      displayName: 'Custom OpenAI',
      baseUrl: 'https://proxy.example.com/v1',
      headerFormat: 'openai',
      modelPrefixesText: 'gpt-, o3-',
      models: [{ id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000 }],
    });

    expect(draft).toMatchObject({
      name: 'custom_openai',
      displayName: 'Custom OpenAI',
      baseUrl: 'https://proxy.example.com/v1',
      headerFormat: 'openai',
      envKeyField: 'CUSTOM_OPENAI_KEYS',
      modelPrefixes: ['gpt-', 'o3-'],
      models: [{ id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000 }],
    });
  });
});
