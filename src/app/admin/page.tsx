'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import LogoIcon from './components/LogoIcon';
import OverviewTab from './components/OverviewTab';
import KeysTab from './components/KeysTab';
import ToolsTab from './components/ToolsTab';
import WebhooksTab from './components/WebhooksTab';
import SetupTab from './components/SetupTab';
import ProviderHealthTab from './components/ProviderHealthTab';
import UsageReportTab from './components/UsageReportTab';
import RequestLogsTab from './components/RequestLogsTab';
import ModelAliasesTab from './components/ModelAliasesTab';
import SecurityTab from './components/SecurityTab';
import RoutingPolicyTab from './components/RoutingPolicyTab';
import CcSwitchImportButton from './components/CcSwitchImportButton';
import { ErrorDetailPanel } from '../components/ErrorDetailPanel';
import { BottomNav, type TabId } from '../components/BottomNav';
import type { AdminData, PriorityRule, PriorityRuleConflict } from './types';
import { TRANSLATIONS } from './translations';
import { useAdminHandlers } from './adminHandlers';

function generateClientRandomKey(): string {
  const bytes = new Uint8Array(24);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sk-relay-${hex}`;
}

export default function AdminPage() {
  const [apiKey, setApiKey] = useState('');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [bootstrapStatus, setBootstrapStatus] = useState<{
    checked: boolean;
    initialized: boolean;
    canBootstrap: boolean;
    storageBackend: string;
  }>({ checked: false, initialized: true, canBootstrap: false, storageBackend: 'none' });
  const [bootstrapKey, setBootstrapKey] = useState('');
  const [bootstrapCopied, setBootstrapCopied] = useState(false);
  const [bootstrapSubmitting, setBootstrapSubmitting] = useState(false);
  const [justBootstrappedKey, setJustBootstrappedKey] = useState<string | null>(null);
  const [bannerCopied, setBannerCopied] = useState(false);
  // Default to 'overview' if user has configured admin key before; otherwise show 'setup' for first-time deployment
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window !== 'undefined') {
      const hasConfigured = localStorage.getItem('airelay_admin_key');
      return hasConfigured ? 'overview' : 'setup';
    }
    return 'setup';
  });
  const [setupData, setSetupData] = useState<any>(null);
  const [providerHealthData, setProviderHealthData] = useState<any>(null);
  const [priorityRules, setPriorityRules] = useState<PriorityRule[]>([]);
  const [priorityConflicts, setPriorityConflicts] = useState<PriorityRuleConflict[]>([]);
  const [priorityMessage, setPriorityMessage] = useState('');
  const [v21Loading, setV21Loading] = useState(false);

  const t = TRANSLATIONS[lang];

  const {
    data, setData,
    error, setError,
    authenticated, setAuthenticated,
    loading, setLoading,
    selectedProvider, setSelectedProvider,
    providerKeys, providerFallbacks,
    newKeyInput, setNewKeyInput,
    operationLoading,
    configMessage, setConfigMessage,
    testingHash, testingInput,
    activeFallbacks, setActiveFallbacks,
    selectedFallbackToAdd, setSelectedFallbackToAdd,
    customProviderModalOpen, setCustomProviderModalOpen,
    editingCustomProvider, setEditingCustomProvider,
    fetchData,
    handleAddKey,
    handleDeleteKeyGeneral,
    handleTestKeyGeneral,
    handleTestInputKey,
    handleTestAndAddKey,
    handleSaveFallbacks,
    handleResetFallbacks,
    handleSaveQuota,
    handleResetQuota,
    handleTestCustomProvider,
    handleFetchProviderModels,
    handleSaveCustomProvider,
    handleImportProviderLink,
    handleDeleteCustomProvider,
  } = useAdminHandlers(apiKey, t);

  // Load language settings on mount
  useEffect(() => {
    const cachedLang = localStorage.getItem('airelay_lang');
    if (cachedLang === 'zh' || cachedLang === 'en') {
      setLang(cachedLang);
    } else {
      const userLang = navigator.language.toLowerCase();
      const preferred = userLang.startsWith('zh') ? 'zh' : 'en';
      setLang(preferred);
    }
  }, []);

  const handleSetLang = (newLang: 'zh' | 'en') => {
    setLang(newLang);
    localStorage.setItem('airelay_lang', newLang);
  };

  // Restore cached API key from localStorage on mount & check first-time bootstrap status
  useEffect(() => {
    const checkBootstrap = () => {
      fetch('/api/admin/bootstrap', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((status) => {
          if (status && typeof status.initialized === 'boolean') {
            setBootstrapStatus({
              checked: true,
              initialized: status.initialized,
              canBootstrap: Boolean(status.canBootstrap),
              storageBackend: String(status.storageBackend || 'none'),
            });
            if (!status.initialized && status.canBootstrap) {
              setBootstrapKey((prev) => prev || generateClientRandomKey());
            }
          } else {
            setBootstrapStatus((prev) => ({ ...prev, checked: true }));
          }
        })
        .catch(() => {
          setBootstrapStatus((prev) => ({ ...prev, checked: true }));
        });
    };

    const cached = localStorage.getItem('airelay_admin_key');
    if (cached) {
      setApiKey(cached);
      setLoading(true);
      fetch('/api/admin', {
        headers: { Authorization: `Bearer ${cached}` },
        cache: 'no-store',
      })
        .then((res) => {
          if (res.status === 401 || res.status === 503) {
            localStorage.removeItem('airelay_admin_key');
            checkBootstrap();
            return;
          }
          return res.json();
        })
        .then((json) => {
          if (json) {
            setData(json);
            setAuthenticated(true);
            setBootstrapStatus((prev) => ({ ...prev, checked: true, initialized: true }));
          }
        })
        .catch(() => {
          localStorage.removeItem('airelay_admin_key');
          checkBootstrap();
        })
        .finally(() => setLoading(false));
    } else {
      checkBootstrap();
    }
  }, [setData, setAuthenticated, setLoading]);

  const handleBootstrapSubmit = async () => {
    setError('');
    setBootstrapSubmitting(true);
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: bootstrapKey.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setBootstrapStatus((prev) => ({ ...prev, initialized: true, canBootstrap: false }));
        }
        setError(json.error?.message || t.failedFetch);
        return;
      }

      const finalKey = String(json.apiKey || bootstrapKey.trim());
      setApiKey(finalKey);
      localStorage.setItem('airelay_admin_key', finalKey);
      setJustBootstrappedKey(finalKey);
      setBootstrapStatus((prev) => ({ ...prev, initialized: true, canBootstrap: false }));
      setActiveTab('setup');

      // Immediately authenticate into Admin console with the newly initialized key
      const adminRes = await fetch('/api/admin', {
        headers: { Authorization: `Bearer ${finalKey}` },
        cache: 'no-store',
      });
      if (adminRes.ok) {
        const adminJson = await adminRes.json();
        setData(adminJson);
        setAuthenticated(true);
      }
    } catch {
      setError('failed_fetch');
    } finally {
      setBootstrapSubmitting(false);
    }
  };

  useEffect(() => {
    if (!authenticated) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let autoRefreshInFlight = false;

    const autoRefresh = async () => {
      if (autoRefreshInFlight) return;
      autoRefreshInFlight = true;
      try {
        await fetchData();
      } finally {
        autoRefreshInFlight = false;
      }
    };

    const stopAutoRefresh = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };

    const startAutoRefresh = () => {
      if (document.visibilityState !== 'visible' || interval) return;
      interval = setInterval(autoRefresh, 15000);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        autoRefresh();
        startAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    };

    startAutoRefresh();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopAutoRefresh();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authenticated, fetchData]);


  const adminFetch = async (path: string) => {
    const res = await fetch(path, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || json.error || 'Admin API request failed');
    return json;
  };

  const fetchSetup = async (forceRefresh = false) => {
    setV21Loading(true);
    try {
      setSetupData(await adminFetch(`/api/admin/setup${forceRefresh ? '?refresh=1' : ''}`));
    } finally {
      setV21Loading(false);
    }
  };

  const fetchProviderHealth = async (forceRefresh = false) => {
    setV21Loading(true);
    try {
      if (forceRefresh) {
        await adminFetch('/api/cron/probe?manual=1');
      }
      setProviderHealthData(await adminFetch(`/api/admin/provider-health${forceRefresh ? '?refresh=1' : ''}`));
    } finally {
      setV21Loading(false);
    }
  };

  const fetchPriorityRules = async (forceRefresh = false) => {
    setV21Loading(true);
    try {
      const json = await adminFetch(`/api/admin/priority-rules${forceRefresh ? '?refresh=1' : ''}`);
      setPriorityRules(json.rules || []);
      setPriorityConflicts(json.conflicts || []);
    } finally {
      setV21Loading(false);
    }
  };

  const savePriorityRulesFromTab = async (rules: PriorityRule[]) => {
    setV21Loading(true);
    setPriorityMessage('');
    try {
      const res = await fetch('/api/admin/priority-rules', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      const json = await res.json();
      setPriorityConflicts(json.conflicts || []);
      if (!res.ok) throw new Error(json.error?.message || 'Failed to save priority rules');
      setPriorityRules(json.rules || []);
      setPriorityMessage('优先级规则已保存');
      await fetchData(true);
    } catch (err) {
      setPriorityMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setV21Loading(false);
    }
  };

  const reorderPriorityRulesFromTab = async (rules: PriorityRule[]) => {
    setPriorityRules(rules);
    try {
      const res = await fetch('/api/admin/priority-rules', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: rules.map((rule) => rule.id) }),
      });
      const json = await res.json();
      setPriorityConflicts(json.conflicts || []);
      if (res.ok) setPriorityRules(json.rules || rules);
    } catch (err) {
      setPriorityMessage(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!authenticated) return;
    if (activeTab === 'setup') fetchSetup().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (activeTab === 'health') fetchProviderHealth().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (activeTab === 'routingPolicy') fetchPriorityRules().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // logs tab manages its own data fetching + localStorage
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, activeTab]);

  if (!authenticated) {
    return (
      <main style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100vh', padding: '2rem',
        position: 'relative',
        boxSizing: 'border-box'
      }}>
        <style dangerouslySetInnerHTML={{ __html: `
          body {
            background: radial-gradient(circle at top, #1e293b, #09090b);
            background-attachment: fixed;
            color: #e5e7eb;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
          }
          .glass-panel {
            background: rgba(30, 41, 59, 0.45);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 16px;
            padding: 2rem;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
          }
        `}} />
        
        {/* Language switch on login screen */}
        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem' }}>
          <button
            onClick={() => handleSetLang(lang === 'zh' ? 'en' : 'zh')}
            style={{
              padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.04)', color: '#ccc', cursor: 'pointer', fontSize: '0.85rem',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; e.currentTarget.style.color = '#ccc'; }}
          >
            {lang === 'zh' ? 'English' : '中文'}
          </button>
        </div>

        <div className="glass-panel" style={{ maxWidth: !bootstrapStatus.initialized ? '480px' : '400px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.35rem', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem', textAlign: 'center' }}>
            <LogoIcon size={48} />
            <h1 style={{ fontSize: '1.75rem', margin: 0, fontWeight: 700, color: '#fff' }}>
              {bootstrapStatus.checked && !bootstrapStatus.initialized
                ? (bootstrapStatus.canBootstrap ? t.bootstrapTitle : t.bootstrapNoStorageTitle)
                : t.adminLogin}
            </h1>
            {bootstrapStatus.checked && !bootstrapStatus.initialized && bootstrapStatus.canBootstrap && (
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#94a3b8', lineHeight: 1.55 }}>
                {t.bootstrapSubtitle}
              </p>
            )}
          </div>

          {bootstrapStatus.checked && !bootstrapStatus.initialized && bootstrapStatus.canBootstrap ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', width: '100%' }}>
              <label style={{ fontSize: '0.82rem', color: '#cbd5e1', fontWeight: 600 }}>
                {t.bootstrapKeyLabel}
              </label>
              <input
                type="text"
                value={bootstrapKey}
                onChange={(e) => setBootstrapKey(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                style={{
                  width: '100%', padding: '0.75rem 0.9rem', borderRadius: '8px',
                  border: '1px solid rgba(96, 165, 250, 0.35)', backgroundColor: 'rgba(0, 0, 0, 0.35)', color: '#e2e8f0',
                  fontSize: '0.88rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  outline: 'none', boxSizing: 'border-box'
                }}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setBootstrapKey(generateClientRandomKey());
                    setBootstrapCopied(false);
                  }}
                  style={{
                    flex: 1, padding: '0.55rem 0.75rem', borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.12)', backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    color: '#e2e8f0', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500
                  }}
                >
                  🎲 {t.bootstrapRegenerate}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(bootstrapKey).catch(() => {});
                    setBootstrapCopied(true);
                    setTimeout(() => setBootstrapCopied(false), 2500);
                  }}
                  style={{
                    flex: 1, padding: '0.55rem 0.75rem', borderRadius: '8px',
                    border: '1px solid rgba(59, 130, 246, 0.35)', backgroundColor: 'rgba(59, 130, 246, 0.12)',
                    color: '#93c5fd', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600
                  }}
                >
                  📋 {bootstrapCopied ? t.bootstrapCopied : t.bootstrapCopy}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.5 }}>
                {t.bootstrapKeyHint}
              </p>
              <button
                type="button"
                onClick={handleBootstrapSubmit}
                disabled={bootstrapSubmitting || bootstrapKey.trim().length < 12}
                style={{
                  width: '100%', padding: '0.82rem 1.5rem', borderRadius: '8px', border: 'none',
                  background: 'linear-gradient(135deg, #2563eb, #7c3aed)', color: 'white',
                  fontSize: '0.98rem', fontWeight: 700,
                  cursor: bootstrapSubmitting ? 'wait' : 'pointer',
                  opacity: bootstrapSubmitting || bootstrapKey.trim().length < 12 ? 0.6 : 1,
                  transition: 'all 0.2s'
                }}
              >
                {bootstrapSubmitting ? t.bootstrapConfirming : t.bootstrapConfirm}
              </button>
            </div>
          ) : bootstrapStatus.checked && !bootstrapStatus.initialized && !bootstrapStatus.canBootstrap ? (
            <div style={{
              width: '100%', padding: '1rem', borderRadius: '10px',
              backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)',
              color: '#fcd34d', fontSize: '0.88rem', lineHeight: 1.6, boxSizing: 'border-box'
            }}>
              {t.bootstrapNoStorageDesc}
            </div>
          ) : (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%',
            }}>
              <input
                type="password"
                placeholder={t.enterAdminKey}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchData(true)}
                style={{
                  width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: 'rgba(0, 0, 0, 0.25)', color: '#e5e7eb',
                  fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
                }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(59, 130, 246, 0.5)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.08)'}
              />
              <button
                onClick={() => fetchData(true)}
                disabled={loading || !apiKey}
                style={{
                  width: '100%', padding: '0.75rem 1.5rem', borderRadius: '8px', border: 'none',
                  backgroundColor: '#2563eb', color: 'white', fontSize: '1rem', fontWeight: 'bold',
                  cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1, transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                onMouseLeave={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#2563eb'; }}
              >
                {loading ? '...' : t.login}
              </button>
            </div>
          )}
          {error && (
            <p style={{ color: '#f87171', margin: 0, fontSize: '0.9rem', fontWeight: 500, textAlign: 'center', lineHeight: 1.5 }}>
              {error === 'unauthorized'
                ? t.invalidKey
                : error === 'server_not_configured'
                  ? t.serverNotConfigured
                  : error === 'failed_fetch'
                    ? t.failedFetch
                    : error}
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="admin-content" style={{
      maxWidth: '1000px', margin: '0 auto', padding: '2rem',
    }}>
      <style dangerouslySetInnerHTML={{ __html: `
        body {
          background: radial-gradient(circle at top, #1e293b, #09090b);
          background-attachment: fixed;
          color: #e5e7eb;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          margin: 0;
        }
        .glass-panel {
          background: rgba(30, 41, 59, 0.45);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 1.5rem;
          box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
        }
        .stat-card {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 12px;
          padding: 1rem 1.25rem;
          box-shadow: inset 0 2px 4px rgba(255, 255, 255, 0.02);
        }
        .tab-btn {
          padding: 0.6rem 1.2rem;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background-color: rgba(255, 255, 255, 0.02);
          color: #9ca3af;
          cursor: pointer;
          font-size: 0.9rem;
          font-weight: 500;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .tab-btn:hover {
          background-color: rgba(255, 255, 255, 0.06);
          color: #fff;
          border-color: rgba(255, 255, 255, 0.12);
        }
        .tab-btn.active {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.15));
          border-color: rgba(59, 130, 246, 0.4);
          color: #60a5fa;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.15);
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
          display: inline-block;
        }
        .content-area {
          /* Page content container */
        }
      `}} />

      {/* Post-Bootstrap One-Time Key Reminder Banner */}
      {justBootstrappedKey && (
        <div style={{
          marginBottom: '1.25rem',
          padding: '0.9rem 1.1rem',
          borderRadius: '12px',
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.14), rgba(59, 130, 246, 0.14))',
          border: '1px solid rgba(52, 211, 153, 0.35)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#6ee7b7' }}>
              {t.bootstrapBannerTitle}
            </span>
            <code style={{
              fontSize: '0.84rem', color: '#f8fafc', backgroundColor: 'rgba(0,0,0,0.35)',
              padding: '0.35rem 0.6rem', borderRadius: '6px', wordBreak: 'break-all',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              {justBootstrappedKey}
            </code>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(justBootstrappedKey).catch(() => {});
                setBannerCopied(true);
                setTimeout(() => setBannerCopied(false), 2500);
              }}
              style={{
                padding: '0.45rem 0.85rem', borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.4)', backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: '#bfdbfe', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
              }}
            >
              📋 {bannerCopied ? t.bootstrapCopied : t.bootstrapCopy}
            </button>
            <button
              type="button"
              onClick={() => setJustBootstrappedKey(null)}
              style={{
                padding: '0.45rem 0.85rem', borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.15)', backgroundColor: 'rgba(255, 255, 255, 0.06)',
                color: '#e5e7eb', cursor: 'pointer', fontSize: '0.82rem',
              }}
            >
              {t.bootstrapBannerDismiss}
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <LogoIcon size={38} />
          <div>
            <h1 style={{ fontSize: '1.8rem', margin: 0, fontWeight: 700, color: '#fff' }}>{t.title}</h1>
            {(process.env.NEXT_PUBLIC_DEPLOY_TIME || process.env.NEXT_PUBLIC_DEPLOY_COMMIT) && (
              <span style={{ fontSize: '0.72rem', color: '#9ca3af', display: 'block', marginTop: '0.15rem' }}>
                {process.env.NEXT_PUBLIC_DEPLOY_TIME && (
                  <>
                    {t.deployTime}: {new Date(process.env.NEXT_PUBLIC_DEPLOY_TIME).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
                  </>
                )}
                {process.env.NEXT_PUBLIC_DEPLOY_TIME && process.env.NEXT_PUBLIC_DEPLOY_COMMIT && ' · '}
                {process.env.NEXT_PUBLIC_DEPLOY_COMMIT && (
                  <>
                    {t.deployCommit}:{' '}
                    <code
                      title={process.env.NEXT_PUBLIC_DEPLOY_COMMIT}
                      style={{ color: '#cbd5e1', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                    >
                      {process.env.NEXT_PUBLIC_DEPLOY_COMMIT.slice(0, 7)}
                    </code>
                  </>
                )}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Link
            href="/"
            style={{
              padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.04)', color: '#d1d5db', textDecoration: 'none',
              fontSize: '0.85rem', transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; e.currentTarget.style.color = '#d1d5db'; }}
          >
            {t.navHome}
          </Link>
          <Link
            href="/admin/local-relay"
            style={{
              padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.04)', color: '#d1d5db', textDecoration: 'none',
              fontSize: '0.85rem', transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; e.currentTarget.style.color = '#d1d5db'; }}
          >
            💻 {t.navLocalRelay}
          </Link>
          <CcSwitchImportButton
            apiKey={apiKey}
            lang={lang}
            t={t}
            mode="relay"
          />
          <button
            onClick={() => handleSetLang(lang === 'zh' ? 'en' : 'zh')}
            style={{
              padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.04)', color: '#d1d5db', cursor: 'pointer',
              fontSize: '0.85rem', transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; e.currentTarget.style.color = '#d1d5db'; }}
          >
            {lang === 'zh' ? 'English' : '中文'}
          </button>
          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(255, 255, 255, 0.04)', color: '#d1d5db', cursor: loading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'; }}
            onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; }}
          >
            <span className={loading ? 'spin' : ''}>🔄</span>
            {loading ? t.refreshing : t.refresh}
          </button>
        </div>
      </div>

      {/* Error detail panel — shows when structured API errors occur */}
      {error && authenticated && (
        <div style={{ marginBottom: '1.5rem' }}>
          <ErrorDetailPanel
            statusCode={error === 'unauthorized' ? 401 : error === 'failed_fetch' ? 502 : 500}
            message={error === 'unauthorized' ? t.invalidKey : (error === 'failed_fetch' ? t.failedFetch : error)}
            onRetry={() => { setError(null); fetchData(true); }}
          />
        </div>
      )}

      {/* Tabs list — hidden on mobile (< 640px) where BottomNav takes over */}
      <div className="admin-desktop-tabs" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button
          className={`tab-btn ${activeTab === 'setup' ? 'active' : ''}`}
          onClick={() => setActiveTab('setup')}
        >
          {t.tabSetup}
        </button>
        <button
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          {t.tabOverview}
        </button>
        <button
          className={`tab-btn ${activeTab === 'keys' ? 'active' : ''}`}
          onClick={() => setActiveTab('keys')}
        >
          {t.tabKeys}
        </button>
        <button
          className={`tab-btn ${activeTab === 'routingPolicy' ? 'active' : ''}`}
          onClick={() => setActiveTab('routingPolicy')}
        >
          🧭 {lang === 'zh' ? '路由策略' : 'Routing Policy'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'health' ? 'active' : ''}`}
          onClick={() => setActiveTab('health')}
        >
          {t.tabHealth}
        </button>
        <button
          className={`tab-btn ${activeTab === 'usage' ? 'active' : ''}`}
          onClick={() => setActiveTab('usage')}
        >
          {lang === 'zh' ? '📈 用量报告' : '📈 Usage Report'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'security' ? 'active' : ''}`}
          onClick={() => setActiveTab('security')}
        >
          {lang === 'zh' ? '🛡️ Key安全' : '🛡️ Key Security'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'models' ? 'active' : ''}`}
          onClick={() => setActiveTab('models')}
        >
          模型配置
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          {t.tabLogs}
        </button>
        <button
          className={`tab-btn ${activeTab === 'tools' ? 'active' : ''}`}
          onClick={() => setActiveTab('tools')}
        >
          {t.tabTools}
        </button>
        <button
          className={`tab-btn ${activeTab === 'webhooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('webhooks')}
        >
          {t.tabWebhooks}
        </button>
      </div>

      {/* Page Body */}
      <div className="content-area">
        {activeTab === 'setup' && (
          <SetupTab
            t={t}
            lang={lang}
            apiKey={apiKey}
            setupData={setupData}
            loading={v21Loading}
            onRunChecks={() => fetchSetup(true)}
            onOpenKeys={(providerId) => {
              if (providerId) setSelectedProvider(providerId);
              setActiveTab('keys');
            }}
          />
        )}
        {activeTab === 'overview' && (
          <OverviewTab
            data={data!}
            apiKey={apiKey}
            lang={lang}
            t={t}
            testingHash={testingHash}
            operationLoading={operationLoading}
            onTestKey={handleTestKeyGeneral}
            onDeleteKey={handleDeleteKeyGeneral}
            onSaveQuota={handleSaveQuota}
            onResetQuota={handleResetQuota}
          />
        )}
        {activeTab === 'keys' && (
          <KeysTab
            data={data!}
            lang={lang}
            t={t}
            selectedProvider={selectedProvider}
            setSelectedProvider={setSelectedProvider}
            providerKeys={providerKeys}
            providerFallbacks={providerFallbacks}
            newKeyInput={newKeyInput}
            setNewKeyInput={setNewKeyInput}
            operationLoading={operationLoading}
            configMessage={configMessage}
            setConfigMessage={setConfigMessage}
            testingHash={testingHash}
            testingInput={testingInput}
            activeFallbacks={activeFallbacks}
            setActiveFallbacks={setActiveFallbacks}
            selectedFallbackToAdd={selectedFallbackToAdd}
            setSelectedFallbackToAdd={setSelectedFallbackToAdd}
            onAddKey={handleAddKey}
            onDeleteKey={handleDeleteKeyGeneral}
            onTestKey={handleTestKeyGeneral}
            onTestInputKey={handleTestInputKey}
            onTestAndAddKey={handleTestAndAddKey}
            onSaveFallbacks={handleSaveFallbacks}
            onResetFallbacks={handleResetFallbacks}
            customProviderModalOpen={customProviderModalOpen}
            setCustomProviderModalOpen={setCustomProviderModalOpen}
            editingCustomProvider={editingCustomProvider}
            setEditingCustomProvider={setEditingCustomProvider}
            onSaveCustomProvider={handleSaveCustomProvider}
            onTestCustomProvider={handleTestCustomProvider}
            onFetchProviderModels={handleFetchProviderModels}
            onImportProviderLink={handleImportProviderLink}
            onDeleteCustomProvider={handleDeleteCustomProvider}
            apiKey={apiKey}
          />
        )}
        {activeTab === 'models' && (
          <ModelAliasesTab
            apiKey={apiKey}
            providers={data?.providers || []}
            onRefreshData={() => fetchData(true)}
          />
        )}
        {activeTab === 'health' && (
          <ProviderHealthTab
            t={t}
            data={providerHealthData}
            loading={v21Loading}
            onRefresh={() => fetchProviderHealth(true)}
          />
        )}
        {activeTab === 'routingPolicy' && (
          <RoutingPolicyTab
            apiKey={apiKey}
            lang={lang}
            t={t}
            data={data!}
            priorityRules={priorityRules}
            priorityConflicts={priorityConflicts}
            priorityMessage={priorityMessage}
            onAddRule={() => setPriorityMessage('')}
            onDeleteRule={() => setPriorityMessage('')}
            onReorderRules={reorderPriorityRulesFromTab}
            onSaveRules={savePriorityRulesFromTab}
          />
        )}
        {activeTab === 'security' && (
          <SecurityTab
            apiKey={apiKey}
            lang={lang}
          />
        )}
        {activeTab === 'usage' && (
          <UsageReportTab
            apiKey={apiKey}
            lang={lang}
          />
        )}
        {activeTab === 'logs' && (
          <RequestLogsTab
            t={t}
          />
        )}
        {activeTab === 'tools' && (
          <ToolsTab
            apiKey={apiKey}
            lang={lang}
            t={t}
            providers={data?.providers || []}
            onRefreshData={() => fetchData(true)}
          />
        )}
        {activeTab === 'webhooks' && (
          <WebhooksTab
            apiKey={apiKey}
            lang={lang}
            t={t}
            providers={data?.providers || []}
            onRefreshData={() => fetchData(true)}
          />
        )}
      </div>

      {data && (
        <p style={{
          color: '#6b7280', marginTop: '2.5rem', fontSize: '0.8rem', textAlign: 'center',
        }}>
          {t.autoRefreshInfo} {new Date(data.timestamp).toLocaleTimeString()}
        </p>
      )}

      {/* Mobile bottom navigation — only visible on screens < 640px */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </main>
  );
}
