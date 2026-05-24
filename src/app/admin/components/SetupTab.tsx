import type { ProviderInfo } from '../types';

interface SetupData {
  checks: { adminKey: boolean; relayKey: boolean; kv: boolean; providerKeys: boolean };
  providers: Array<{ id: string; name: string; configured: boolean; keyCount: number; availableKeys: number; models?: ProviderInfo['models'] }>;
  timestamp: string;
}

interface Props {
  t: any;
  setupData: SetupData | null;
  loading: boolean;
  onRunChecks: () => void;
}

function CheckRow({ label, ok, hint, t }: { label: string; ok: boolean; hint: string; t: any }) {
  return (
    <div className="stat-card" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
      <div>
        <div style={{ color: '#fff', fontWeight: 700 }}>{label}</div>
        <div style={{ color: '#9ca3af', fontSize: '0.82rem', marginTop: '0.25rem' }}>{hint}</div>
      </div>
      <span style={{ color: ok ? '#34d399' : '#f87171', fontWeight: 800 }}>{ok ? t.setupPassed : t.setupFailed}</span>
    </div>
  );
}

export default function SetupTab({ t, setupData, loading, onRunChecks }: Props) {
  const checks = setupData?.checks;
  const providers = setupData?.providers || [];
  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff' }}>{t.setupTitle}</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#9ca3af' }}>{t.setupDesc}</p>
        </div>
        <button className="tab-btn active" onClick={onRunChecks} disabled={loading}>{loading ? t.refreshing : t.setupRunChecks}</button>
      </div>

      {checks ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <CheckRow label="RELAY_ADMIN_KEY" ok={checks.adminKey} hint={t.setupAdminKeyHint} t={t} />
          <CheckRow label="RELAY_API_KEY" ok={checks.relayKey} hint={t.setupRelayKeyHint} t={t} />
          <CheckRow label="Vercel KV" ok={checks.kv} hint={checks.kv ? t.setupKvReady : t.setupKvFallback} t={t} />
          <CheckRow label={t.setupProviderKeys} ok={checks.providerKeys} hint={t.setupProviderKeysHint} t={t} />
        </div>
      ) : (
        <div className="stat-card" style={{ color: '#9ca3af' }}>{t.setupEmpty}</div>
      )}

      <div>
        <h3 style={{ color: '#fff', margin: '0 0 0.75rem' }}>{t.setupProviderReadiness}</h3>
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {providers.map((p) => (
            <div key={p.id} className="stat-card" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
              <div>
                <strong style={{ color: '#e5e7eb' }}>{p.name}</strong>
                <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>{p.id} · keys {p.availableKeys}/{p.keyCount}</div>
              </div>
              <span style={{ color: p.configured || p.keyCount > 0 ? '#34d399' : '#f87171' }}>
                {p.configured || p.keyCount > 0 ? t.statusOk : t.statusNoKeys}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
