import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import StepperIndicator from '@/app/admin/components/StepperIndicator';
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
    expect(validateApiKeyInput('sk-12345678901234567890')).toBeNull();
    expect(validateApiKeyInput('')).toBe('missing-api-key');
    expect(validateApiKeyInput('short')).toBe('api-key-too-short');
    expect(validateApiKeyInput('sk-has whitespace 1234567890')).toBe('api-key-has-space');
  });
});
