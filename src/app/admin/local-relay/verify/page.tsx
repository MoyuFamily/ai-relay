'use client';

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
    <div className="min-h-screen flex items-start sm:items-center justify-center bg-gray-50 p-4 pt-12">
      <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8">
        <h1 id="verify-device-heading" className="text-2xl font-bold mb-4">
          Verify Local Relay Device
        </h1>

        {!code && (
          <div role="alert" className="bg-red-100 text-red-700 p-4 rounded">
            Invalid verification link: missing device code.
          </div>
        )}

        {code && status !== 'success' && (
          <form
            onSubmit={handleVerify}
            method="post"
            action="/api/local/devices/verify"
            aria-labelledby="verify-device-heading"
            className="space-y-4"
          >
            <p className="text-gray-600 text-sm">
              Confirm your Admin API key and authorize device code <code className="bg-gray-100 px-1.5 py-0.5 rounded">{code}</code>.
            </p>

            <div className="flex flex-col gap-1">
              <label htmlFor="verify-admin-password" className="font-medium text-gray-800">
                Admin API Key <span aria-hidden="true">*</span>
              </label>
              <div className="flex gap-2">
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
                  className="flex-1 border border-gray-400 rounded px-3 py-2 text-base min-h-12"
                />
                <button
                  type="button"
                  aria-pressed={showKey}
                  onClick={() => setShowKey((prev) => !prev)}
                  className="px-3 py-2 border border-gray-400 rounded text-sm font-medium text-gray-700 hover:bg-gray-100 min-h-12"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <span id="verify-admin-hint" className="text-xs text-gray-600">
                Uses your RELAY_ADMIN_KEY (or RELAY_API_KEY).
              </span>
            </div>

            <div role="status" aria-live="polite">
              {status === 'error' && message && (
                <div className="bg-red-100 text-red-700 p-3 rounded text-sm">
                  <p className="font-semibold">Error</p>
                  <p className="mt-1">{message}</p>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={status === 'verifying'}
              className="w-full bg-blue-600 text-white font-medium py-2.5 px-4 rounded hover:bg-blue-700 disabled:opacity-60 min-h-12"
            >
              {status === 'verifying' ? 'Verifying device...' : 'Authorize Device'}
            </button>
          </form>
        )}

        <div role="status" aria-live="polite">
          {status === 'success' && (
            <div className="bg-green-100 text-green-800 p-4 rounded">
              <p className="font-semibold">Device Authorized</p>
              <p className="text-sm mt-2">{message}</p>
              <p className="text-sm mt-2">You can close this window and return to your terminal.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyDevicePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <VerifyContent />
    </Suspense>
  );
}
