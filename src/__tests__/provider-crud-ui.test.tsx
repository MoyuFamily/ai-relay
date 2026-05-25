import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import StepperIndicator from '@/app/admin/components/StepperIndicator';
import CustomProviderModal from '@/app/admin/components/CustomProviderModal';
import { getProviderStatusView } from '@/app/admin/components/ProviderTable';
import { buildDraftProviderFromForm, validateApiKeyInput } from '@/app/admin/components/provider-templates';

describe('iteration one provider CRUD UI helpers', () => {
  it('renders a three-step provider creation stepper with active and completed states', () => {
    const html = renderToStaticMarkup(
      <StepperIndicator
        steps={['选择模板', '配置密钥', '测试保存']}
        currentStep={1}
      />
    );

    expect(html).toContain('选择模板');
    expect(html).toContain('配置密钥');
    expect(html).toContain('测试保存');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('✓');
  });

  it('derives provider table status indicator from configured and available key counts', () => {
    expect(getProviderStatusView({ configured: true, availableKeys: 2 })).toMatchObject({
      tone: 'healthy',
      dot: '●',
      labelKey: 'statusOk',
    });
    expect(getProviderStatusView({ configured: true, availableKeys: 0 })).toMatchObject({
      tone: 'degraded',
      dot: '⚠',
      labelKey: 'statusNoKeys',
    });
    expect(getProviderStatusView({ configured: false, availableKeys: 0 })).toMatchObject({
      tone: 'down',
      dot: '✕',
      labelKey: 'statusNoKeys',
    });
  });

  it('builds a draft provider payload from stepper form state before test/save', () => {
    const draft = buildDraftProviderFromForm({
      id: 'openai',
      displayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      headerFormat: 'openai',
      modelPrefixesText: 'gpt-, o1- , text-embedding-',
      models: [],
    });

    expect(draft).toMatchObject({
      name: 'openai',
      displayName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      headerFormat: 'openai',
      modelPrefixes: ['gpt-', 'o1-', 'text-embedding-'],
      envKeyField: 'OPENAI_KEYS',
    });
  });

  it('validates API key input before running connectivity test', () => {
    expect(validateApiKeyInput('sk-1234567890abcdef1234')).toBeNull();
    expect(validateApiKeyInput('')).toBe('missing-api-key');
    expect(validateApiKeyInput('short')).toBe('api-key-too-short');
    expect(validateApiKeyInput('sk-has whitespace 1234567890')).toBe('api-key-has-space');
  });

  it('renders template-first custom provider modal with three-step flow and connectivity actions', () => {
    const html = renderToStaticMarkup(
      <CustomProviderModal
        data={{
          status: 'ok',
          timestamp: 'now',
          providers: [],
          usage: { requests: 0, tokens: 0, promptTokens: 0, completionTokens: 0, providers: {} },
          quota: { daily: { used: 0, limit: 0 }, monthly: { used: 0, limit: 0 }, allowed: true, isOverride: false },
          config: { dailyLimit: null, monthlyLimit: null },
        }}
        lang="zh"
        t={{
          addCustomProvider: '添加供应商',
          editCustomProvider: '编辑供应商',
          providerId: '供应商 ID',
          displayName: '显示名称',
          baseUrl: 'Base URL',
          headerFormat: '认证格式',
          modelPrefixes: '模型前缀',
          modelsList: '模型列表',
          reuseExistingModel: '复用现有模型',
          addModel: '添加模型',
          modelId: '模型 ID',
          modelDisplayName: '模型显示名',
          contextWindow: '上下文',
          maxOutput: '最大输出',
          inputPricing: '输入价格',
          outputPricing: '输出价格',
          supportsStream: '流式',
          supportsVision: '视觉',
          supportsTools: '工具',
          removeModel: '删除模型',
          cancel: '取消',
          saveProvider: '保存供应商',
          invalidBaseUrl: 'Base URL 必须 HTTPS',
        }}
        customProviderModalOpen
        setCustomProviderModalOpen={() => undefined}
        editingCustomProvider={null}
        setEditingCustomProvider={() => undefined}
        onSaveCustomProvider={async () => undefined}
        onTestCustomProvider={async () => ({ success: true })}
      />
    );

    expect(html).toContain('选择模板');
    expect(html).toContain('配置密钥');
    expect(html).toContain('测试保存');
    expect(html).toContain('OpenAI');
    expect(html).toContain('Anthropic');
    expect(html).toContain('阿里云通义');
    expect(html).toContain('百度文心');
    expect(html).toContain('API Key');
    expect(html).toContain('连通性测试');
  });
});
