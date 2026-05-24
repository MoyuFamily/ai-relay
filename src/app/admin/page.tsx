'use client';

import { useState, useEffect } from 'react';
import LogoIcon from './components/LogoIcon';
import OverviewTab from './components/OverviewTab';
import KeysTab from './components/KeysTab';
import ToolsTab from './components/ToolsTab';
import WebhooksTab from './components/WebhooksTab';
import SetupTab from './components/SetupTab';
import ProviderHealthTab from './components/ProviderHealthTab';
import RequestLogsTab from './components/RequestLogsTab';
import type { AdminData } from './types';
import { TRANSLATIONS } from './translations';
import { useAdminHandlers } from './adminHandlers';

export default function AdminPage() {
  const [apiKey, setApiKey] = useState('');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [activeTab, setActiveTab] = useState<'setup' | 'overview' | 'keys' | 'health' | 'logs' | 'tools' | 'webhooks'>('setup');
  const [setupData, setSetupData] = useState<any>(null);
  const [providerHealthData, setProviderHealthData] = useState<any>(null);
  const [requestLogsData, setRequestLogsData] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('');
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
    handleSaveFallbacks,
    handleResetFallbacks,
    handleSaveQuota,
    handleResetQuota,
    handleSaveCustomProvider,
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

  // Restore cached API key from localStorage on mount
  useEffect(() => {
    const cached = localStorage.getItem('airelay_admin_key');
    if (cached) {
      setApiKey(cached);
      setLoading(true);
      fetch('/api/admin', {
        headers: { Authorization: `Bearer ${cached}` },
        cache: 'no-store',
      })
        .then((res) => {
          if (res.status === 401) {
            localStorage.removeItem('airelay_admin_key');
            return;
          }
          return res.json();
        })
        .then((json) => {
          if (json) {
            setData(json);
            setAuthenticated(true);
          }
        })
        .catch(() => {
          localStorage.removeItem('airelay_admin_key');
        })
        .finally(() => setLoading(false));
    }
  }, [setData, setAuthenticated, setLoading]);

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

  const fetchSetup = async () => {
    setV21Loading(true);
    try {
      setSetupData(await adminFetch('/api/admin/setup'));
    } finally {
      setV21Loading(false);
    }
  };

  const fetchProviderHealth = async () => {
    setV21Loading(true);
    try {
      setProviderHealthData(await adminFetch('/api/admin/provider-health'));
    } finally {
      setV21Loading(false);
    }
  };

  const fetchRequestLogs = async () => {
    setV21Loading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter, limit: '100' });
      if (providerFilter.trim()) params.set('provider', providerFilter.trim());
      setRequestLogsData(await adminFetch(`/api/admin/request-logs?${params.toString()}`));
    } finally {
      setV21Loading(false);
    }
  };

  useEffect(() => {
    if (!authenticated) return;
    if (activeTab === 'setup') fetchSetup().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (activeTab === 'health') fetchProviderHealth().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    if (activeTab === 'logs') fetchRequestLogs().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, activeTab, statusFilter]);

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

        <div className="glass-panel" style={{ maxWidth: '400px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <LogoIcon size={48} />
            <h1 style={{ fontSize: '1.75rem', margin: 0, fontWeight: 700, color: '#fff' }}>{t.adminLogin}</h1>
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%',
          }}>
            <input
              type="password"
              placeholder={t.enterAdminKey}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchData()}
              style={{
                width: '100%', padding: '0.75rem 1rem', borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: 'rgba(0, 0, 0, 0.25)', color: '#e5e7eb',
                fontSize: '1rem', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box'
              }}
              onFocus={(e) => e.target.style.borderColor = 'rgba(59, 130, 246, 0.5)'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.08)'}
            />
            <button
              onClick={fetchData}
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
          {error && (
            <p style={{ color: '#f87171', margin: 0, fontSize: '0.9rem', fontWeight: 500 }}>
              {error === 'unauthorized' ? t.invalidKey : (error === 'failed_fetch' ? t.failedFetch : error)}
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main style={{
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

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <LogoIcon size={38} />
          <div>
            <h1 style={{ fontSize: '1.8rem', margin: 0, fontWeight: 700, color: '#fff' }}>{t.title}</h1>
            {process.env.NEXT_PUBLIC_DEPLOY_TIME && (
              <span style={{ fontSize: '0.72rem', color: '#9ca3af', display: 'block', marginTop: '0.15rem' }}>
                {t.deployTime}: {new Date(process.env.NEXT_PUBLIC_DEPLOY_TIME).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <a
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
          </a>
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
            onClick={fetchData}
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

      {/* Tabs list */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
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
          className={`tab-btn ${activeTab === 'health' ? 'active' : ''}`}
          onClick={() => setActiveTab('health')}
        >
          {t.tabHealth}
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
            setupData={setupData}
            loading={v21Loading}
            onRunChecks={fetchSetup}
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
            onSaveFallbacks={handleSaveFallbacks}
            onResetFallbacks={handleResetFallbacks}
            customProviderModalOpen={customProviderModalOpen}
            setCustomProviderModalOpen={setCustomProviderModalOpen}
            editingCustomProvider={editingCustomProvider}
            setEditingCustomProvider={setEditingCustomProvider}
            onSaveCustomProvider={handleSaveCustomProvider}
            onDeleteCustomProvider={handleDeleteCustomProvider}
          />
        )}
        {activeTab === 'health' && (
          <ProviderHealthTab
            t={t}
            data={providerHealthData}
            loading={v21Loading}
            onRefresh={fetchProviderHealth}
          />
        )}
        {activeTab === 'logs' && (
          <RequestLogsTab
            t={t}
            data={requestLogsData}
            loading={v21Loading}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            providerFilter={providerFilter}
            setProviderFilter={setProviderFilter}
            onRefresh={fetchRequestLogs}
          />
        )}
        {activeTab === 'tools' && (
          <ToolsTab
            apiKey={apiKey}
            lang={lang}
            t={t}
            providers={data?.providers || []}
            onRefreshData={fetchData}
          />
        )}
        {activeTab === 'webhooks' && (
          <WebhooksTab
            apiKey={apiKey}
            lang={lang}
            t={t}
            providers={data?.providers || []}
            onRefreshData={fetchData}
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
    </main>
  );
}
