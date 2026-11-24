'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface RuntimeSettingsData {
  extraClientKeys?: string[];
  cronSecret?: string | null;
  upstreamTimeoutMs?: number | null;
  maxConcurrent?: number | null;
  maxQueue?: number | null;
  enableRequestLogs?: boolean | null;
  allowLocalKeySync?: boolean | null;
  defaultUserAgent?: string | null;
  deployUrl?: string | null;
  updatedAt?: string;
}

interface EnvDefaults {
  upstreamTimeoutMs: number;
  maxConcurrent: number;
  maxQueue: number;
  enableRequestLogs: boolean;
  allowLocalKeySync: boolean;
  defaultUserAgent: string;
  deployUrl: string;
  hasEnvCronSecret: boolean;
}

interface Props {
  apiKey: string;
  lang: 'zh' | 'en';
}

function generateClientKey(): string {
  const bytes = new Uint8Array(20);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sk-relay-${hex}`;
}

export default function RuntimeSettingsPanel({ apiKey, lang }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [defaults, setDefaults] = useState<EnvDefaults | null>(null);

  // Form state
  const [extraClientKeys, setExtraClientKeys] = useState<string[]>([]);
  const [newClientKey, setNewClientKey] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [upstreamTimeoutMs, setUpstreamTimeoutMs] = useState('');
  const [maxConcurrent, setMaxConcurrent] = useState('');
  const [maxQueue, setMaxQueue] = useState('');
  const [enableRequestLogs, setEnableRequestLogs] = useState<'default' | 'true' | 'false'>('default');
  const [allowLocalKeySync, setAllowLocalKeySync] = useState<'default' | 'true' | 'false'>('default');
  const [defaultUserAgent, setDefaultUserAgent] = useState('');
  const [deployUrl, setDeployUrl] = useState('');
  const [cronSecret, setCronSecret] = useState('');

  const isZh = lang === 'zh';

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/settings', {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { settings: RuntimeSettingsData; defaults: EnvDefaults };
      const s = json.settings || {};
      setDefaults(json.defaults || null);
      setExtraClientKeys(Array.isArray(s.extraClientKeys) ? s.extraClientKeys : []);
      setUpstreamTimeoutMs(s.upstreamTimeoutMs !== undefined && s.upstreamTimeoutMs !== null ? String(s.upstreamTimeoutMs) : '');
      setMaxConcurrent(s.maxConcurrent !== undefined && s.maxConcurrent !== null ? String(s.maxConcurrent) : '');
      setMaxQueue(s.maxQueue !== undefined && s.maxQueue !== null ? String(s.maxQueue) : '');
      setEnableRequestLogs(typeof s.enableRequestLogs === 'boolean' ? String(s.enableRequestLogs) as 'true' | 'false' : 'default');
      setAllowLocalKeySync(typeof s.allowLocalKeySync === 'boolean' ? String(s.allowLocalKeySync) as 'true' | 'false' : 'default');
      setDefaultUserAgent(s.defaultUserAgent || '');
      setDeployUrl(s.deployUrl || '');
      setCronSecret(s.cronSecret || '');
    } finally {
      setLoading(false);
    }
  }, [apiKey]);

  useEffect(() => {
    if (apiKey) {
      loadSettings();
    }
  }, [apiKey, loadSettings]);

  const handleSave = async (overrideKeys?: string[]) => {
    setSaving(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        extraClientKeys: overrideKeys ?? extraClientKeys,
        upstreamTimeoutMs: upstreamTimeoutMs.trim() === '' ? null : Number(upstreamTimeoutMs.trim()),
        maxConcurrent: maxConcurrent.trim() === '' ? null : Number(maxConcurrent.trim()),
        maxQueue: maxQueue.trim() === '' ? null : Number(maxQueue.trim()),
        enableRequestLogs: enableRequestLogs === 'default' ? null : enableRequestLogs === 'true',
        allowLocalKeySync: allowLocalKeySync === 'default' ? null : allowLocalKeySync === 'true',
        defaultUserAgent: defaultUserAgent.trim() === '' ? null : defaultUserAgent.trim(),
        deployUrl: deployUrl.trim() === '' ? null : deployUrl.trim(),
        cronSecret: cronSecret.trim() === '' ? null : cronSecret.trim(),
      };
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ type: 'err', text: json.error?.message || (isZh ? '保存失败' : 'Save failed') });
        return;
      }
      setMessage({
        type: 'ok',
        text: isZh ? '✅ 系统设置已保存并立即生效（无需重新部署）' : '✅ Settings saved and active immediately (no redeploy needed)',
      });
    } catch {
      setMessage({ type: 'err', text: isZh ? '网络错误，保存失败' : 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddClientKey = async () => {
    const candidate = newClientKey.trim() || generateClientKey();
    if (candidate.length < 8) {
      setMessage({ type: 'err', text: isZh ? '客户端密钥至少 8 位' : 'Client key must be at least 8 characters' });
      return;
    }
    const next = Array.from(new Set([...extraClientKeys, candidate]));
    setExtraClientKeys(next);
    setNewClientKey('');
    await handleSave(next);
  };

  const handleRemoveClientKey = async (keyToRemove: string) => {
    const next = extraClientKeys.filter((k) => k !== keyToRemove);
    setExtraClientKeys(next);
    await handleSave(next);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.55rem 0.75rem',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    color: '#e5e7eb',
    fontSize: '0.88rem',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8rem',
    color: '#cbd5e1',
    fontWeight: 600,
    marginBottom: '0.35rem',
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#fff' }}>
          {isZh ? '⚙️ 系统运行设置（即时生效，免改环境变量）' : '⚙️ Runtime Settings (Instant Apply, No Env Vars)'}
        </h2>
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.84rem', color: '#94a3b8' }}>
          {isZh
            ? '所有配置持久化在后台存储中，修改后立即生效，无需去 Vercel / Cloudflare / GitHub 改环境变量或重新部署。留空则回退到平台默认值。'
            : 'Persisted in your storage backend and applied immediately without editing Vercel/Cloudflare/GitHub env vars or redeploying. Leave blank to use platform defaults.'}
        </p>
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{isZh ? '加载配置中...' : 'Loading settings...'}</div>
      ) : (
        <>
          {/* Managed Extra Client API Keys */}
          <div style={{
            padding: '1rem',
            borderRadius: '10px',
            backgroundColor: 'rgba(255, 255, 255, 0.025)',
            border: '1px solid rgba(255, 255, 255, 0.07)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#e2e8f0' }}>
              {isZh ? '🔑 额外客户端调用密钥（/v1/* 多端分发）' : '🔑 Additional Client API Keys (/v1/*)'}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={newClientKey}
                onChange={(e) => setNewClientKey(e.target.value)}
                placeholder={isZh ? '留空点击添加将自动生成随机 sk-relay-... 密钥' : 'Leave blank to auto-generate sk-relay-... key'}
                style={{ ...inputStyle, flex: 1, minWidth: '220px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
              <button
                type="button"
                disabled={saving}
                onClick={handleAddClientKey}
                style={{
                  padding: '0.55rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {isZh ? '+ 生成 / 添加密钥' : '+ Generate / Add Key'}
              </button>
            </div>
            {extraClientKeys.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {extraClientKeys.map((k) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      padding: '0.45rem 0.65rem',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(0, 0, 0, 0.25)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    <code style={{ fontSize: '0.8rem', color: '#cbd5e1', wordBreak: 'break-all' }}>{k}</code>
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(k).catch(() => {});
                          setCopiedKey(k);
                          setTimeout(() => setCopiedKey(null), 2000);
                        }}
                        style={{
                          padding: '0.25rem 0.55rem', borderRadius: '6px', border: '1px solid rgba(59,130,246,0.35)',
                          backgroundColor: 'rgba(59,130,246,0.12)', color: '#93c5fd', fontSize: '0.76rem', cursor: 'pointer',
                        }}
                      >
                        {copiedKey === k ? '✓' : (isZh ? '复制' : 'Copy')}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleRemoveClientKey(k)}
                        style={{
                          padding: '0.25rem 0.55rem', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.35)',
                          backgroundColor: 'rgba(239,68,68,0.12)', color: '#fca5a5', fontSize: '0.76rem', cursor: 'pointer',
                        }}
                      >
                        {isZh ? '吊销' : 'Revoke'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Core Operational Settings Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '0.9rem',
          }}>
            <div>
              <label style={labelStyle}>
                {isZh ? '上游超时 (ms，0=不限)' : 'Upstream Timeout (ms, 0=off)'}
              </label>
              <input
                type="number"
                value={upstreamTimeoutMs}
                onChange={(e) => setUpstreamTimeoutMs(e.target.value)}
                placeholder={defaults ? `${isZh ? '默认' : 'Default'}: ${defaults.upstreamTimeoutMs}` : '50000'}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>
                {isZh ? '最大并发请求数' : 'Max Concurrent Requests'}
              </label>
              <input
                type="number"
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(e.target.value)}
                placeholder={defaults ? `${isZh ? '默认' : 'Default'}: ${defaults.maxConcurrent}` : '3'}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>
                {isZh ? '请求排队上限' : 'Max Concurrency Queue'}
              </label>
              <input
                type="number"
                value={maxQueue}
                onChange={(e) => setMaxQueue(e.target.value)}
                placeholder={defaults ? `${isZh ? '默认' : 'Default'}: ${defaults.maxQueue}` : '10'}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>
                {isZh ? '请求日志持久化' : 'Persist Request Logs'}
              </label>
              <select
                className="custom-select"
                value={enableRequestLogs}
                onChange={(e) => setEnableRequestLogs(e.target.value as 'default' | 'true' | 'false')}
                style={inputStyle}
              >
                <option value="default">
                  {isZh
                    ? `跟随默认 (${defaults?.enableRequestLogs ? '开启' : '关闭'})`
                    : `Default (${defaults?.enableRequestLogs ? 'On' : 'Off'})`}
                </option>
                <option value="true">{isZh ? '开启持久化日志' : 'Enabled'}</option>
                <option value="false">{isZh ? '关闭（节省写入额度）' : 'Disabled (saves writes)'}</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>
                {isZh ? '允许本机 CLI 同步上游 Key' : 'Allow Local CLI Key Sync'}
              </label>
              <select
                className="custom-select"
                value={allowLocalKeySync}
                onChange={(e) => setAllowLocalKeySync(e.target.value as 'default' | 'true' | 'false')}
                style={inputStyle}
              >
                <option value="default">
                  {isZh
                    ? `跟随默认 (${defaults?.allowLocalKeySync !== false ? '允许' : '禁止'})`
                    : `Default (${defaults?.allowLocalKeySync !== false ? 'Allowed' : 'Blocked'})`}
                </option>
                <option value="true">{isZh ? '允许同步' : 'Allowed'}</option>
                <option value="false">{isZh ? '禁止同步上游 Key' : 'Blocked'}</option>
              </select>
            </div>

            <div>
              <label style={labelStyle}>
                {isZh ? 'Cron 定时任务密钥 (可选)' : 'Cron Secret (optional)'}
              </label>
              <input
                type="text"
                value={cronSecret}
                onChange={(e) => setCronSecret(e.target.value)}
                placeholder={defaults?.hasEnvCronSecret ? (isZh ? '已由环境变量配置' : 'Configured via env') : (isZh ? '留空仅允许 Admin Key 触发' : 'Blank = Admin Key only')}
                style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              />
            </div>

            <div>
              <label style={labelStyle}>
                {isZh ? '公网访问地址 (DEPLOY_URL)' : 'Public Base URL (DEPLOY_URL)'}
              </label>
              <input
                type="text"
                value={deployUrl}
                onChange={(e) => setDeployUrl(e.target.value)}
                placeholder={defaults?.deployUrl || 'https://your-relay.example.com'}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>
                {isZh ? '默认上游 User-Agent' : 'Default Upstream User-Agent'}
              </label>
              <input
                type="text"
                value={defaultUserAgent}
                onChange={(e) => setDefaultUserAgent(e.target.value)}
                placeholder={defaults?.defaultUserAgent || (isZh ? '留空使用内置中性 SDK UA' : 'Blank = built-in SDK UA')}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave()}
              style={{
                padding: '0.65rem 1.35rem',
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                color: '#fff',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.65 : 1,
              }}
            >
              {saving ? (isZh ? '保存中...' : 'Saving...') : (isZh ? '💾 保存系统设置' : '💾 Save Runtime Settings')}
            </button>

            {message && (
              <span style={{ fontSize: '0.85rem', color: message.type === 'ok' ? '#6ee7b7' : '#f87171' }}>
                {message.text}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
