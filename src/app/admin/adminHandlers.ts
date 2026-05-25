// ============================================================
// AI Relay Admin — useAdminHandlers Custom Hook
// Encapsulates all API handler functions used by the admin page.
// ============================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AdminData } from './types';

interface ProviderFallbacks {
  current: string[];
  staticDefault: string | null;
  staticDefaults: string[];
  isOverride: boolean;
  availableModels: Record<string, { id: string; displayName: string }[]>;
}

export function useAdminHandlers(apiKey: string, t: any) {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);

  // Configuration management states
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [providerKeys, setProviderKeys] = useState<Array<{ hash: string; masked: string; source: string }> | null>(null);
  const [providerFallbacks, setProviderFallbacks] = useState<ProviderFallbacks | null>(null);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [operationLoading, setOperationLoading] = useState(false);
  const [configMessage, setConfigMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [testingHash, setTestingHash] = useState<string | null>(null);
  const [testingInput, setTestingInput] = useState<boolean>(false);
  const [activeFallbacks, setActiveFallbacks] = useState<string[]>([]);
  const [selectedFallbackToAdd, setSelectedFallbackToAdd] = useState('');

  // Custom provider modal states
  const [customProviderModalOpen, setCustomProviderModalOpen] = useState(false);
  const [editingCustomProvider, setEditingCustomProvider] = useState<any>(null);

  // Automatically select a default value for the fallback-to-add dropdown when options change
  useEffect(() => {
    const usedProviders = activeFallbacks.map(fb => {
      const colonIdx = fb.indexOf(':');
      return colonIdx >= 0 ? fb.slice(0, colonIdx) : fb;
    });
    if (selectedProvider && data) {
      const available = data.providers.filter(p => p.id !== selectedProvider && !usedProviders.includes(p.id));
      if (available.length > 0 && !available.some(p => p.id === selectedFallbackToAdd)) {
        setSelectedFallbackToAdd(available[0].id);
      }
    } else {
      setSelectedFallbackToAdd('');
    }
  }, [selectedProvider, activeFallbacks, data, selectedFallbackToAdd]);

  const fetchData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin${forceRefresh ? '?refresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      });
      if (res.status === 401) {
        setError('unauthorized');
        setAuthenticated(false);
        return;
      }
      const json = await res.json();
      setData(json);
      setAuthenticated(true);
      localStorage.setItem('airelay_admin_key', apiKey);
    } catch (e) {
      setError('failed_fetch');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  const fetchProviderConfig = useCallback(async (providerId: string) => {
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const [keysRes, fallbacksRes] = await Promise.all([
        fetch(`/api/admin/providers/${providerId}/keys`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: 'no-store',
        }),
        fetch(`/api/admin/providers/${providerId}/fallbacks`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          cache: 'no-store',
        }),
      ]);

      if (!keysRes.ok || !fallbacksRes.ok) {
        throw new Error('Failed to fetch provider configuration');
      }

      const keysData = await keysRes.json();
      const fallbacksData = await fallbacksRes.json();

      setProviderKeys(keysData.keys);
      setProviderFallbacks({
        current: fallbacksData.fallbacks,
        staticDefault: fallbacksData.staticDefault,
        staticDefaults: fallbacksData.staticDefaults || [],
        isOverride: fallbacksData.isOverride,
        availableModels: fallbacksData.availableModels || {},
      });
      setActiveFallbacks(fallbacksData.fallbacks || []);
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : t.msgLoadConfigFailed, type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  }, [apiKey, t]);

  useEffect(() => {
    if (selectedProvider && authenticated) {
      fetchProviderConfig(selectedProvider);
    } else {
      setProviderKeys(null);
      setProviderFallbacks(null);
    }
  }, [selectedProvider, authenticated, fetchProviderConfig]);

  const handleAddKey = useCallback(async () => {
    if (!selectedProvider || !newKeyInput.trim()) return;
    const inputKeys = newKeyInput.split(/\r?\n/).map((key) => key.trim()).filter(Boolean);
    const inputCount = inputKeys.length;
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProvider}/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(inputCount > 1 ? { keys: inputKeys } : { key: newKeyInput.trim() }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to add key');
      }
      const addedCount = typeof resData.addedCount === 'number' ? resData.addedCount : (resData.added ? 1 : 0);
      const duplicateCount = typeof resData.duplicateCount === 'number' ? resData.duplicateCount : 0;
      const batchMessage = inputCount > 1
        ? t.msgKeysAddedBatch
          .replace('{added}', String(addedCount))
          .replace('{duplicates}', String(duplicateCount))
          .replace('{total}', String(resData.totalCount ?? ''))
        : t.msgKeyAdded;
      setNewKeyInput('');
      setConfigMessage({ text: batchMessage, type: 'success' });
      if (inputCount > 1) {
        alert(batchMessage);
      }
      await fetchProviderConfig(selectedProvider);
      await fetchData(true);
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : t.alertAddFailed, type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProvider, newKeyInput, apiKey, t, fetchProviderConfig, fetchData]);

  const handleDeleteKeyGeneral = useCallback(async (providerId: string, hash: string) => {
    const confirmMsg = t.confirmDeleteKey;
    if (!confirm(confirmMsg)) return;
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const res = await fetch(`/api/admin/providers/${providerId}/keys`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ hash }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to delete key');
      }

      if (selectedProvider === providerId) {
        await fetchProviderConfig(providerId);
      }

      await fetchData(true);
      setConfigMessage({ text: t.msgKeyDeleted, type: 'success' });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : t.alertDeleteFailed;
      setConfigMessage({ text: errMsg, type: 'error' });
      alert(errMsg);
    } finally {
      setOperationLoading(false);
    }
  }, [apiKey, t, selectedProvider, fetchProviderConfig, fetchData]);

  const handleTestKeyGeneral = useCallback(async (providerId: string, hash: string, model?: string) => {
    setTestingHash(hash);
    try {
      const res = await fetch(`/api/admin/providers/${providerId}/keys/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ hash, model }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || t.alertVerificationRequestFailed);
      }
      if (resData.valid) {
        alert(t.alertTestSuccess);
      } else {
        const details = resData.error ? `: ${resData.error}` : '';
        alert(`${t.alertTestFailed}${details} (Status: ${resData.status || 'unknown'})`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : t.alertTestError);
    } finally {
      setTestingHash(null);
    }
  }, [apiKey, t]);

  const handleTestInputKey = useCallback(async (model?: string) => {
    if (!selectedProvider || !newKeyInput.trim()) return;
    setTestingInput(true);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProvider}/keys/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ key: newKeyInput.trim(), model }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || t.alertVerificationRequestFailed);
      }
      if (resData.valid) {
        alert(t.alertTestSuccess);
      } else {
        const details = resData.error ? `: ${resData.error}` : '';
        alert(`${t.alertTestFailed}${details} (Status: ${resData.status || 'unknown'})`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : t.alertTestError);
    } finally {
      setTestingInput(false);
    }
  }, [selectedProvider, newKeyInput, apiKey, t]);

  const handleSaveFallbacks = useCallback(async (newChain: string[]) => {
    if (!selectedProvider) return;
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProvider}/fallbacks`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ fallbacks: newChain }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to save fallback chain');
      }
      setConfigMessage({ text: t.msgFallbackSaved, type: 'success' });
      await fetchProviderConfig(selectedProvider);
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : t.alertSaveFallbackFailed, type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProvider, apiKey, t, fetchProviderConfig]);

  const handleResetFallbacks = useCallback(async () => {
    if (!selectedProvider) return;
    const confirmMsg = t.confirmResetFallbacks;
    if (!confirm(confirmMsg)) return;
    setOperationLoading(true);
    setConfigMessage(null);
    try {
      const res = await fetch(`/api/admin/providers/${selectedProvider}/fallbacks`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to reset fallbacks');
      }
      setConfigMessage({ text: t.msgFallbackReset, type: 'success' });
      await fetchProviderConfig(selectedProvider);
    } catch (e) {
      setConfigMessage({ text: e instanceof Error ? e.message : t.alertResetFallbackFailed, type: 'error' });
    } finally {
      setOperationLoading(false);
    }
  }, [selectedProvider, apiKey, t, fetchProviderConfig]);

  const handleSaveQuota = useCallback(async (dailyLimit: number | null, monthlyLimit: number | null) => {
    setOperationLoading(true);
    try {
      const res = await fetch('/api/admin/quota', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ dailyLimit, monthlyLimit }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to save quota limits');
      }
      alert(t.msgQuotaSaved);
      await fetchData(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.alertSaveQuotaFailed);
    } finally {
      setOperationLoading(false);
    }
  }, [apiKey, t, fetchData]);

  const handleResetQuota = useCallback(async () => {
    if (!confirm(t.confirmResetQuota)) return;
    setOperationLoading(true);
    try {
      const res = await fetch('/api/admin/quota', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to reset quota limits');
      }
      alert(t.msgQuotaReset);
      await fetchData(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : t.alertResetQuotaFailed);
    } finally {
      setOperationLoading(false);
    }
  }, [apiKey, t, fetchData]);

  const handleTestCustomProvider = useCallback(async (provider: any, apiKeyValue: string, model?: string) => {
    const res = await fetch(`/api/admin/providers/${provider.name}/keys/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ key: apiKeyValue, model, providerConfig: provider }),
    });
    const resData = await res.json();
    if (!res.ok) {
      throw new Error(resData.error?.message || t.alertVerificationRequestFailed);
    }
    return resData;
  }, [apiKey, t]);

  const handleSaveCustomProvider = useCallback(async (provider: any) => {
    setOperationLoading(true);
    try {
      const { apiKey: apiKeyValue, ...providerConfig } = provider;
      const res = await fetch('/api/admin/providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(providerConfig),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to save custom provider');
      }
      if (typeof apiKeyValue === 'string' && apiKeyValue.trim()) {
        const keyRes = await fetch(`/api/admin/providers/${providerConfig.name}/keys`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ key: apiKeyValue.trim() }),
        });
        const keyData = await keyRes.json();
        if (!keyRes.ok) {
          throw new Error(keyData.error?.message || 'Provider saved, but failed to save API key');
        }
      }
      alert(t.msgProviderSaved);
      setCustomProviderModalOpen(false);
      setEditingCustomProvider(null);
      await fetchData(true);
    } catch (e: any) {
      alert(e.message || t.alertSaveProviderFailed);
    } finally {
      setOperationLoading(false);
    }
  }, [apiKey, t, fetchData]);

  const handleDeleteCustomProvider = useCallback(async (name: string) => {
    if (!confirm(t.deleteCustomProviderConfirm)) return;
    setOperationLoading(true);
    try {
      const res = await fetch('/api/admin/providers', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name }),
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error?.message || 'Failed to delete custom provider');
      }
      alert(t.msgProviderDeleted);
      setSelectedProvider(null);
      await fetchData(true);
    } catch (e: any) {
      alert(e.message || t.alertDeleteProviderFailed);
    } finally {
      setOperationLoading(false);
    }
  }, [apiKey, t, fetchData]);

  return {
    // Core state
    data, setData,
    error, setError,
    authenticated, setAuthenticated,
    loading, setLoading,

    // Config state
    selectedProvider, setSelectedProvider,
    providerKeys, providerFallbacks,
    newKeyInput, setNewKeyInput,
    operationLoading,
    configMessage, setConfigMessage,
    testingHash, testingInput,
    activeFallbacks, setActiveFallbacks,
    selectedFallbackToAdd, setSelectedFallbackToAdd,

    // Custom provider modal
    customProviderModalOpen, setCustomProviderModalOpen,
    editingCustomProvider, setEditingCustomProvider,

    // Actions
    fetchData,
    handleAddKey,
    handleDeleteKeyGeneral,
    handleTestKeyGeneral,
    handleTestInputKey,
    handleSaveFallbacks,
    handleResetFallbacks,
    handleSaveQuota,
    handleResetQuota,
    handleTestCustomProvider,
    handleSaveCustomProvider,
    handleDeleteCustomProvider,
  };
}
