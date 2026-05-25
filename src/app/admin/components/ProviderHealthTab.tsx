'use client';

import { useState } from 'react';

interface HealthHistoryItem {
  status: HealthStatus;
  checkedAt: string;
  responseTimeMs: number | null;
  statusCode?: number | null;
  error?: string;
}

type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown' | 'available' | 'unavailable';

interface ProviderHealthItem {
  id: string;
  name: string;
  status: HealthStatus;
  legacyStatus?: 'available' | 'degraded' | 'unavailable';
  keyCount: number;
  availableKeys: number;
  errors: Record<string, number>;
  responseTimeMs?: number | null;
  statusCode?: number | null;
  consecutiveFailures?: number;
  lastCheckedAt: string;
  history?: HealthHistoryItem[];
  error?: string;
}

interface Props {
  t: any;
  data: { providers: ProviderHealthItem[]; timestamp: string } | null;
  loading: boolean;
  onRefresh: () => void;
}

const statusMeta: Record<HealthStatus, { color: string; icon: string; zh: string; en: string }> = {
  healthy: { color: '#34d399', icon: '●', zh: 'Healthy', en: 'Healthy' },
  available: { color: '#34d399', icon: '●', zh: 'Healthy', en: 'Healthy' },
  degraded: { color: '#fbbf24', icon: '⚠', zh: 'Degraded', en: 'Degraded' },
  down: { color: '#f87171', icon: '✕', zh: 'Down', en: 'Down' },
  unavailable: { color: '#f87171', icon: '✕', zh: 'Down', en: 'Down' },
  unknown: { color: '#6b7280', icon: '?', zh: 'Unknown', en: 'Unknown' },
};

function formatLatency(ms?: number | null): string {
  if (ms == null) return '—';
  return `${ms}ms`;
}

export default function ProviderHealthTab({ t, data, loading, onRefresh }: Props) {
  const providers = data?.providers || [];
  const [expanded, setExpanded] = useState<string | null>(null);
  const isEn = t.title === 'AI Relay Admin';

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff' }}>{t.providerHealthTitle}</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#9ca3af' }}>{t.providerHealthDesc}</p>
        </div>
        <button className="tab-btn active" onClick={onRefresh} disabled={loading}>{loading ? t.refreshing : t.refresh}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
        {providers.map((p) => {
          const meta = statusMeta[p.status] || statusMeta.unknown;
          const errorSummary = Object.entries(p.errors || {}).map(([code, count]) => `${code}: ${count}`).join(', ');
          const open = expanded === p.id;
          return (
            <button
              key={p.id}
              className="stat-card"
              onClick={() => setExpanded(open ? null : p.id)}
              style={{ textAlign: 'left', cursor: 'pointer', color: '#d1d5db', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                <div>
                  <strong style={{ color: '#fff' }}>{p.name}</strong>
                  <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{p.id}</div>
                </div>
                <span style={{ color: meta.color, fontWeight: 800, whiteSpace: 'nowrap' }}>{meta.icon} {isEn ? meta.en : meta.zh}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', fontSize: '0.82rem' }}>
                <span><b style={{ color: '#fff' }}>{p.availableKeys}/{p.keyCount}</b><br /><span style={{ color: '#9ca3af' }}>{t.tblAvailable}</span></span>
                <span><b style={{ color: '#fff' }}>{formatLatency(p.responseTimeMs)}</b><br /><span style={{ color: '#9ca3af' }}>Latency</span></span>
                <span><b style={{ color: '#fff' }}>{p.consecutiveFailures || 0}</b><br /><span style={{ color: '#9ca3af' }}>Failures</span></span>
              </div>
              <div style={{ display: 'flex', gap: 4, minHeight: 16 }}>
                {(p.history || []).slice(0, 14).reverse().map((item, idx) => {
                  const itemMeta = statusMeta[item.status] || statusMeta.unknown;
                  return <span key={`${item.checkedAt}-${idx}`} title={`${item.checkedAt} ${item.status}`} style={{ flex: 1, height: 10, borderRadius: 99, background: itemMeta.color }} />;
                })}
                {(p.history || []).length === 0 && <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>No probe history</span>}
              </div>
              <div style={{ color: '#6b7280', fontSize: '0.78rem' }}>{t.healthLastChecked}: {new Date(p.lastCheckedAt).toLocaleString()}</div>
              {(p.error || errorSummary) && <div style={{ color: '#fbbf24', fontSize: '0.78rem' }}>{p.error || errorSummary}</div>}
              {open && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {(p.history || []).slice(0, 8).map((item, idx) => {
                    const itemMeta = statusMeta[item.status] || statusMeta.unknown;
                    return (
                      <div key={`${item.checkedAt}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '0.5rem', fontSize: '0.78rem' }}>
                        <span style={{ color: '#9ca3af' }}>{new Date(item.checkedAt).toLocaleString()}</span>
                        <span style={{ color: itemMeta.color }}>{itemMeta.icon} {item.status}</span>
                        <span style={{ color: '#d1d5db' }}>{formatLatency(item.responseTimeMs)}</span>
                        {item.error && <span style={{ gridColumn: '1 / -1', color: '#fbbf24' }}>{item.error}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </button>
          );
        })}
        {providers.length === 0 && <div className="stat-card" style={{ color: '#9ca3af' }}>{t.noConfiguredModels}</div>}
      </div>
    </div>
  );
}
