interface RequestLogEntry {
  traceId: string; timestamp: string; provider?: string; model?: string; status: 'success' | 'error';
  httpStatus: number; latencyMs: number; totalTokens?: number; errorType?: string; errorMessage?: string; diagnostic?: string;
}
interface RequestLogsData { items: RequestLogEntry[]; degraded: boolean; source: 'kv' | 'memory'; timestamp: string; }
interface Props { t: any; data: RequestLogsData | null; loading: boolean; statusFilter: string; setStatusFilter: (v: string) => void; providerFilter: string; setProviderFilter: (v: string) => void; onRefresh: () => void; }

export default function RequestLogsTab({ t, data, loading, statusFilter, setStatusFilter, providerFilter, setProviderFilter, onRefresh }: Props) {
  const items = data?.items || [];
  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff' }}>{t.requestLogsTitle}</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#9ca3af' }}>{t.requestLogsDesc}</p>
        </div>
        <button className="tab-btn active" onClick={onRefresh} disabled={loading}>{loading ? t.refreshing : t.refresh}</button>
      </div>
      {data?.degraded && <div className="stat-card" style={{ color: '#fbbf24' }}>{t.requestLogsDegraded}</div>}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: '0.55rem', borderRadius: 8, background: '#111827', color: '#e5e7eb', border: '1px solid rgba(255,255,255,.12)' }}>
          <option value="all">{t.logsAll}</option><option value="success">{t.logsSuccess}</option><option value="error">{t.logsError}</option>
        </select>
        <input value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} placeholder={t.logsProviderFilter} style={{ padding: '0.55rem', borderRadius: 8, background: '#111827', color: '#e5e7eb', border: '1px solid rgba(255,255,255,.12)' }} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead><tr style={{ color: '#9ca3af', textAlign: 'left' }}><th>Trace</th><th>{t.tblProvider}</th><th>Model</th><th>Status</th><th>HTTP</th><th>Latency</th><th>{t.totalTokens}</th><th>{t.logsErrorDetail}</th></tr></thead>
          <tbody>
            {items.map((log) => (
              <tr key={log.traceId} style={{ borderTop: '1px solid rgba(255,255,255,.06)' }}>
                <td style={{ padding: '0.65rem', color: '#93c5fd', fontFamily: 'monospace' }}>{log.traceId}</td>
                <td style={{ padding: '0.65rem' }}>{log.provider || '-'}</td><td style={{ padding: '0.65rem' }}>{log.model || '-'}</td>
                <td style={{ padding: '0.65rem', color: log.status === 'success' ? '#34d399' : '#f87171' }}>{log.status}</td>
                <td style={{ padding: '0.65rem' }}>{log.httpStatus}</td><td style={{ padding: '0.65rem' }}>{log.latencyMs}ms</td><td style={{ padding: '0.65rem' }}>{log.totalTokens || 0}</td>
                <td style={{ padding: '0.65rem', color: '#d1d5db', maxWidth: 260 }}>{log.errorMessage || log.diagnostic || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 && <div className="stat-card" style={{ color: '#9ca3af' }}>{t.logsEmpty}</div>}
    </div>
  );
}
