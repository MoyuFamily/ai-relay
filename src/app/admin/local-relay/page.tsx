// ============================================================
// AI Relay Admin — Local Relay Management Page
// ============================================================

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Device {
  id: string;
  name: string;
  platform: string;
  status: string;
  last_heartbeat: number;
}

const panelStyle: React.CSSProperties = {
  background: 'rgba(30, 41, 59, 0.5)',
  border: '1px solid rgba(255, 255, 255, 0.09)',
  borderRadius: '14px',
  padding: '1.5rem',
  marginBottom: '1.5rem',
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.35)',
};

const codePillStyle: React.CSSProperties = {
  background: 'rgba(0, 0, 0, 0.45)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '6px',
  padding: '0.2rem 0.5rem',
  color: '#93c5fd',
  fontSize: '0.85rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

export default function LocalRelayPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [adminKey, setAdminKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [origin, setOrigin] = useState('https://your-relay.example.com');

  useEffect(() => {
    setOrigin(window.location.origin);
    const saved = localStorage.getItem('airelay_admin_key') || '';
    if (saved) {
      setAdminKey(saved);
      setKeyInput(saved);
    }
  }, []);

  const fetchDevices = useCallback(async (tokenToUse: string) => {
    if (!tokenToUse) return;
    try {
      const res = await fetch('/api/local/devices', {
        headers: { Authorization: `Bearer ${tokenToUse}` },
        cache: 'no-store',
      });
      if (res.status === 503) {
        setAuthenticated(false);
        setAuthError('Server auth is not configured. Set RELAY_API_KEY or RELAY_ADMIN_KEY first.');
        return;
      }
      if (res.status === 401) {
        setAuthenticated(false);
        setAuthError('Invalid admin token. Please sign in with your RELAY_ADMIN_KEY or RELAY_API_KEY.');
        return;
      }
      const data = await res.json();
      setDevices(data.devices || []);
      setAuthenticated(true);
      setAuthError('');
      localStorage.setItem('airelay_admin_key', tokenToUse);
    } catch (err) {
      console.error('Failed to fetch devices:', err);
    }
  }, []);

  useEffect(() => {
    if (!adminKey) return;
    fetchDevices(adminKey);
    const interval = setInterval(() => fetchDevices(adminKey), 10000);
    return () => clearInterval(interval);
  }, [adminKey, fetchDevices]);

  const handleAuthSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setAuthError('Admin token is required.');
      return;
    }
    setAdminKey(trimmed);
    fetchDevices(trimmed);
  };

  return (
    <main style={{ maxWidth: '880px', margin: '0 auto', padding: '2rem 1.25rem', color: '#e5e7eb' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: '#fff' }}>💻 Local Relay</h1>
          <p style={{ margin: '0.3rem 0 0', color: '#9ca3af', fontSize: '0.9rem' }}>
            Run AI Relay locally for Codex, Claude Code, and local scripts with automatic config sync.
          </p>
        </div>
        <Link
          href="/admin"
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#d1d5db',
            textDecoration: 'none',
            fontSize: '0.85rem',
          }}
        >
          ← Back to Admin
        </Link>
      </div>

      {!authenticated && (
        <section style={panelStyle} aria-labelledby="local-relay-auth-heading">
          <h2 id="local-relay-auth-heading" style={{ margin: '0 0 1rem', fontSize: '1.15rem', color: '#fff' }}>
            Sign in to view connected devices
          </h2>
          <form onSubmit={handleAuthSubmit} method="post" action="/admin/local-relay" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label htmlFor="local-relay-admin-password" style={{ fontSize: '0.9rem', fontWeight: 500, color: '#d1d5db' }}>
                Admin API Key <span aria-hidden="true">*</span>
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="local-relay-admin-password"
                  name="password"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="done"
                  required
                  aria-invalid={authError ? 'true' : undefined}
                  aria-describedby={authError ? 'local-relay-auth-error' : 'local-relay-auth-hint'}
                  value={keyInput}
                  onChange={(ev) => {
                    setKeyInput(ev.target.value);
                    if (authError) setAuthError('');
                  }}
                  style={{
                    flex: 1,
                    padding: '0.65rem 0.9rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.14)',
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: '#f9fafb',
                    fontSize: '0.95rem',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  aria-pressed={showKey}
                  onClick={() => setShowKey((prev) => !prev)}
                  style={{
                    padding: '0.65rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.14)',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#e5e7eb',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  {showKey ? 'Hide key' : 'Show key'}
                </button>
              </div>
              <span id="local-relay-auth-hint" style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                Enter your configured RELAY_ADMIN_KEY or RELAY_API_KEY.
              </span>
            </div>

            <div role="status" aria-live="polite">
              {authError && (
                <p
                  id="local-relay-auth-error"
                  style={{
                    margin: 0,
                    padding: '0.65rem 0.9rem',
                    borderRadius: '8px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#fca5a5',
                    fontSize: '0.85rem',
                  }}
                >
                  Error: {authError}
                </p>
              )}
            </div>

            <button
              type="submit"
              style={{
                alignSelf: 'flex-start',
                padding: '0.65rem 1.4rem',
                borderRadius: '8px',
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.95rem',
                cursor: 'pointer',
              }}
            >
              Sign in
            </button>
          </form>
        </section>
      )}

      <section style={panelStyle}>
        <h2 style={{ margin: '0 0 0.85rem', fontSize: '1.15rem', color: '#fff' }}>Quick Start</h2>
        <ol style={{ margin: 0, paddingLeft: '1.35rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', lineHeight: 1.6 }}>
          <li>
            Clone &amp; link CLI:{' '}
            <code style={codePillStyle}>git clone https://github.com/MoyuFamily/ai-relay.git &amp;&amp; cd ai-relay &amp;&amp; pnpm install &amp;&amp; pnpm link --global</code>
          </li>
          <li>
            Bind this machine to Admin:{' '}
            <code style={codePillStyle}>airelay login {origin}</code>
          </li>
          <li>
            Start local relay:{' '}
            <code style={codePillStyle}>airelay local:start</code>
          </li>
          <li>
            Connect coding agents:{' '}
            <code style={codePillStyle}>airelay agent:install codex</code>{' '}or{' '}
            <code style={codePillStyle}>airelay agent:install claude-code</code>
          </li>
        </ol>
      </section>

      {authenticated && (
        <section style={panelStyle}>
          <h2 style={{ margin: '0 0 0.85rem', fontSize: '1.15rem', color: '#fff' }}>Connected Devices</h2>
          {devices.length === 0 ? (
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.9rem' }}>No devices connected yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#9ca3af' }}>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.5rem' }}>Name</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.5rem' }}>Platform</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.5rem' }}>Status</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.5rem' }}>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                      <td style={{ padding: '0.65rem 0.5rem', color: '#f3f4f6', fontWeight: 500 }}>{device.name}</td>
                      <td style={{ padding: '0.65rem 0.5rem', color: '#d1d5db' }}>{device.platform}</td>
                      <td style={{ padding: '0.65rem 0.5rem' }}>
                        <span
                          style={{
                            padding: '0.2rem 0.55rem',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: device.status === 'online' ? 'rgba(16, 185, 129, 0.18)' : 'rgba(156, 163, 175, 0.18)',
                            color: device.status === 'online' ? '#34d399' : '#9ca3af',
                          }}
                        >
                          {device.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.65rem 0.5rem', color: '#9ca3af', fontSize: '0.82rem' }}>
                        {device.last_heartbeat ? new Date(device.last_heartbeat).toLocaleString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
