'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface ModelKeyTestProps {
  apiKey: string;
  lang: 'zh' | 'en';
  t: any;
  providers: any[];
  onRefreshData?: () => Promise<void>;
}

export default function ModelKeyTest({
  apiKey,
  lang,
  t,
  providers,
  onRefreshData,
}: ModelKeyTestProps) {
  // Model & Key Connectivity Test States
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [customModelId, setCustomModelId] = useState<string>('');
  const [useCustomKey, setUseCustomKey] = useState<boolean>(false);
  const [customKey, setCustomKey] = useState<string>('');
  const [testLoading, setTestLoading] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; status?: number; error?: string } | null>(null);

  // New multi-key selection and management states
  const [providerKeys, setProviderKeys] = useState<Array<{ hash: string; masked: string; source: string }>>([]);
  const [selectedKeyHash, setSelectedKeyHash] = useState<string>('');
  const [keysLoading, setKeysLoading] = useState<boolean>(false);
  const [savingKey, setSavingKey] = useState<boolean>(false);
  const [deletingKey, setDeletingKey] = useState<boolean>(false);

  const currentProvider = useMemo(() => {
    return providers.find((p) => p.id === selectedProviderId);
  }, [providers, selectedProviderId]);

  const currentProviderModels = useMemo(() => {
    return currentProvider?.models || [];
  }, [currentProvider]);

  const activeModelId = selectedModelId === '__custom__' ? customModelId.trim() : selectedModelId;

  // Set default provider and model once providers are loaded
  useEffect(() => {
    if (providers.length > 0) {
      if (!selectedProviderId || !providers.some((p) => p.id === selectedProviderId)) {
        const defaultProvider = providers[0];
        setSelectedProviderId(defaultProvider.id);
        
        const models = defaultProvider.models || [];
        if (models.length > 0) {
          setSelectedModelId(models[0].id);
        } else {
          setSelectedModelId('__custom__');
        }
      }
    }
  }, [providers, selectedProviderId]);

  // Adjust selectedModelId when selectedProviderId changes
  useEffect(() => {
    if (selectedProviderId) {
      const provider = providers.find((p) => p.id === selectedProviderId);
      const models = provider?.models || [];
      if (models.length > 0) {
        const hasModel = models.some((m: any) => m.id === selectedModelId);
        if (!hasModel && selectedModelId !== '__custom__') {
          setSelectedModelId(models[0].id);
        }
      } else {
        setSelectedModelId('__custom__');
      }
    }
  }, [selectedProviderId, providers, selectedModelId]);

  const fetchKeys = useCallback(async (providerId: string) => {
    setKeysLoading(true);
    try {
      const res = await fetch(`/api/admin/providers/${providerId}/keys`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const keys = data.keys || [];
        setProviderKeys(keys);
        setSelectedKeyHash(prev => {
          const exists = keys.some((k: any) => k.hash === prev);
          return exists ? prev : (keys[0]?.hash || '');
        });
      } else {
        setProviderKeys([]);
        setSelectedKeyHash('');
      }
    } catch {
      setProviderKeys([]);
      setSelectedKeyHash('');
    } finally {
      setKeysLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (selectedProviderId) {
      fetchKeys(selectedProviderId);
    } else {
      setProviderKeys([]);
      setSelectedKeyHash('');
    }
  }, [selectedProviderId, fetchKeys]);

  const handleRunTest = async () => {
    if (!selectedProviderId || !activeModelId) return;

    setTestLoading(true);
    setTestResult(null);

    try {
      const payload: any = { model: activeModelId };
      if (useCustomKey) {
        if (customKey.trim()) {
          payload.key = customKey.trim();
        }
      } else if (selectedKeyHash) {
        payload.hash = selectedKeyHash;
      }

      const res = await fetch(`/api/admin/providers/${selectedProviderId}/keys/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setTestResult({
          success: false,
          status: res.status,
          error: data.error?.message || 'Verification request failed',
        });
      } else if (data.valid) {
        setTestResult({ success: true });
      } else {
        setTestResult({
          success: false,
          status: data.status || 400,
          error: data.error || 'Invalid API Key',
        });
      }
    } catch (e: any) {
      setTestResult({
        success: false,
        status: 500,
        error: e instanceof Error ? e.message : 'Unknown network/server error',
      });
    } finally {
      setTestLoading(false);
    }
  };

  const handleSaveKeyToProvider = async () => {
    if (!selectedProviderId || !customKey.trim()) return;
    setSavingKey(true);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProviderId}/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ key: customKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || t.alertAddFromTestFailed);
      }
      alert(t.msgKeyAddedFromTest);
      setCustomKey('');
      setUseCustomKey(false);
      setTestResult(null);
      
      // Refresh global state & reload current provider keys
      if (onRefreshData) await onRefreshData();
      await fetchKeys(selectedProviderId);
    } catch (e: any) {
      alert(e.message || t.alertAddFromTestFailed);
    } finally {
      setSavingKey(false);
    }
  };

  // Helper to hash key with djb2 algorithm
  const djb2Hash = (key: string): string => {
    let hash = 5381;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };

  // Determine if the tested key is an existing key, and if so, get its hash
  const existingKeyHashForDelete = useMemo(() => {
    if (!useCustomKey) {
      return selectedKeyHash || null;
    }
    // If using custom key, check if it matches any existing key by hash
    const inputHash = djb2Hash(customKey.trim());
    const exists = providerKeys.some((k) => k.hash === inputHash);
    return exists ? inputHash : null;
  }, [useCustomKey, selectedKeyHash, customKey, providerKeys]);

  const handleDeleteKeyFromTest = async () => {
    const hashToDelete = existingKeyHashForDelete;
    if (!selectedProviderId || !hashToDelete) return;
    if (!confirm(t.confirmDeleteFailedKey)) return;
    
    setDeletingKey(true);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProviderId}/keys`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ hash: hashToDelete }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || t.alertDeleteFromTestFailed);
      }
      alert(t.msgKeyDeletedFromTest);
      setTestResult(null);
      if (useCustomKey) {
        setCustomKey('');
      }
      
      // Refresh global state & reload current provider keys
      if (onRefreshData) await onRefreshData();
      await fetchKeys(selectedProviderId);
    } catch (e: any) {
      alert(e.message || t.alertDeleteFromTestFailed);
    } finally {
      setDeletingKey(false);
    }
  };

  const isNoKeysWarning = !useCustomKey && currentProvider && (currentProvider.keyCount ?? 0) === 0;

  return (
    <section className="glass-panel">
      <h2 style={{ fontSize: '1.25rem', marginTop: 0, marginBottom: '0.5rem', color: '#fff', fontWeight: 600 }}>
        {t.testToolTitle}
      </h2>
      <p style={{ fontSize: '0.85rem', color: '#9ca3af', marginTop: 0, marginBottom: '1.5rem', lineHeight: '1.5' }}>
        {t.testToolDesc}
      </p>

      {providers.length === 0 ? (
        <div style={{
          padding: '1rem',
          borderRadius: '8px',
          backgroundColor: 'rgba(239, 68, 68, 0.05)',
          border: '1px solid rgba(239, 68, 68, 0.15)',
          color: '#fca5a5',
          fontSize: '0.9rem',
        }}>
          {t.noConfiguredModels}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Provider and Model Selection Row */}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', maxWidth: '800px' }}>
            {/* Provider Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: '1 1 250px' }}>
              <label style={{ color: '#d1d5db', fontSize: '0.9rem', fontWeight: 500 }}>
                {lang === 'zh' ? '选择服务商' : 'Select Provider'}
              </label>
              <select
                value={selectedProviderId}
                onChange={(e) => {
                  setSelectedProviderId(e.target.value);
                  setTestResult(null);
                }}
                disabled={testLoading}
                className="custom-select"
                style={{
                  width: '100%',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  color: '#fff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {providers.map((p) => {
                  const hasKey = (p.keyCount || 0) > 0;
                  const prefix = hasKey ? '🟢 ' : '⚠️ ';
                  const suffix = hasKey ? '' : (lang === 'zh' ? ' (未配置密钥)' : ' (No Keys)');
                  return (
                    <option key={p.id} value={p.id}>
                      {prefix}{p.name} ({p.id}){suffix}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Model Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: '2 1 400px' }}>
              <label style={{ color: '#d1d5db', fontSize: '0.9rem', fontWeight: 500 }}>
                {t.testModelLabel}
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <select
                  value={selectedModelId}
                  onChange={(e) => {
                    setSelectedModelId(e.target.value);
                    setTestResult(null);
                  }}
                  disabled={testLoading}
                  className="custom-select"
                  style={{
                    flex: '1 1 200px',
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    color: '#fff',
                    fontSize: '0.9rem',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {currentProviderModels.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName || m.id}
                    </option>
                  ))}
                  <option value="__custom__">
                    {lang === 'zh' ? '✏️ 自定义模型 ID...' : '✏️ Custom Model ID...'}
                  </option>
                </select>

                {selectedModelId === '__custom__' && (
                  <input
                    type="text"
                    placeholder={lang === 'zh' ? '输入模型 ID，如 gpt-6-luna' : 'Enter model ID, e.g. gpt-6-luna'}
                    value={customModelId}
                    onChange={(e) => {
                      setCustomModelId(e.target.value);
                      setTestResult(null);
                    }}
                    disabled={testLoading}
                    style={{
                      flex: '1 1 200px',
                      padding: '0.5rem 1rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      color: '#fff',
                      fontSize: '0.9rem',
                      outline: 'none',
                      transition: 'all 0.2s',
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Custom Key Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
            <input
              type="checkbox"
              id="useCustomKey"
              checked={useCustomKey}
              onChange={(e) => {
                setUseCustomKey(e.target.checked);
                setTestResult(null);
              }}
              disabled={testLoading}
              style={{ cursor: 'pointer', width: '1.1rem', height: '1.1rem' }}
            />
            <label htmlFor="useCustomKey" style={{ color: '#d1d5db', fontSize: '0.9rem', cursor: 'pointer', userSelect: 'none' }}>
              {t.useCustomKeyLabel}
            </label>
          </div>

          {/* Key Selection and Action Row */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ color: '#d1d5db', fontSize: '0.9rem', fontWeight: 500 }}>
              {useCustomKey ? t.customKeyPlaceholder : t.testKeySelectLabel}
            </label>
            
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', width: '100%', maxWidth: '800px' }}>
              {/* Input or Select Container */}
              <div style={{ flex: '0 1 300px', minWidth: '200px', width: '100%' }}>
                {useCustomKey ? (
                  <input
                    type="password"
                    placeholder={t.customKeyPlaceholder}
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    disabled={testLoading}
                    style={{
                      width: '100%',
                      padding: '0.5rem 1rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      color: '#fff',
                      fontSize: '0.9rem',
                      fontFamily: 'monospace',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                ) : (
                  currentProvider && currentProvider.keyCount > 0 ? (
                    <select
                      value={selectedKeyHash}
                      onChange={(e) => {
                        setSelectedKeyHash(e.target.value);
                        setTestResult(null);
                      }}
                      disabled={testLoading || keysLoading}
                      className="custom-select"
                      style={{
                        width: '100%',
                        padding: '0.5rem 1rem',
                        borderRadius: '6px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        backgroundColor: 'rgba(0, 0, 0, 0.25)',
                        color: '#fff',
                        fontSize: '0.9rem',
                        outline: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {providerKeys.map((k) => (
                        <option key={k.hash} value={k.hash}>
                          {k.masked} ({k.source === 'env' ? (lang === 'zh' ? '环境变量' : 'env') : (lang === 'zh' ? 'KV 存储' : 'kv')})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      color: '#9ca3af',
                      fontSize: '0.9rem',
                    }}>
                      {t.statusNoKeys}
                    </div>
                  )
                )}
              </div>

              {/* Run Test Button */}
              <button
                onClick={handleRunTest}
                disabled={testLoading || !selectedProviderId || !activeModelId || isNoKeysWarning || (useCustomKey && !customKey.trim())}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '0.9rem',
                  cursor: (testLoading || isNoKeysWarning) ? 'not-allowed' : 'pointer',
                  opacity: (testLoading || !selectedProviderId || !activeModelId || isNoKeysWarning || (useCustomKey && !customKey.trim())) ? 0.5 : 1,
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#2563eb'; }}
                onMouseLeave={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#3b82f6'; }}
              >
                {testLoading ? t.btnTesting : t.btnRunTest}
              </button>

              {/* Success Action: Save key to provider */}
              {testResult && testResult.success && useCustomKey && (
                <button
                  onClick={handleSaveKeyToProvider}
                  disabled={savingKey}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    color: '#34d399',
                    fontSize: '0.85rem',
                    cursor: savingKey ? 'wait' : 'pointer',
                    fontWeight: 'bold',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => { if (!savingKey) e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.2)'; }}
                  onMouseLeave={(e) => { if (!savingKey) e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'; }}
                >
                  {savingKey ? '...' : (t.btnAddTestedKeyShort || t.btnAddTestedKey)}
                </button>
              )}

              {/* Failure Action: Delete key */}
              {testResult && !testResult.success && existingKeyHashForDelete && (
                <button
                  onClick={handleDeleteKeyFromTest}
                  disabled={deletingKey}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: '#f87171',
                    fontSize: '0.85rem',
                    cursor: deletingKey ? 'wait' : 'pointer',
                    fontWeight: 'bold',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={(e) => { if (!deletingKey) e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.2)'; }}
                  onMouseLeave={(e) => { if (!deletingKey) e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; }}
                >
                  {deletingKey ? '...' : (t.btnDeleteFailedKeyShort || t.btnDeleteFailedKey)}
                </button>
              )}
            </div>
          </div>

          {/* Provider Key Count Warning Prompt (Fallback warning) */}
          {isNoKeysWarning && (
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.06)',
              border: '1px solid rgba(239, 68, 68, 0.15)',
              color: '#fca5a5',
              fontSize: '0.85rem',
              lineHeight: '1.4',
              maxWidth: '500px',
            }}>
              {t.testToolNoKeysWarning}
            </div>
          )}

          {/* Test Result Display */}
          {testResult && (
            <div style={{
              marginTop: '0.5rem',
              padding: '1.25rem',
              borderRadius: '8px',
              backgroundColor: testResult.success ? 'rgba(16, 185, 129, 0.06)' : 'rgba(239, 68, 68, 0.06)',
              border: testResult.success ? '1px solid rgba(16, 185, 129, 0.15)' : '1px solid rgba(239, 68, 68, 0.15)',
              color: testResult.success ? '#34d399' : '#fca5a5',
              fontSize: '0.9rem',
              lineHeight: '1.5',
              maxWidth: '500px',
            }}>
              {testResult.success ? (
                <div>
                  <div style={{ fontWeight: 500 }}>{t.testResultSuccess}</div>
                </div>
              ) : (
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '0.25rem' }}>{t.testResultFailed}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#f87171', wordBreak: 'break-all' }}>
                    {t.testResultFailedDetails
                      .replace('{status}', String(testResult.status || 'unknown'))
                      .replace('{error}', testResult.error || '')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
