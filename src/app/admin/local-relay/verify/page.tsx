'use client';

import Link from 'next/link';
import { useEffect, useState, Suspense, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

function VerifyContent() {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const [adminKey, setAdminKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('airelay_admin_key') || '';
    if (saved) {
      setAdminKey(saved);
    }
  }, []);

  const handleVerify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!code) {
      setStatus('error');
      setMessage('Invalid verification link: missing device code.');
      return;
    }

    const token = adminKey.trim();
    if (!token) {
      setStatus('error');
      setMessage('Please enter your Admin API key to authorize this device.');
      return;
    }

    setStatus('verifying');

    try {
      const res = await fetch('/api/local/devices/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ device_code: code }),
      });

      const payload = await res.json().catch(() => ({}));
      if (res.ok) {
        localStorage.setItem('airelay_admin_key', token);
        setStatus('success');
        setMessage(`Device ${payload.device_id} verified successfully!`);
      } else {
        const errMsg =
          typeof payload.error === 'string'
            ? payload.error
            : payload.error?.message || 'Verification failed';
        setStatus('error');
        setMessage(errMsg);
      }
    } catch {
      setStatus('error');
      setMessage('Network error while contacting relay server.');
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: 'radial-gradient(circle at top, #1e293b, #09090b)',
        color: '#e5e7eb',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          maxWidth: '460px',
          width: '100%',
          background: 'rgba(30, 41, 59, 0.55)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          padding: '2rem',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.45)',
        }}
      >
        <h1 id="verify-device-heading" style={{ margin: '0 0 1rem', fontSize: '1.5rem', fontWeight: 700, color: '#fff' }}>
          🔐 Verify Local Relay Device
        </h1>

        {!code && (
          <div
            role="alert"
            style={{
              background: 'rgba(239, 68, 68, 0.16)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#fca5a5',
              padding: '0.85rem 1rem',
              borderRadius: '10px',
              fontSize: '0.9rem',
            }}
          >
            Invalid verification link: missing device code.
          </div>
        )}

        {code && status !== 'success' && (
          <form
            onSubmit={handleVerify}
            method="post"
            action="/api/local/devices/verify"
            aria-labelledby="verify-device-heading"
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <p style={{ margin: 0, color: '#9ca3af', fontSize: '0.88rem', lineHeight: 1.6 }}>
              Confirm your Admin API key and authorize device code{' '}
              <code
                style={{
                  background: 'rgba(0, 0, 0, 0.45)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '0.15rem 0.45rem',
                  borderRadius: '6px',
                  color: '#93c5fd',
                  fontSize: '0.82rem',
                  wordBreak: 'break-all',
                }}
              >
                {code}
              </code>
              .
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <label htmlFor="verify-admin-password" style={{ fontSize: '0.9rem', fontWeight: 500, color: '#d1d5db' }}>
                Admin API Key <span aria-hidden="true">*</span>
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  id="verify-admin-password"
                  name="password"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="current-password"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="done"
                  required
                  aria-invalid={status === 'error' ? 'true' : undefined}
                  aria-describedby="verify-admin-hint"
                  value={adminKey}
                  onChange={(ev) => {
                    setAdminKey(ev.target.value);
                    if (status === 'error') {
                      setStatus('idle');
                      setMessage('');
                    }
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
                    padding: '0.65rem 0.9rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.14)',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#e5e7eb',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <span id="verify-admin-hint" style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                Uses your RELAY_ADMIN_KEY (or RELAY_API_KEY).
              </span>
            </div>

            <div role="status" aria-live="polite">
              {status === 'error' && message && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.16)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#fca5a5',
                    padding: '0.75rem 0.9rem',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 600 }}>Error</p>
                  <p style={{ margin: '0.25rem 0 0' }}>{message}</p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={status === 'verifying'}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: 'none',
                background: '#2563eb',
                color: '#fff',
                fontWeight: 600,
                fontSize: '0.95rem',
                cursor: status === 'verifying' ? 'wait' : 'pointer',
                opacity: status === 'verifying' ? 0.6 : 1,
              }}
            >
              {status === 'verifying' ? 'Verifying device...' : 'Authorize Device'}
            </button>
          </form>
        )}

        <div role="status" aria-live="polite">
          {status === 'success' && (
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                color: '#6ee7b7',
                padding: '1rem',
                borderRadius: '10px',
                fontSize: '0.9rem',
                lineHeight: 1.5,
              }}
            >
              <p style={{ margin: 0, fontWeight: 700 }}>✅ Device Authorized</p>
              <p style={{ margin: '0.45rem 0 0' }}>{message}</p>
              <p style={{ margin: '0.45rem 0 0', color: '#a7f3d0' }}>
                You can close this window and return to your terminal.
              </p>
              <div style={{ marginTop: '0.85rem' }}>
                <Link href="/admin/local-relay" style={{ color: '#93c5fd', fontSize: '0.85rem' }}>
                  View connected devices →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function VerifyDevicePage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af' }}>Loading...</div>}>
      <VerifyContent />
    </Suspense>
  );
}
