'use client';

import React, { useState, useEffect } from 'react';
import type { AdminData } from '../types';

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
  onTestCustomProvider: _onTestCustomProvider,
}: CustomProviderModalProps) {
  // Local states for custom provider form
  const [formId, setFormId] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formHeaderFormat, setFormHeaderFormat] = useState<'openai' | 'anthropic' | 'azure'>('openai');
  const [formModelPrefixes, setFormModelPrefixes] = useState('');
  const [formModels, setFormModels] = useState<any[]>([]);

  // Sync edit mode fields
  useEffect(() => {
    if (editingCustomProvider) {
      setFormId(editingCustomProvider.id);
      setFormDisplayName(editingCustomProvider.name || '');
      setFormBaseUrl(editingCustomProvider.baseUrl || '');
      setFormHeaderFormat(editingCustomProvider.headerFormat || 'openai');
      setFormModelPrefixes((editingCustomProvider.modelPrefixes || []).join(', '));
      setFormModels(editingCustomProvider.models || []);
    } else {
      setFormId('');
      setFormDisplayName('');
      setFormBaseUrl('');
      setFormHeaderFormat('openai');
      setFormModelPrefixes('');
      setFormModels([]);
    }
  }, [editingCustomProvider, customProviderModalOpen]);

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

  // Compute all existing models across providers for cloning
  const allExistingModels = data.providers.flatMap((p) => {
    const models = p.models || [];
    return models.map((m) => {
      return {
        id: m.id,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        supportsStream: m.supportsStream,
        supportsVision: m.supportsVision,
        supportsTools: m.supportsTools,
        pricing: m.pricing,
        providerName: p.name
      };
    });
  });

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
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '650px',
        maxHeight: '90vh',
        overflowY: 'auto',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
      }}>
        <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#fff', fontWeight: 600 }}>
          {editingCustomProvider ? t.editCustomProvider : t.addCustomProvider}
        </h2>

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
              disabled={!!editingCustomProvider}
              style={{
                width: '100%',
                padding: '0.6rem 0.8rem',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backgroundColor: 'rgba(0, 0, 0, 0.25)',
                color: '#fff',
                fontSize: '0.9rem',
                boxSizing: 'border-box',
                opacity: editingCustomProvider ? 0.6 : 1,
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
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.3rem' }}>
                {t.modelPrefixes}
              </label>
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

          {/* Models List Section */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <label style={{ fontWeight: '600', fontSize: '0.95rem', color: '#fff' }}>
                {t.modelsList}
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {/* Reuse/Clone dropdown */}
                <select
                  onChange={(e) => {
                    if (!e.target.value) return;
                    const parsed = JSON.parse(e.target.value);
                    setFormModels([
                      ...formModels,
                      {
                        id: parsed.id,
                        displayName: parsed.displayName,
                        contextWindow: parsed.contextWindow,
                        maxOutput: parsed.maxOutput || 4096,
                        supportsStream: parsed.supportsStream ?? true,
                        supportsVision: parsed.supportsVision ?? false,
                        supportsTools: parsed.supportsTools ?? false,
                        pricing: parsed.pricing || { input: 0, output: 0 }
                      }
                    ]);
                    e.target.value = ''; // Reset select
                  }}
                  className="custom-select"
                  style={{
                    padding: '0.3rem 1.8rem 0.3rem 0.5rem',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    color: '#9ca3af',
                    fontSize: '0.8rem',
                    maxWidth: '200px',
                  }}
                >
                  <option value="">{t.reuseExistingModel}</option>
                  {allExistingModels.map((m, idx) => (
                    <option key={idx} value={JSON.stringify(m)}>
                      [{m.providerName}] {m.id}
                    </option>
                  ))}
                </select>

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
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.25rem' }}>
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
              
              await onSaveCustomProvider({
                name: formId.trim(),
                displayName: formDisplayName.trim(),
                baseUrl: formBaseUrl.trim(),
                headerFormat: formHeaderFormat,
                modelPrefixes: prefixes,
                models: formModels
              });
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
