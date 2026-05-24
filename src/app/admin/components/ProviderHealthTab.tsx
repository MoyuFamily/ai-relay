interface ProviderHealthItem {
  id: string;
  name: string;
  status: 'available' | 'degraded' | 'unavailable';
  keyCount: number;
  availableKeys: number;
  errors: Record<string, number>;
  lastCheckedAt: string;
}

interface Props { t: any; data: { providers: ProviderHealthItem[]; timestamp: string } | null; loading: boolean; onRefresh: () => void; }

const statusColor = { available: '#34d399', degraded: '#fbbf24', unavailable: '#f87171' } as const;

export default function ProviderHealthTab({ t, data, loading, onRefresh }: Props) {
  const providers = data?.providers || [];
  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff' }}>{t.providerHealthTitle}</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#9ca3af' }}>{t.providerHealthDesc}</p>
        </div>
        <button className="tab-btn active" onClick={onRefresh} disabled={loading}>{loading ? t.refreshing : t.refresh}</button>
      </div>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {providers.map((p) => {
          const errorSummary = Object.entries(p.errors || {}).map(([code, count]) => `${code}: ${count}`).join(', ');
          return (
            <div key={p.id} className="stat-card" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr 1fr 1fr', gap: '0.75rem', alignItems: 'center' }}>
              <div><strong style={{ color: '#fff' }}>{p.name}</strong><div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{p.id}</div></div>
              <span style={{ color: statusColor[p.status], fontWeight: 800 }}>{t[`health_${p.status}`] || p.status}</span>
              <span style={{ color: '#d1d5db' }}>{p.availableKeys}/{p.keyCount} {t.tblAvailable}</span>
              <span style={{ color: errorSummary ? '#fbbf24' : '#9ca3af', fontSize: '0.85rem' }}>{errorSummary || t.healthNoErrors}</span>
              <div style={{ gridColumn: '1 / -1', color: '#6b7280', fontSize: '0.78rem' }}>{t.healthLastChecked}: {new Date(p.lastCheckedAt).toLocaleString()}</div>
            </div>
          );
        })}
        {providers.length === 0 && <div className="stat-card" style={{ color: '#9ca3af' }}>{t.noConfiguredModels}</div>}
      </div>
    </div>
  );
}
