import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ──────────────────────────────────────────────────
interface RequestLogEntry {
  traceId: string; timestamp: string; provider?: string; model?: string; status: 'success' | 'error';
  httpStatus: number; latencyMs: number; totalTokens?: number; errorType?: string; errorMessage?: string; diagnostic?: string;
}
interface Props { t: any; }

// ── localStorage helpers ───────────────────────────────────
const STORAGE_KEY = 'airelay_request_logs';
const MAX_ENTRIES_KEY = 'airelay_logs_max_entries';
const DEFAULT_MAX = 50;
const ABSOLUTE_CAP = 500;

function getMaxEntries(): number {
  try {
    const raw = localStorage.getItem(MAX_ENTRIES_KEY);
    if (!raw) return DEFAULT_MAX;
    const n = parseInt(raw, 10);
    return isNaN(n) || n < 1 ? DEFAULT_MAX : Math.min(n, ABSOLUTE_CAP);
  } catch {
    return DEFAULT_MAX;
  }
}

function loadLogs(): RequestLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLogs(logs: RequestLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch { /* quota exceeded — silent */ }
}

/**
 * Merge incoming logs into stored logs, dedup by traceId, cap at maxEntries.
 * New logs go to the front (newest first).
 */
function mergeLogs(stored: RequestLogEntry[], incoming: RequestLogEntry[], maxEntries: number): RequestLogEntry[] {
  const seen = new Set<string>();
  const merged: RequestLogEntry[] = [];
  // Incoming first (fresher from server)
  for (const log of incoming) {
    if (log.traceId && !seen.has(log.traceId)) {
      seen.add(log.traceId);
      merged.push(log);
    }
  }
  // Then stored (older local history)
  for (const log of stored) {
    if (log.traceId && !seen.has(log.traceId)) {
      seen.add(log.traceId);
      merged.push(log);
    }
  }
  // Sort newest first and cap
  merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (merged.length > maxEntries) merged.length = maxEntries;
  return merged;
}

// ── Component ──────────────────────────────────────────────
export default function RequestLogsTab({ t }: Props) {
  const [items, setItems] = useState<RequestLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('');
  const [maxEntries, setMaxEntries] = useState(getMaxEntries());
  const [editingMax, setEditingMax] = useState(false);
  const [maxInput, setMaxInput] = useState(String(maxEntries));
  const mountedRef = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    setItems(loadLogs());
  }, []);

  // Fetch from API, merge into localStorage
  const fetchAndMerge = useCallback(async () => {
    setLoading(true);
    try {
      const cached = localStorage.getItem('airelay_admin_key');
      if (!cached) return;
      const params = new URLSearchParams({ status: 'all', limit: String(getMaxEntries()) });
      const res = await fetch(`/api/admin/request-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${cached}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = await res.json();
      const incoming: RequestLogEntry[] = json.items || [];
      const max = getMaxEntries();
      const merged = mergeLogs(loadLogs(), incoming, max);
      saveLogs(merged);
      setItems(merged);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  // Fetch on first mount & tab switch
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      fetchAndMerge();
    }
  }, [fetchAndMerge]);

  // Apply filters
  const filtered = items
    .filter((item) => statusFilter === 'all' || item.status === statusFilter)
    .filter((item) => !providerFilter.trim() || item.provider === providerFilter.trim());

  // Save max entries config
  const handleSaveMax = () => {
    const n = parseInt(maxInput, 10);
    if (!isNaN(n) && n >= 1) {
      const clamped = Math.min(n, ABSOLUTE_CAP);
      setMaxEntries(clamped);
      localStorage.setItem(MAX_ENTRIES_KEY, String(clamped));
      // Trim stored logs to new max
      const current = loadLogs();
      if (current.length > clamped) {
        current.length = clamped;
        saveLogs(current);
        setItems(current);
      }
    }
    setEditingMax(false);
  };

  // Clear all logs
  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setItems([]);
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff' }}>{t.requestLogsTitle}</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#9ca3af' }}>{t.requestLogsDesc}</p>
          <p style={{ margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.78rem' }}>
            {t.logsStoredLocally || 'Local copy in this browser; server memory is current-instance only. Max'}: {maxEntries} {t.logsEntries || 'entries'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="tab-btn active" onClick={fetchAndMerge} disabled={loading}>
            {loading ? t.refreshing : t.refresh}
          </button>
          <button className="tab-btn" onClick={handleClear} style={{ color: '#f87171' }}>
            {t.logsClear || 'Clear'}
          </button>
          {!editingMax ? (
            <button className="tab-btn" onClick={() => { setMaxInput(String(maxEntries)); setEditingMax(true); }}>
              ⚙️ {maxEntries}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <input
                type="number"
                value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveMax()}
                min={1}
                max={ABSOLUTE_CAP}
                style={{ width: 60, padding: '0.4rem 0.5rem', borderRadius: 6, background: '#111827', color: '#e5e7eb', border: '1px solid rgba(255,255,255,.12)', fontSize: '0.85rem' }}
              />
              <button className="tab-btn" onClick={handleSaveMax} style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}>✓</button>
              <button className="tab-btn" onClick={() => setEditingMax(false)} style={{ padding: '0.35rem 0.6rem', fontSize: '0.8rem' }}>✕</button>
            </div>
          )}
        </div>
      </div>
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
            {filtered.map((log) => (
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
      {filtered.length === 0 && <div className="stat-card" style={{ color: '#9ca3af' }}>{t.logsEmpty}</div>}
    </div>
  );
}
