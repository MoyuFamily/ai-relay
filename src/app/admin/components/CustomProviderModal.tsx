'use client';

import React, { useState, useEffect } from 'react';
import type { AdminData } from '../types';
import StepperIndicator from './StepperIndicator';
import {
  PROVIDER_TEMPLATES,
  applyProviderTemplate,
  buildDraftProviderFromForm,
  validateApiKeyInput,
  validateDraftProvider,
  type ProviderTemplate,
} from './provider-templates';
import { deriveModelPrefixesFromModels } from '../provider-import';

interface CustomProviderModalProps {
  data: AdminData;
  lang: 'zh' | 'en';
  t: any;
  customProviderModalOpen: boolean;
  setCustomProviderModalOpen: (val: boolean) => void;
  editingCustomProvider: any;
  setEditingCustomProvider: (val: any) => void;
  onSaveCustomProvider: (provider: any) => Promise<void>;
  onTestCustomProvider?: (provider: any, apiKeyValue: string, modelId?: string) => Promise<any>;
  onFetchProviderModels?: (provider: any, apiKeyValue: string) => Promise<{ models: any[]; userAgent?: string | null }>;
  providerKeys?: Array<{ hash: string; masked: string; source: string }> | null;
}

export default function CustomProviderModal({
  data,
  lang,
  t,
  customProviderModalOpen,
  setCustomProviderModalOpen,
  editingCustomProvider,
  setEditingCustomProvider,
  onSaveCustomProvider,
  onTestCustomProvider,
  onFetchProviderModels,
  providerKeys,
}: CustomProviderModalProps) {
  const isImportDraft = !!editingCustomProvider?.isImportDraft;
  // Local states for custom provider form
  const [formId, setFormId] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formHeaderFormat, setFormHeaderFormat] = useState<'openai' | 'anthropic' | 'azure'>('openai');
  const [formModelPrefixes, setFormModelPrefixes] = useState('');
  const [formUserAgent, setFormUserAgent] = useState('');
  const [formModels, setFormModels] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('openai');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [selectedKeyHash, setSelectedKeyHash] = useState('');
  const [useExistingKey, setUseExistingKey] = useState(false);
  const [testModelId, setTestModelId] = useState('');
  const [testState, setTestState] = useState<{ status: 'idle' | 'testing' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [modelFetchState, setModelFetchState] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; message: string }>({
    status: 'idle',
    message: '',
  });
  const [fetchedProviderModels, setFetchedProviderModels] = useState<any[]>([]);

  const applyTemplateToForm = (template: ProviderTemplate) => {
    setSelectedTemplateId(template.id);
    const form = applyProviderTemplate(template);
    setFormId(form.id);
    setFormDisplayName(form.displayName);
    setFormBaseUrl(form.baseUrl);
    setFormHeaderFormat(form.headerFormat);
    setFormModelPrefixes(form.modelPrefixes.join(', '));
    setFormUserAgent('');
    setTestModelId(form.modelPrefixes[0] ? `${form.modelPrefixes[0]}demo` : '');
    setTestState({ status: 'idle', message: '' });
    setModelFetchState({ status: 'idle', message: '' });
    setFetchedProviderModels([]);
  };

  // Sync edit mode fields
  useEffect(() => {
    if (editingCustomProvider) {
      setSelectedTemplateId('custom');
      setApiKeyValue(isImportDraft ? (editingCustomProvider.apiKey || '') : '');
      setSelectedKeyHash('');
      setTestState({ status: 'idle', message: '' });
      setModelFetchState({ status: 'idle', message: '' });
      setFormId(editingCustomProvider.id || editingCustomProvider.name || '');
      setFormDisplayName(editingCustomProvider.displayName || editingCustomProvider.name || '');
      setFormBaseUrl(editingCustomProvider.baseUrl || '');
      setFormHeaderFormat(editingCustomProvider.headerFormat || 'openai');
      setFormModelPrefixes((editingCustomProvider.modelPrefixes || []).join(', '));
      setFormUserAgent(editingCustomProvider.userAgent || '');
      setFormModels(editingCustomProvider.models || []);
      setFetchedProviderModels([]);

      // Check if there are existing keys
      const hasExistingKeys = !isImportDraft && !!(providerKeys && providerKeys.length > 0);
      setUseExistingKey(hasExistingKeys);
      if (hasExistingKeys) {
        setSelectedKeyHash(providerKeys[0].hash);
      }

      // Pre-fill test model from existing models
      const existingModels = editingCustomProvider.models || [];
      if (existingModels.length > 0) {
        setTestModelId(existingModels[0].id);
      }
    } else {
      const defaultTemplate = PROVIDER_TEMPLATES[0];
      setSelectedTemplateId(defaultTemplate.id);
      const form = applyProviderTemplate(defaultTemplate);
      setFormId(form.id);
      setFormDisplayName(form.displayName);
      setFormBaseUrl(form.baseUrl);
      setFormHeaderFormat(form.headerFormat);
      setFormModelPrefixes(form.modelPrefixes.join(', '));
      setFormUserAgent('');
      setFormModels([]);
      setApiKeyValue('');
      setSelectedKeyHash('');
      setUseExistingKey(false);
      setTestModelId(form.modelPrefixes[0] ? `${form.modelPrefixes[0]}demo` : '');
      setTestState({ status: 'idle', message: '' });
      setModelFetchState({ status: 'idle', message: '' });
      setFetchedProviderModels([]);
    }
  }, [editingCustomProvider, customProviderModalOpen, providerKeys, isImportDraft]);

  // Model helper callbacks
  const handleFormAddModel = () => {
    setFormModels([
      ...formModels,
      {
        id: '',
        displayName: '',
        contextWindow: 128000,
        maxOutput: 16384,
        supportsStream: true,
        supportsVision: false,
        supportsTools: false,
        pricing: { input: 0, output: 0 }
      }
    ]);
  };

  const handleFormUpdateModel = (index: number, fields: any) => {
    const updated = [...formModels];
    updated[index] = { ...updated[index], ...fields };
    setFormModels(updated);
  };

  const handleFormRemoveModel = (index: number) => {
    setFormModels(formModels.filter((_, i) => i !== index));
  };

  const handleFormClearModels = () => {
    setFormModels([]);
  };

  // data is still accepted for modal contract parity with parent components.
  void data;

  const draftProvider = buildDraftProviderFromForm({
    id: formId,
    displayName: formDisplayName,
    baseUrl: formBaseUrl,
    headerFormat: formHeaderFormat,
    modelPrefixesText: formModelPrefixes,
    userAgent: formUserAgent,
    models: formModels,
  });
  const providerValidation = validateDraftProvider(draftProvider);
  const apiKeyValidation = validateApiKeyInput(apiKeyValue, data?.config?.apiKeyMinLength ?? 20);
  const currentStep = editingCustomProvider && !isImportDraft ? 1 : apiKeyValue.trim() ? 2 : 0;
  const helperText = {
    chooseTemplate: lang === 'zh' ? '选择模板' : 'Choose template',
    configureKey: lang === 'zh' ? '配置密钥' : 'Configure key',
    testAndSave: lang === 'zh' ? '测试保存' : 'Test & save',
    apiKey: 'API Key',
    connectivityTest: lang === 'zh' ? '连通性测试' : 'Connectivity test',
    customTemplate: lang === 'zh' ? '自定义 / Custom' : 'Custom',
    fetchModels: t.fetchModels || (lang === 'zh' ? '从供应商拉取' : 'Fetch from provider'),
    fetchingModels: t.fetchingModels || (lang === 'zh' ? '拉取中...' : 'Fetching...'),
    fetchedProviderModels: t.fetchedProviderModels || (lang === 'zh' ? '供应商支持的模型' : 'Provider-supported models'),
    addAllFetchedModels: t.addAllFetchedModels || (lang === 'zh' ? '一键添加全部' : 'Add all'),
    removeAllFetchedModels: t.removeAllFetchedModels || (lang === 'zh' ? '取消全部' : 'Remove all'),
    clearAllModels: t.clearAllModels || (lang === 'zh' ? '一键删除全部' : 'Delete all'),
  };

  const normalizeFetchedModel = (model: any) => ({
    id: model.id,
    displayName: model.displayName || model.id,
    contextWindow: model.contextWindow || 128000,
    maxOutput: model.maxOutput || 4096,
    supportsStream: model.supportsStream ?? true,
    supportsVision: model.supportsVision ?? false,
    supportsTools: model.supportsTools ?? false,
    pricing: model.pricing || { input: 0, output: 0 },
  });

  const handleToggleFetchedModel = (model: any) => {
    if (!model?.id) return;
    setFormModels((current) => {
      if (current.some((item) => item.id === model.id)) {
        return current.filter((item) => item.id !== model.id);
      }
      return [...current, normalizeFetchedModel(model)].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    });
  };

  const handleAddAllFetchedModels = () => {
    setFormModels((current) => {
      const existing = new Map(current.map((model) => [model.id, model]));
      for (const model of fetchedProviderModels) {
        if (!model?.id || existing.has(model.id)) continue;
        existing.set(model.id, normalizeFetchedModel(model));
      }
      return Array.from(existing.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    });
  };

  const handleRemoveAllFetchedModels = () => {
    if (fetchedProviderModels.length === 0) return;
    const fetchedIds = new Set(fetchedProviderModels.map((model) => model.id));
    setFormModels((current) => current.filter((model) => !fetchedIds.has(model.id)));
  };

  const handleFetchProviderModels = async () => {
    if (!onFetchProviderModels) return;
    if (providerValidation) {
      setModelFetchState({ status: 'error', message: providerValidation });
      return;
    }

    // Determine which key to use
    const keyToUse = (editingCustomProvider && useExistingKey && selectedKeyHash)
      ? `hash:${selectedKeyHash}`
      : apiKeyValue.trim();

    if (!keyToUse || (keyToUse.indexOf('hash:') !== 0 && apiKeyValidation)) {
      setModelFetchState({ status: 'error', message: apiKeyValidation || 'missing-api-key' });
      return;
    }

    setModelFetchState({ status: 'loading', message: helperText.fetchingModels });
    try {
      const result = await onFetchProviderModels(draftProvider, keyToUse);
      const models = Array.isArray(result?.models) ? result.models : [];
      setFetchedProviderModels(models);
      if (Object.prototype.hasOwnProperty.call(result || {}, 'userAgent')) {
        setFormUserAgent(typeof result.userAgent === 'string' && result.userAgent.trim() ? result.userAgent.trim() : '');
      }

      if (models.length > 0) {
        const derived = deriveModelPrefixesFromModels(models);
        if (derived.length > 0) {
          setFormModelPrefixes(derived.join(', '));
        }
      }

      setModelFetchState({
        status: 'success',
        message: lang === 'zh' ? `已拉取 ${models.length} 个模型` : `Fetched ${models.length} models`,
      });
    } catch (error: any) {
      setModelFetchState({
        status: 'error',
        message: error?.message || (lang === 'zh' ? '拉取模型失败' : 'Failed to fetch models'),
      });
    }
  };

  const handleRunConnectivityTest = async () => {
    if (!onTestCustomProvider) return;
    if (providerValidation) {
      setTestState({ status: 'error', message: providerValidation });
      return;
    }

    // Determine which key to use
    const keyToUse = (editingCustomProvider && useExistingKey && selectedKeyHash)
      ? `hash:${selectedKeyHash}`
      : apiKeyValue.trim();

    if (!keyToUse || (keyToUse.indexOf('hash:') !== 0 && apiKeyValidation)) {
      setTestState({ status: 'error', message: apiKeyValidation || 'missing-api-key' });
      return;
    }

    setTestState({ status: 'testing', message: lang === 'zh' ? '测试中...' : 'Testing...' });
    try {
      await onTestCustomProvider(draftProvider, keyToUse, testModelId.trim() || undefined);
      setTestState({ status: 'success', message: lang === 'zh' ? '连通性测试通过' : 'Connectivity test passed' });
    } catch (error: any) {
      setTestState({ status: 'error', message: error?.message || (lang === 'zh' ? '连通性测试失败' : 'Connectivity test failed') });
    }
  };

  useEffect(() => {
    if (!customProviderModalOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
    };
  }, [customProviderModalOpen]);

  if (!customProviderModalOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000,
      padding: '1rem',
      overflow: 'hidden',
      overscrollBehavior: 'contain',
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '650px',
        maxHeight: '90vh',
        overflowY: 'auto',
        overscrollBehavior: 'contain',
        touchAction: 'pan-y',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}>
        <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#fff', fontWeight: 600 }}>
          {editingCustomProvider && !isImportDraft ? t.editCustomProvider : t.addCustomProvider}
        </h2>

        <StepperIndicator
          steps={[helperText.chooseTemplate, helperText.configureKey, helperText.testAndSave]}
          currentStep={currentStep}
        />

        {!editingCustomProvider && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
            {PROVIDER_TEMPLATES.map((template) => {
              const selected = selectedTemplateId === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplateToForm(template)}
                  style={{
                    textAlign: 'left',
                    padding: '0.75rem',
                    borderRadius: '10px',
                    border: selected ? '1px solid rgba(96, 165, 250, 0.75)' : '1px solid rgba(255,255,255,0.08)',
                    background: selected ? 'rgba(37, 99, 235, 0.18)' : 'rgba(15, 23, 42, 0.62)',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: '0.88rem', marginBottom: '0.3rem' }}>{template.label}</div>
                  <div style={{ color: '#9ca3af', fontSize: '0.74rem', lineHeight: 1.35 }}>{template.description}</div>
                </button>
              );
            })}
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: '0.75rem',
          padding: '0.85rem',
          borderRadius: '10px',
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.3rem' }}>
              {helperText.apiKey}
              {editingCustomProvider && !isImportDraft && editingCustomProvider.keyCount > 0 && (
                <span style={{ marginLeft: '0.5rem', color: '#6ee7b7', fontSize: '0.75rem' }}>
                  ({lang === 'zh' ? `已有 ${editingCustomProvider.keyCount} 个密钥` : `${editingCustomProvider.keyCount} key(s) configured`})
                </span>
              )}
            </label>
            {editingCustomProvider && !isImportDraft && providerKeys && providerKeys.length > 0 ? (
              <>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setUseExistingKey(true)}
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: '6px',
                      border: useExistingKey ? '1px solid rgba(96, 165, 250, 0.5)' : '1px solid rgba(255,255,255,0.08)',
                      backgroundColor: useExistingKey ? 'rgba(37, 99, 235, 0.18)' : 'rgba(0, 0, 0, 0.15)',
                      color: useExistingKey ? '#60a5fa' : '#9ca3af',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: useExistingKey ? 600 : 400,
                    }}
                  >
                    {lang === 'zh' ? '选择已有密钥' : 'Use existing key'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setUseExistingKey(false)}
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: '6px',
                      border: !useExistingKey ? '1px solid rgba(96, 165, 250, 0.5)' : '1px solid rgba(255,255,255,0.08)',
                      backgroundColor: !useExistingKey ? 'rgba(37, 99, 235, 0.18)' : 'rgba(0, 0, 0, 0.15)',
                      color: !useExistingKey ? '#60a5fa' : '#9ca3af',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: !useExistingKey ? 600 : 400,
                    }}
                  >
                    {lang === 'zh' ? '输入新密钥' : 'Enter new key'}
                  </button>
                </div>
                {useExistingKey ? (
                  <select
                    value={selectedKeyHash}
                    onChange={(e) => setSelectedKeyHash(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      color: '#fff',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  >
                    {providerKeys.map((key) => (
                      <option key={key.hash} value={key.hash}>
                        {key.masked} ({key.source})
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="password"
                    placeholder="sk-..."
                    value={apiKeyValue}
                    onChange={(e) => setApiKeyValue(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.75rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      color: '#fff',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </>
            ) : (
              <input
                type="password"
                placeholder={editingCustomProvider && !isImportDraft ? (lang === 'zh' ? '可选：测试新密钥' : 'Optional: test new key') : 'sk-...'}
                value={apiKeyValue}
                onChange={(e) => setApiKeyValue(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  color: '#fff',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            )}
            {editingCustomProvider && !isImportDraft && editingCustomProvider.keyCount > 0 && !providerKeys?.length && (
              <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.35rem' }}>
                {lang === 'zh'
                  ? '编辑时无需重新输入已有密钥，如需测试新密钥请在此输入'
                  : 'No need to re-enter existing keys. Enter here only to test a new key'}
              </div>
            )}
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: '0.3rem' }}>
              Model ID
            </label>
            <input
              type="text"
              placeholder="gpt-6-luna"
              value={testModelId}
              onChange={(e) => setTestModelId(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                color: '#fff',
                fontSize: '0.9rem',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleRunConnectivityTest}
              disabled={!onTestCustomProvider || testState.status === 'testing'}
              style={{
                padding: '0.45rem 0.9rem',
                borderRadius: '6px',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                color: '#6ee7b7',
                cursor: testState.status === 'testing' ? 'wait' : 'pointer',
                fontWeight: 700,
                fontSize: '0.84rem',
              }}
            >
              {helperText.connectivityTest}
            </button>
            {testState.message && (
              <span style={{ color: testState.status === 'error' ? '#fca5a5' : testState.status === 'success' ? '#86efac' : '#bfdbfe', fontSize: '0.82rem' }}>
                {testState.message}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.3rem' }}>
              {t.providerId}
            </label>
            <input
              type="text"
              placeholder="e.g. custom_openai"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              disabled={!!editingCustomProvider && !isImportDraft}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                color: '#fff',
                fontSize: '0.9rem',
                boxSizing: 'border-box',
                opacity: editingCustomProvider && !isImportDraft ? 0.6 : 1,
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.3rem' }}>
              {t.displayName}
            </label>
            <input
              type="text"
              placeholder="e.g. My Custom Provider"
              value={formDisplayName}
              onChange={(e) => setFormDisplayName(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                color: '#fff',
                fontSize: '0.9rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.3rem' }}>
              {t.baseUrl}
            </label>
            <input
              type="text"
              placeholder="https://api.openai.com/v1"
              value={formBaseUrl}
              onChange={(e) => setFormBaseUrl(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                color: '#fff',
                fontSize: '0.9rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.3rem' }}>
                {t.headerFormat}
              </label>
              <select
                value={formHeaderFormat}
                onChange={(e: any) => setFormHeaderFormat(e.target.value)}
                className="custom-select"
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  color: '#fff',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              >
                <option value="openai">OpenAI (Bearer)</option>
                <option value="anthropic">Anthropic (x-api-key)</option>
                <option value="azure">Azure (api-key)</option>
              </select>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', margin: 0 }}>
                  {t.modelPrefixes}
                </label>
                {formModels.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const derived = deriveModelPrefixesFromModels(formModels);
                      setFormModelPrefixes(derived.join(', '));
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#60a5fa',
                      fontSize: '0.74rem',
                      cursor: 'pointer',
                      padding: 0,
                      fontWeight: 500,
                    }}
                  >
                    {t.deriveFromModels || 'Auto-derive'}
                  </button>
                )}
              </div>
              <input
                type="text"
                placeholder="e.g. gpt-, claude-"
                value={formModelPrefixes}
                onChange={(e) => setFormModelPrefixes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  color: '#fff',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.3rem' }}>
              User-Agent {lang === 'zh' ? '(可选)' : '(Optional)'}
            </label>
            <input
              type="text"
              placeholder="e.g. Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
              value={formUserAgent}
              onChange={(e) => setFormUserAgent(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                color: '#fff',
                fontSize: '0.9rem',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: '0.35rem' }}>
              {lang === 'zh'
                ? '自定义发送给上游的 User-Agent。留空则使用默认 SDK User-Agent。'
                : 'Custom User-Agent sent to upstream. Leave empty to use default SDK User-Agent.'}
            </div>
          </div>

          {/* Models List Section */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <label style={{ fontWeight: '600', fontSize: '0.95rem', color: '#fff' }}>
                {t.modelsList}
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={handleFetchProviderModels}
                  disabled={modelFetchState.status === 'loading' || !onFetchProviderModels}
                  style={{
                    padding: '0.3rem 0.6rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    color: '#34d399',
                    cursor: modelFetchState.status === 'loading' ? 'not-allowed' : 'pointer',
                    fontSize: '0.8rem',
                    opacity: modelFetchState.status === 'loading' ? 0.6 : 1,
                  }}
                >
                  {modelFetchState.status === 'loading' ? helperText.fetchingModels : helperText.fetchModels}
                </button>

                <button
                  type="button"
                  onClick={handleFormAddModel}
                  style={{
                    padding: '0.3rem 0.6rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(59, 130, 246, 0.4)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    color: '#60a5fa',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                  }}
                >
                  {t.addModel}
                </button>

                <button
                  type="button"
                  onClick={handleFormClearModels}
                  disabled={formModels.length === 0}
                  style={{
                    padding: '0.3rem 0.6rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: '#fca5a5',
                    cursor: formModels.length === 0 ? 'not-allowed' : 'pointer',
                    fontSize: '0.8rem',
                    opacity: formModels.length === 0 ? 0.55 : 1,
                  }}
                >
                  {helperText.clearAllModels}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              <div style={{
                padding: '0.75rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(16, 185, 129, 0.06)',
                border: '1px solid rgba(16, 185, 129, 0.18)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <span style={{ color: '#d1fae5', fontWeight: 700, fontSize: '0.85rem' }}>
                    {helperText.fetchedProviderModels}
                  </span>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={handleAddAllFetchedModels}
                      disabled={fetchedProviderModels.length === 0}
                      style={{
                        padding: '0.3rem 0.6rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(16, 185, 129, 0.35)',
                        backgroundColor: 'rgba(16, 185, 129, 0.12)',
                        color: '#6ee7b7',
                        cursor: fetchedProviderModels.length === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '0.78rem',
                        opacity: fetchedProviderModels.length === 0 ? 0.55 : 1,
                      }}
                    >
                      {helperText.addAllFetchedModels}
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveAllFetchedModels}
                      disabled={fetchedProviderModels.length === 0}
                      style={{
                        padding: '0.3rem 0.6rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(239, 68, 68, 0.32)',
                        backgroundColor: 'rgba(239, 68, 68, 0.09)',
                        color: '#fca5a5',
                        cursor: fetchedProviderModels.length === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '0.78rem',
                        opacity: fetchedProviderModels.length === 0 ? 0.55 : 1,
                      }}
                    >
                      {helperText.removeAllFetchedModels}
                    </button>
                  </div>
                </div>
                {fetchedProviderModels.length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {fetchedProviderModels.map((model) => {
                      const alreadyAdded = formModels.some((item) => item.id === model.id);
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => handleToggleFetchedModel(model)}
                          title={alreadyAdded
                            ? (lang === 'zh' ? `点击移除 ${model.id}` : `Click to remove ${model.id}`)
                            : (lang === 'zh' ? `点击添加 ${model.id}` : `Click to add ${model.id}`)}
                          style={{
                            padding: '0.25rem 0.5rem',
                            borderRadius: '999px',
                            border: alreadyAdded ? '1px solid rgba(16, 185, 129, 0.55)' : '1px solid rgba(255,255,255,0.08)',
                            backgroundColor: alreadyAdded ? 'rgba(16, 185, 129, 0.14)' : 'rgba(15, 23, 42, 0.55)',
                            color: alreadyAdded ? '#bbf7d0' : '#e5e7eb',
                            cursor: 'pointer',
                            fontSize: '0.74rem',
                          }}
                        >
                          {alreadyAdded ? `✓ ${model.id}` : model.id}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: '#9ca3af', fontSize: '0.78rem' }}>
                    {lang === 'zh' ? '点击“从供应商拉取”查看支持的模型。' : 'Click “Fetch from provider” to view supported models.'}
                  </div>
                )}
              </div>
              {modelFetchState.message && (
                <div style={{
                  fontSize: '0.78rem',
                  color: modelFetchState.status === 'error' ? '#fca5a5' : '#86efac',
                  backgroundColor: modelFetchState.status === 'error' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                  border: `1px solid ${modelFetchState.status === 'error' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'}`,
                  borderRadius: '6px',
                  padding: '0.45rem 0.6rem',
                }}>
                  {modelFetchState.message}
                </div>
              )}
              {formModels.map((model, index) => (
                <div key={index} style={{
                  padding: '0.75rem',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(0,0,0,0.15)',
                  border: '1px solid rgba(255,255,255,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder={t.modelId}
                      value={model.id}
                      onChange={(e) => handleFormUpdateModel(index, { id: e.target.value })}
                      style={{
                        padding: '0.4rem 0.6rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        backgroundColor: 'rgba(0, 0, 0, 0.25)',
                        color: '#fff',
                        fontSize: '0.85rem',
                      }}
                    />
                    <input
                      type="text"
                      placeholder={t.modelDisplayName}
                      value={model.displayName}
                      onChange={(e) => handleFormUpdateModel(index, { displayName: e.target.value })}
                      style={{
                        padding: '0.4rem 0.6rem',
                        borderRadius: '4px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        backgroundColor: 'rgba(0, 0, 0, 0.25)',
                        color: '#fff',
                        fontSize: '0.85rem',
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleFormRemoveModel(index)}
                      style={{
                        padding: '0.4rem 0.6rem',
                        borderRadius: '4px',
                        border: 'none',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      {t.removeModel}
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af', minWidth: '80px' }}>{t.contextWindow}</span>
                      <input
                        type="number"
                        value={model.contextWindow}
                        onChange={(e) => handleFormUpdateModel(index, { contextWindow: parseInt(e.target.value) || 0 })}
                        style={{
                          width: '100%',
                          padding: '0.2rem 0.4rem',
                          borderRadius: '4px',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#fff',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af', minWidth: '80px' }}>{t.maxOutput}</span>
                      <input
                        type="number"
                        value={model.maxOutput}
                        onChange={(e) => handleFormUpdateModel(index, { maxOutput: parseInt(e.target.value) || 0 })}
                        style={{
                          width: '100%',
                          padding: '0.2rem 0.4rem',
                          borderRadius: '4px',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#fff',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af', minWidth: '80px' }}>{t.inputPricing}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={model.pricing?.input ?? 0}
                        onChange={(e) => handleFormUpdateModel(index, { pricing: { ...model.pricing, input: parseFloat(e.target.value) || 0, output: model.pricing?.output || 0 } })}
                        style={{
                          width: '100%',
                          padding: '0.2rem 0.4rem',
                          borderRadius: '4px',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#fff',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#9ca3af', minWidth: '80px' }}>{t.outputPricing}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={model.pricing?.output ?? 0}
                        onChange={(e) => handleFormUpdateModel(index, { pricing: { ...model.pricing, output: parseFloat(e.target.value) || 0, input: model.pricing?.input || 0 } })}
                        style={{
                          width: '100%',
                          padding: '0.2rem 0.4rem',
                          borderRadius: '4px',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          backgroundColor: 'rgba(0, 0, 0, 0.25)',
                          color: '#fff',
                          fontSize: '0.85rem',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '1.25rem', paddingLeft: '0.25rem', marginTop: '0.2rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#d1d5db', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={model.supportsStream}
                        onChange={(e) => handleFormUpdateModel(index, { supportsStream: e.target.checked })}
                        style={{ cursor: 'pointer' }}
                      />
                      {t.supportsStream}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#d1d5db', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={model.supportsVision}
                        onChange={(e) => handleFormUpdateModel(index, { supportsVision: e.target.checked })}
                        style={{ cursor: 'pointer' }}
                      />
                      {t.supportsVision}
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#d1d5db', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={model.supportsTools}
                        onChange={(e) => handleFormUpdateModel(index, { supportsTools: e.target.checked })}
                        style={{ cursor: 'pointer' }}
                      />
                      {t.supportsTools}
                    </label>
                  </div>
                </div>
              ))}
              {formModels.length === 0 && (
                <div style={{ textAlign: 'center', color: '#9ca3af', fontSize: '0.85rem', padding: '1rem', border: '1px dashed rgba(255,255,255,0.06)', borderRadius: '6px' }}>
                  {lang === 'zh' ? '暂无模型，请点击右上方按钮添加。' : 'No models. Click top right button to add.'}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem' }}>
          <button
            type="button"
            onClick={() => {
              setCustomProviderModalOpen(false);
              setEditingCustomProvider(null);
            }}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              color: '#d1d5db',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!formId.trim() || !formDisplayName.trim() || !formBaseUrl.trim() || !formModelPrefixes.trim()) {
                alert(lang === 'zh' ? '请填写所有必填字段' : 'Please fill all required fields');
                return;
              }
              if (!formBaseUrl.startsWith('https://')) {
                alert(t.invalidBaseUrl);
                return;
              }
              const prefixes = formModelPrefixes.split(',').map(p => p.trim()).filter(Boolean);
              if (prefixes.length === 0) {
                alert(lang === 'zh' ? '请至少输入一个模型前缀' : 'Please input at least one model prefix');
                return;
              }
              
              const providerToSave: any = {
                name: formId.trim(),
                displayName: formDisplayName.trim(),
                baseUrl: formBaseUrl.trim(),
                headerFormat: formHeaderFormat,
                modelPrefixes: prefixes,
                userAgent: formUserAgent.trim() || undefined,
                models: formModels
              };
              if (!useExistingKey && apiKeyValue.trim()) {
                providerToSave.apiKey = apiKeyValue.trim();
              }

              await onSaveCustomProvider(providerToSave);
            }}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: '#2563eb',
              color: 'white',
              fontWeight: 'bold',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            {t.saveProvider}
          </button>
        </div>
      </div>
    </div>
  );
}
