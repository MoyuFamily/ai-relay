import { useEffect, useMemo, useState } from 'react';
import type { ProviderInfo } from '../types';

interface SetupData {
  checks: { adminKey: boolean; relayKey: boolean; kv: boolean; providerKeys: boolean };
  providers: Array<{
    id: string;
    name: string;
    configured: boolean;
    keyCount: number;
    availableKeys: number;
    envKeyField?: string;
    models?: ProviderInfo['models'];
  }>;
  timestamp: string;
  isCloudflare?: boolean;
  runtime?: 'vercel' | 'cloudflare' | 'server' | 'local';
  storageBackend?: 'cloudflare-kv-d1' | 'vercel-kv' | 'postgres' | 'file' | 'memory' | 'none';
}

interface Props {
  t: any;
  lang?: 'zh' | 'en';
  apiKey?: string;
  setupData: SetupData | null;
  loading: boolean;
  onRunChecks: () => void;
  onOpenKeys: (providerId?: string) => void;
}

interface CheckGuide {
  title: string;
  steps: string[];
  envKeys?: string[];
  actionLabel?: string;
  onAction?: () => void;
}

type ClientSnippetTab = 'openai' | 'claude' | 'codex' | 'cursor' | 'curl' | 'cli';

function CheckRow({ label, ok, hint, guide, t }: { label: string; ok: boolean; hint: string; guide?: CheckGuide; t: any }) {
  return (
    <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <div style={{ color: '#fff', fontWeight: 700 }}>{label}</div>
          <div style={{ color: '#9ca3af', fontSize: '0.82rem', marginTop: '0.25rem', lineHeight: 1.5 }}>{hint}</div>
        </div>
        <span style={{ color: ok ? '#34d399' : '#f87171', fontWeight: 800, whiteSpace: 'nowrap' }}>{ok ? t.setupPassed : t.setupFailed}</span>
      </div>
      {!ok && guide && (
        <div style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
          paddingTop: '0.75rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.65rem',
        }}>
          <div style={{ color: '#fbbf24', fontSize: '0.82rem', fontWeight: 700 }}>{guide.title}</div>
          {guide.envKeys && guide.envKeys.length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {guide.envKeys.map((envKey) => (
                <code
                  key={envKey}
                  style={{
                    color: '#bfdbfe',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.22)',
                    borderRadius: '6px',
                    padding: '0.18rem 0.42rem',
                    fontSize: '0.78rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {envKey}
                </code>
              ))}
            </div>
          )}
          <ol style={{ margin: 0, paddingLeft: '1.1rem', color: '#d1d5db', fontSize: '0.82rem', lineHeight: 1.6 }}>
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {guide.actionLabel && guide.onAction && (
            <button
              className="tab-btn"
              onClick={guide.onAction}
              style={{ alignSelf: 'flex-start', padding: '0.45rem 0.75rem', fontSize: '0.8rem' }}
            >
              {guide.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SetupTab({ t, lang = 'zh', apiKey = '', setupData, loading, onRunChecks, onOpenKeys }: Props) {
  const [origin, setOrigin] = useState('https://your-relay.example.com');
  const [snippetTab, setSnippetTab] = useState<ClientSnippetTab>('openai');
  const [copied, setCopied] = useState(false);

  // Quick 10-second live test playground state
  const [testProviderId, setTestProviderId] = useState('');
  const [testModelId, setTestModelId] = useState('');
  const [testPrompt, setTestPrompt] = useState(lang === 'zh' ? '用一句话打个招呼，并告诉我你是哪个模型。' : 'Say hello in one short sentence.');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    model?: string;
    latencyMs?: number;
    reply?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  const checks = setupData?.checks;
  const providers = useMemo(() => setupData?.providers || [], [setupData?.providers]);
  const readyProviders = useMemo(
    () => providers.filter((p) => p.configured || p.keyCount > 0),
    [providers]
  );
  const sortedProviders = useMemo(
    () => [...providers].sort((a, b) => Number(b.configured || b.keyCount > 0) - Number(a.configured || a.keyCount > 0)),
    [providers]
  );
  const firstUnconfiguredProvider = providers.find((p) => !p.configured && p.keyCount === 0);
  const providerEnvKeys = providers
    .map((p) => p.envKeyField)
    .filter((envKey): envKey is string => Boolean(envKey))
    .slice(0, 5);

  // Keep selected test provider/model synced with configured providers
  useEffect(() => {
    if (readyProviders.length === 0) return;
    const current = readyProviders.find((p) => p.id === testProviderId) || readyProviders[0];
    if (current.id !== testProviderId) {
      setTestProviderId(current.id);
      setTestModelId(current.models?.[0]?.id || '');
    } else if (!testModelId && current.models?.[0]?.id) {
      setTestModelId(current.models[0].id);
    }
  }, [readyProviders, testProviderId, testModelId]);

  const selectedTestProvider = readyProviders.find((p) => p.id === testProviderId) || readyProviders[0];
  const sampleModel = selectedTestProvider?.models?.[0]?.id || 'gpt-6-luna';

  const isZh = lang === 'zh';
  const isCf = setupData?.isCloudflare || setupData?.runtime === 'cloudflare';
  const isSelfHosted =
    setupData?.runtime === 'server' ||
    setupData?.storageBackend === 'file' ||
    setupData?.storageBackend === 'postgres';
  const storageBackend = setupData?.storageBackend;

  const storageInfo = (() => {
    if (isCf) {
      return {
        label: t.setupKvLabelCf || 'Cloudflare KV',
        readyHint: t.setupKvReadyCf || t.setupKvReady,
        fallbackHint: t.setupKvFallbackCf || t.setupKvFallback,
        guide: {
          title: t.setupKvFixTitleCf || t.setupKvFixTitle,
          envKeys: ['KV', 'DB'],
          steps: [
            t.setupKvStep1Cf || t.setupKvStep1,
            t.setupKvStep2Cf || t.setupKvStep2,
            t.setupKvStep3Cf || t.setupKvStep3,
          ],
        },
      };
    }
    if (storageBackend === 'postgres') {
      return {
        label: isZh ? 'PostgreSQL 持久化存储' : 'PostgreSQL Storage',
        readyHint: isZh
          ? 'PostgreSQL 已就绪，配置、密钥与统计数据支持多实例持久化共享。'
          : 'PostgreSQL is active; configs, keys, and usage persist across replicas.',
        fallbackHint: isZh ? 'PostgreSQL 连接不可用，请检查 DATABASE_URL。' : 'PostgreSQL is unavailable; check DATABASE_URL.',
        guide: {
          title: isZh ? '检查 PostgreSQL 连接配置' : 'Verify PostgreSQL connection',
          envKeys: ['DATABASE_URL'],
          steps: isZh
            ? [
                '在 .env 或容器环境变量中设置有效的 DATABASE_URL=postgresql://...。',
                '确认数据库容器/实例已启动且网络可达，服务启动时会自动建表。',
                '重启服务后点击“运行检查”。',
              ]
            : [
                'Set a valid DATABASE_URL=postgresql://... in .env or container env.',
                'Ensure the PostgreSQL server is reachable; tables are auto-created on boot.',
                'Restart the service and click Run Checks again.',
              ],
        },
      };
    }
    if (storageBackend === 'file' || isSelfHosted) {
      return {
        label: isZh ? '本地磁盘持久化 (File KV)' : 'Persistent Disk (File KV)',
        readyHint: isZh
          ? '单机持久化存储已就绪（kv-store.json），重启容器不会丢失后台配置与统计。'
          : 'Persistent disk storage (kv-store.json) is active; configs and stats survive restarts.',
        fallbackHint: isZh
          ? '持久化存储未就绪，请检查 RELAY_DATA_DIR 目录权限或配置 DATABASE_URL。'
          : 'Persistent storage is unavailable; check RELAY_DATA_DIR permissions or set DATABASE_URL.',
        guide: {
          title: isZh ? '配置自部署持久化存储' : 'Configure self-hosted persistence',
          envKeys: ['RELAY_DATA_DIR', 'DATABASE_URL'],
          steps: isZh
            ? [
                '单容器部署：挂载可写卷到 /app/data（Docker Compose 默认已配置）。',
                '多实例部署：设置 DATABASE_URL=postgresql://... 自动切换至 PostgreSQL 模式。',
                '重启容器后回到这里点击“运行检查”。',
              ]
            : [
                'Single container: mount a writable volume at /app/data (configured by default in docker-compose.yml).',
                'Multi-instance HA: set DATABASE_URL=postgresql://... to enable PostgreSQL mode automatically.',
                'Restart the container and click Run Checks again.',
              ],
        },
      };
    }
    if (storageBackend === 'memory') {
      return {
        label: isZh ? '本地开发内存存储' : 'Dev In-Memory Storage',
        readyHint: isZh
          ? '当前处于本地开发模式（内存存储，进程重启后清空）；生产自部署默认使用磁盘持久化。'
          : 'Running in local dev in-memory mode (resets on restart); production self-hosted persists to disk automatically.',
        fallbackHint: t.setupKvFallback,
        guide: {
          title: t.setupKvFixTitle,
          envKeys: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RELAY_DATA_DIR'],
          steps: [t.setupKvStep1, t.setupKvStep2, t.setupKvStep3],
        },
      };
    }
    return {
      label: t.setupKvLabel,
      readyHint: t.setupKvReady,
      fallbackHint: t.setupKvFallback,
      guide: {
        title: t.setupKvFixTitle,
        envKeys: ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'],
        steps: [t.setupKvStep1, t.setupKvStep2, t.setupKvStep3],
      },
    };
  })();

  const guides = {
    adminKey: {
      title: isCf ? (t.setupAdminKeyFixTitleCf || t.setupAdminKeyFixTitle) : t.setupAdminKeyFixTitle,
      envKeys: ['RELAY_ADMIN_KEY'],
      steps: isSelfHosted
        ? (isZh
            ? ['在 .env 或 docker-compose.yml 中配置 RELAY_ADMIN_KEY（未设置时默认回退到 RELAY_API_KEY）。', '重启容器或服务，再点击“运行检查”。']
            : ['Set RELAY_ADMIN_KEY in .env or docker-compose.yml (falls back to RELAY_API_KEY if unset).', 'Restart the container/service and click Run Checks.'])
        : isCf
          ? [t.setupAdminKeyStep1Cf || t.setupAdminKeyStep1, t.setupAdminKeyStep2Cf || t.setupAdminKeyStep2, t.setupAdminKeyStep3Cf || t.setupAdminKeyStep3]
          : [t.setupAdminKeyStep1, t.setupAdminKeyStep2, t.setupAdminKeyStep3],
    },
    relayKey: {
      title: isCf ? (t.setupRelayKeyFixTitleCf || t.setupRelayKeyFixTitle) : t.setupRelayKeyFixTitle,
      envKeys: ['RELAY_API_KEY'],
      steps: isSelfHosted
        ? (isZh
            ? ['在 .env 或 docker-compose.yml 中设置 RELAY_API_KEY（支持英文逗号分隔多个密钥）。', '重启容器或服务，并使用该密钥配置你的客户端。']
            : ['Set RELAY_API_KEY in .env or docker-compose.yml (comma-separated for multiple keys).', 'Restart the service and configure your clients with this key.'])
        : isCf
          ? [t.setupRelayKeyStep1Cf || t.setupRelayKeyStep1, t.setupRelayKeyStep2Cf || t.setupRelayKeyStep2, t.setupRelayKeyStep3Cf || t.setupRelayKeyStep3]
          : [t.setupRelayKeyStep1, t.setupRelayKeyStep2, t.setupRelayKeyStep3],
    },
    kv: storageInfo.guide,
    providerKeys: {
      title: t.setupProviderKeysFixTitle,
      envKeys: providerEnvKeys,
      steps: [
        t.setupProviderKeysStep1,
        isSelfHosted
          ? (isZh ? '也可在 .env 中设置 OPENAI_KEYS / CLAUDE_KEYS / GEMINI_KEYS / DEEPSEEK_KEYS 后重启服务。' : 'Or set OPENAI_KEYS / CLAUDE_KEYS / GEMINI_KEYS / DEEPSEEK_KEYS in .env and restart.')
          : isCf
            ? (t.setupProviderKeysStep2Cf || t.setupProviderKeysStep2)
            : t.setupProviderKeysStep2,
        t.setupProviderKeysStep3,
      ],
      actionLabel: t.setupOpenKeysAction,
      onAction: () => onOpenKeys(firstUnconfiguredProvider?.id),
    },
  };

  const snippets: Record<ClientSnippetTab, { label: string; code: string }> = {
    openai: {
      label: 'OpenAI SDK',
      code: `from openai import OpenAI\n\nclient = OpenAI(\n    api_key="YOUR_RELAY_API_KEY",\n    base_url="${origin}/v1",\n)\nresp = client.chat.completions.create(\n    model="${sampleModel}",\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(resp.choices[0].message.content)`,
    },
    claude: {
      label: 'Claude Code',
      code: `export ANTHROPIC_BASE_URL="${origin}"\nexport ANTHROPIC_API_KEY="YOUR_RELAY_API_KEY"\nclaude`,
    },
    codex: {
      label: 'Codex CLI',
      code: `# ~/.codex/config.toml\n[model_providers.ai-relay]\nname = "AI Relay"\nbase_url = "${origin}/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n\n# Run:\n# OPENAI_API_KEY="YOUR_RELAY_API_KEY" codex -c model_provider=ai-relay`,
    },
    cursor: {
      label: 'Cursor / Cherry Studio',
      code: `API Base URL : ${origin}/v1\nAPI Key      : YOUR_RELAY_API_KEY\nSample Model : ${sampleModel}\n\n# In Cursor: Settings → Models → Override OpenAI Base URL\n# In Cherry Studio / ChatBox / Cline: Add OpenAI-compatible provider with the URL above`,
    },
    curl: {
      label: 'curl',
      code: `curl -X POST "${origin}/v1/chat/completions" \\\n  -H "Authorization: Bearer YOUR_RELAY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${sampleModel}","messages":[{"role":"user","content":"Hello!"}]}'`,
    },
    cli: {
      label: isZh ? '本地 CLI' : 'Local CLI',
      code: `airelay login ${origin}\nairelay local:start`,
    },
  };

  const handleCopySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippets[snippetTab].code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const handleRunLiveTest = async () => {
    if (!selectedTestProvider || !apiKey) return;
    setTestRunning(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/admin/providers/${encodeURIComponent(selectedTestProvider.id)}/keys/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: testModelId.trim() || undefined,
          prompt: testPrompt.trim() || 'Hello!',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.valid) {
        setTestResult({
          ok: true,
          model: json.model || testModelId,
          latencyMs: json.latencyMs,
          reply: json.reply || (isZh ? '连通成功（上游已返回有效响应）' : 'Connected (valid upstream response received)'),
        });
      } else {
        setTestResult({
          ok: false,
          error: json.error?.message || json.error || `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTestRunning(false);
    }
  };

  const headerDesc = isSelfHosted
    ? (isZh
        ? '60 秒完成自部署网关初始化：添加上游密钥 → 实时对话验证 → 复制客户端配置。'
        : 'Get ready in 60 seconds: add a provider key, run a live test, and copy your client snippet.')
    : isCf
      ? (t.setupDescCf || t.setupDesc)
      : t.setupDesc;

  const step1Done = Boolean(checks?.providerKeys);
  const step2Done = Boolean(testResult?.ok);

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff' }}>{t.setupTitle}</h2>
          <p style={{ margin: '0.35rem 0 0', color: '#9ca3af' }}>{headerDesc}</p>
        </div>
        <button className="tab-btn active" onClick={onRunChecks} disabled={loading}>{loading ? t.refreshing : t.setupRunChecks}</button>
      </div>

      {/* 60-Second 3-Step Onboarding Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
        <div className="stat-card" style={{ borderColor: step1Done ? 'rgba(52, 211, 153, 0.35)' : 'rgba(59, 130, 246, 0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
            <strong style={{ color: '#fff', fontSize: '0.92rem' }}>
              {step1Done ? '✅' : '1️⃣'} {isZh ? '添加上游密钥' : 'Add Provider Key'}
            </strong>
            {!step1Done && (
              <button
                type="button"
                className="tab-btn active"
                onClick={() => onOpenKeys(firstUnconfiguredProvider?.id || 'openai')}
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              >
                {isZh ? '去配置 →' : 'Configure →'}
              </button>
            )}
          </div>
          <div style={{ color: '#9ca3af', fontSize: '0.8rem', lineHeight: 1.45 }}>
            {step1Done
              ? (isZh ? `已就绪 ${readyProviders.length} 个服务商（OpenAI / Claude / Gemini / DeepSeek / OpenRouter 等）。` : `${readyProviders.length} provider(s) ready with keys.`)
              : (isZh ? '添加任意一个 OpenAI / Claude / Gemini / DeepSeek / OpenRouter Key 即可开始使用。' : 'Add any OpenAI, Claude, Gemini, DeepSeek, or OpenRouter API key to start.')}
          </div>
        </div>

        <div className="stat-card" style={{ borderColor: step2Done ? 'rgba(52, 211, 153, 0.35)' : 'rgba(255, 255, 255, 0.06)' }}>
          <strong style={{ color: '#fff', fontSize: '0.92rem', display: 'block', marginBottom: '0.35rem' }}>
            {step2Done ? '✅' : '2️⃣'} {isZh ? '实时对话试跑' : 'Run 10s Live Test'}
          </strong>
          <div style={{ color: '#9ca3af', fontSize: '0.8rem', lineHeight: 1.45 }}>
            {step2Done
              ? (isZh ? `已验证通过（${testResult?.model} · ${testResult?.latencyMs ?? '-'}ms）。` : `Verified (${testResult?.model} · ${testResult?.latencyMs ?? '-'}ms).`)
              : (isZh ? '在下方直接发一句测试消息，10 秒确认网关和上游密钥完全通畅。' : 'Send a test prompt below to confirm your relay and key work end-to-end.')}
          </div>
        </div>

        <div className="stat-card">
          <strong style={{ color: '#fff', fontSize: '0.92rem', display: 'block', marginBottom: '0.35rem' }}>
            3️⃣ {isZh ? '接入你的工具' : 'Connect Your Client'}
          </strong>
          <div style={{ color: '#9ca3af', fontSize: '0.8rem', lineHeight: 1.45 }}>
            {isZh ? '一键复制 OpenAI SDK、Claude Code、Codex、Cursor / Cherry Studio 配置。' : 'Copy snippets for OpenAI SDK, Claude Code, Codex, Cursor, or Cherry Studio.'}
          </div>
        </div>
      </div>

      {/* Inline 10-Second Live Test Playground */}
      <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}>
              ⚡ {isZh ? '实时对话验证（Live Test）' : 'Live Relay Test'}
            </h3>
            <div style={{ color: '#9ca3af', fontSize: '0.8rem', marginTop: '0.2rem' }}>
              {readyProviders.length > 0
                ? (isZh ? '选择已配置的服务商与模型，直接发一句测试对话确认连通。' : 'Pick a configured provider and send a real test message.')
                : (isZh ? '先添加任意一个服务商密钥后即可在这里直接试跑。' : 'Add at least one provider key first to run a live test.')}
            </div>
          </div>
          {readyProviders.length === 0 && (
            <button
              type="button"
              className="tab-btn active"
              onClick={() => onOpenKeys('openai')}
              style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
            >
              🔑 {isZh ? '添加第一个密钥' : 'Add First Key'}
            </button>
          )}
        </div>

        {readyProviders.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <select
                value={selectedTestProvider?.id || ''}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setTestProviderId(nextId);
                  const found = readyProviders.find((p) => p.id === nextId);
                  setTestModelId(found?.models?.[0]?.id || '');
                  setTestResult(null);
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  background: 'rgba(0, 0, 0, 0.3)',
                  color: '#e5e7eb',
                  fontSize: '0.85rem',
                }}
              >
                {readyProviders.map((p) => (
                  <option key={p.id} value={p.id} style={{ background: '#0f172a' }}>
                    {p.name} ({p.availableKeys}/{p.keyCount} keys)
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={testModelId}
                onChange={(e) => setTestModelId(e.target.value)}
                list="setup-live-test-models"
                placeholder={isZh ? '模型 ID（留空自动选默认模型）' : 'Model ID (blank = default)'}
                style={{
                  flex: '1 1 180px',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  background: 'rgba(0, 0, 0, 0.3)',
                  color: '#e5e7eb',
                  fontSize: '0.85rem',
                }}
              />
              <datalist id="setup-live-test-models">
                {(selectedTestProvider?.models || []).map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
              </datalist>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !testRunning && handleRunLiveTest()}
                placeholder={isZh ? '输入测试问题...' : 'Enter a test prompt...'}
                style={{
                  flex: '1 1 260px',
                  padding: '0.55rem 0.85rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  background: 'rgba(0, 0, 0, 0.3)',
                  color: '#f3f4f6',
                  fontSize: '0.88rem',
                }}
              />
              <button
                type="button"
                className="tab-btn active"
                onClick={handleRunLiveTest}
                disabled={testRunning || !apiKey}
                style={{ padding: '0.55rem 1rem', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
              >
                {testRunning ? (isZh ? '测试中...' : 'Testing...') : (isZh ? '⚡ 发送测试' : '⚡ Send Test')}
              </button>
            </div>

            {testResult && (
              <div
                style={{
                  padding: '0.75rem 0.9rem',
                  borderRadius: '10px',
                  background: testResult.ok ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.14)',
                  border: `1px solid ${testResult.ok ? 'rgba(52, 211, 153, 0.35)' : 'rgba(248, 113, 113, 0.35)'}`,
                  color: testResult.ok ? '#d1fae5' : '#fecaca',
                  fontSize: '0.85rem',
                  lineHeight: 1.55,
                }}
              >
                {testResult.ok ? (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem', color: '#34d399' }}>
                      ✅ {isZh ? '响应成功' : 'Success'} · <code>{testResult.model}</code>
                      {typeof testResult.latencyMs === 'number' ? ` · ${testResult.latencyMs}ms` : ''}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{testResult.reply}</div>
                  </>
                ) : (
                  <div>
                    <strong>❌ {isZh ? '测试失败：' : 'Test failed: '}</strong>
                    {testResult.error}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Quick Client Connect Card */}
      <div className="stat-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}>
              🔌 {isZh ? '快速接入客户端' : 'Quick Client Connect'}
            </h3>
            <div style={{ color: '#9ca3af', fontSize: '0.8rem', marginTop: '0.2rem' }}>
              {isZh
                ? '复制下方片段即可将 SDK、Claude Code、Codex 或 Cursor / Cherry Studio 接入当前网关。'
                : 'Copy a snippet below to point your SDK, Claude Code, Codex, or Cursor at this relay.'}
            </div>
          </div>
          <button
            type="button"
            className="tab-btn"
            onClick={handleCopySnippet}
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
          >
            {copied ? (isZh ? '✅ 已复制' : '✅ Copied') : (isZh ? '📋 复制代码' : '📋 Copy')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
          {(Object.keys(snippets) as ClientSnippetTab[]).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className={`tab-btn ${snippetTab === tabKey ? 'active' : ''}`}
              onClick={() => {
                setSnippetTab(tabKey);
                setCopied(false);
              }}
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
            >
              {snippets[tabKey].label}
            </button>
          ))}
        </div>

        <pre
          style={{
            margin: 0,
            padding: '0.85rem 1rem',
            borderRadius: '10px',
            background: 'rgba(0, 0, 0, 0.38)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: '#e2e8f0',
            fontSize: '0.8rem',
            lineHeight: 1.55,
            overflowX: 'auto',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
        >
          <code>{snippets[snippetTab].code}</code>
        </pre>
      </div>

      {/* Environment Readiness Checks */}
      {checks ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
          <CheckRow label="RELAY_ADMIN_KEY" ok={checks.adminKey} hint={t.setupAdminKeyHint} guide={guides.adminKey} t={t} />
          <CheckRow label="RELAY_API_KEY" ok={checks.relayKey} hint={t.setupRelayKeyHint} guide={guides.relayKey} t={t} />
          <CheckRow
            label={storageInfo.label}
            ok={checks.kv}
            hint={checks.kv ? storageInfo.readyHint : storageInfo.fallbackHint}
            guide={guides.kv}
            t={t}
          />
          <CheckRow label={t.setupProviderKeys} ok={checks.providerKeys} hint={t.setupProviderKeysHint} guide={guides.providerKeys} t={t} />
        </div>
      ) : (
        <div className="stat-card" style={{ color: '#9ca3af' }}>{t.setupEmpty}</div>
      )}

      <div>
        <h3 style={{ color: '#fff', margin: '0 0 0.75rem' }}>{t.setupProviderReadiness}</h3>
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {sortedProviders.map((p) => (
            <div key={p.id} className="stat-card" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
              <div>
                <strong style={{ color: '#e5e7eb' }}>{p.name}</strong>
                <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>
                  {p.id} · {p.envKeyField || t.setupNoEnvKeyField} · keys {p.availableKeys}/{p.keyCount}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ color: p.configured || p.keyCount > 0 ? '#34d399' : '#9ca3af', fontSize: '0.85rem' }}>
                  {p.configured || p.keyCount > 0 ? t.statusOk : t.statusNoKeys}
                </span>
                {!(p.configured || p.keyCount > 0) && (
                  <button
                    type="button"
                    className="tab-btn"
                    onClick={() => onOpenKeys(p.id)}
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.76rem' }}
                  >
                    + Key
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
