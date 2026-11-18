// ============================================================
// AI Relay Admin — Local Relay Management Page
// ============================================================

'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

interface Device {
  id: string;
  name: string;
  platform: string;
  status: string;
  last_heartbeat: number;
}

export default function LocalRelayPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [adminKey, setAdminKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [origin, setOrigin] = useState('https://your-relay.vercel.app');

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
    <div className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Local Relay</h1>

      {!authenticated && (
        <section className="mb-8 bg-white shadow rounded p-6" aria-labelledby="local-relay-auth-heading">
          <h2 id="local-relay-auth-heading" className="text-xl font-semibold mb-4">
            Sign in to view connected devices
          </h2>
          <form onSubmit={handleAuthSubmit} method="post" action="/admin/local-relay" className="space-y-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="local-relay-admin-password" className="font-medium text-gray-800">
                Admin API Key <span aria-hidden="true">*</span>
              </label>
              <div className="flex gap-2">
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
                  className="flex-1 border border-gray-400 rounded px-3 py-2 text-base min-h-12"
                />
                <button
                  type="button"
                  aria-pressed={showKey}
                  onClick={() => setShowKey((prev) => !prev)}
                  className="px-4 py-2 border border-gray-400 rounded text-sm font-medium text-gray-700 hover:bg-gray-100 min-h-12"
                >
                  {showKey ? 'Hide key' : 'Show key'}
                </button>
              </div>
              <span id="local-relay-auth-hint" className="text-sm text-gray-600">
                Enter your configured RELAY_ADMIN_KEY or RELAY_API_KEY.
              </span>
            </div>

            <div role="status" aria-live="polite">
              {authError && (
                <p id="local-relay-auth-error" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                  Error: {authError}
                </p>
              )}
            </div>

            <button
              type="submit"
              className="bg-blue-600 text-white font-medium px-5 py-2.5 rounded hover:bg-blue-700 min-h-12"
            >
              Sign in
            </button>
          </form>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Quick Start</h2>
        <div className="bg-gray-100 p-4 rounded">
          <ol className="list-decimal list-inside space-y-2">
            <li>Install CLI: <code className="bg-gray-200 px-2 py-1 rounded">npm install -g ai-relay</code></li>
            <li>Login: <code className="bg-gray-200 px-2 py-1 rounded">airelay login {origin}</code></li>
            <li>Start: <code className="bg-gray-200 px-2 py-1 rounded">airelay local:start</code></li>
            <li>Configure Agent: <code className="bg-gray-200 px-2 py-1 rounded">airelay agent:install codex</code></li>
          </ol>
        </div>
      </section>

      {authenticated && (
        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Devices</h2>
          <div className="bg-white shadow rounded p-4">
            {devices.length === 0 ? (
              <p className="text-gray-600">No devices connected yet.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Name</th>
                    <th className="text-left py-2">Platform</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id} className="border-b">
                      <td className="py-2">{device.name}</td>
                      <td className="py-2">{device.platform}</td>
                      <td className="py-2">
                        <span className={`px-2 py-1 rounded text-xs ${device.status === 'online' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {device.status}
                        </span>
                      </td>
                      <td className="py-2 text-sm text-gray-600">
                        {device.last_heartbeat ? new Date(device.last_heartbeat).toLocaleString() : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
