'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './homepage.module.css';

type Language = 'zh' | 'en';

export interface HomepageModel {
  id: string;
  displayName: string;
  contextWindow: number;
  supportsStream?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

export interface HomepageProvider {
  id: string;
  name: string;
  prefixes: string[];
  models: HomepageModel[];
}

const deployUrl = 'https://vercel.com/new/clone?repository-url=https://github.com/MoyuFamily/ai-relay&env=RELAY_API_KEY,RELAY_ADMIN_KEY,RELAY_SIGNING_SECRET&envDescription=API%20authentication%20keys%20(required%20for%20security)&envLink=https://github.com/MoyuFamily/ai-relay#environment-variables';
const githubUrl = 'https://github.com/MoyuFamily/ai-relay';

const copyText = {
  zh: { copy: '复制', copied: '已复制' },
  en: { copy: 'Copy', copied: 'Copied' },
};

const content = {
  zh: {
    nav: {
      features: '特性',
      quickstart: '快速开始',
      api: 'API',
      models: '模型',
      architecture: '架构',
      admin: '管理后台',
    },
    hero: {
      badge: 'Serverless · One-click Vercel deploy · OpenAI 兼容',
      title: 'AI Relay',
      subtitle: '无服务器 AI API 中转网关，一键部署到 Vercel',
      description: '不用买服务器、不用维护 Docker，点击 Deploy with Vercel，填写 3 个环境变量，2 分钟拥有自己的多 Provider AI Relay。现有 OpenAI SDK 只改 base_url，即可获得 Key 轮换、Fallback、用量统计和 Admin 后台。',
      quickstart: '2 分钟部署',
      github: 'GitHub',
      deploy: '一键部署到 Vercel',
    },
    stats: [
      { value: '0', label: '服务器运维' },
      { value: '1-click', label: 'Vercel 部署' },
      { value: '2 min', label: '上线可用' },
    ],
    sections: {
      featuresEyebrow: 'FEATURES',
      featuresTitle: '中转服务该有的稳定性，一次配齐',
      featuresDescription: '从请求入口到 Provider、Key Pool、Fallback 和告警，AI Relay 负责把不稳定的上游变成稳定的统一接口。',
      quickstartEyebrow: 'QUICK START',
      quickstartTitle: '四步部署并开始调用',
      quickstartDescription: '沿用 README 的最短路径：先部署，再验证健康状态，进入 Admin 添加 Provider Key，最后直接调用 OpenAI 兼容接口。',
      apiEyebrow: 'API',
      apiTitle: '精简但完整的 OpenAI 兼容端点',
      modelsEyebrow: 'MODELS',
      modelsTitle: '当前实例支持的模型',
      modelsDescription: '模型列表来自服务端 Provider 注册表和自定义 Provider 配置，部署后会随配置动态变化。',
      architectureEyebrow: 'ARCHITECTURE',
      architectureTitle: '透明代理，链式故障转移',
    },
    featureToggle: {
      show: '展开更多能力',
      hide: '收起扩展能力',
    },
    featureCards: [
      { icon: '↻', title: '多 Key 轮换', description: 'Round-Robin 分发请求，遇到 429 自动退避，降低单 Key 限流风险。', tier: 'p0' },
      { icon: '⇄', title: '多 Provider 路由', description: '支持 OpenAI、Claude、DeepSeek、MiMo 与自定义 Provider，按模型前缀自动路由。', tier: 'p0' },
      { icon: '↪', title: '多级 Fallback', description: 'Provider 到 Key Pool 的链式故障转移，让上游异常不直接暴露给客户端。', tier: 'p0' },
      { icon: '▣', title: '100% OpenAI 兼容', description: '保留 /v1/chat/completions 与 /v1/models 习惯，现有 SDK 几乎零改动接入。', tier: 'p0' },
      { icon: '▤', title: 'Admin 后台', description: '集中管理密钥、配额、用量统计、模型测试和 Provider 配置。', tier: 'p0' },
      { icon: '⚡', title: '一键部署', description: '面向 Vercel Edge Runtime 设计，免费层也能快速跑起个人或团队中转站。', tier: 'p0' },
      { icon: '≋', title: '流式响应', description: 'SSE 透明透传，兼容实时输出、长文本生成和 Agent 工具调用。', tier: 'p1' },
      { icon: '◈', title: 'Webhook 通知', description: '支持企微、飞书、钉钉、Slack，推送日报、异常和额度告警。', tier: 'p1' },
      { icon: '◇', title: '临时 API Key', description: 'HMAC 签名的无状态临时密钥，可设置过期时间和调用配额。', tier: 'p1' },
      { icon: '⧉', title: '虚拟模型映射', description: '把内部模型别名映射到真实 Provider 模型，调用侧无需理解上游差异。', tier: 'p1' },
      { icon: '!', title: '错误追踪与熔断', description: '按 Provider 和 Key 统计错误，自动隔离异常上游，提升整体可用性。', tier: 'p1' },
    ],
    quickstartSteps: [
      {
        title: '部署',
        description: '用 Vercel 克隆仓库，填入 RELAY_API_KEY、RELAY_ADMIN_KEY、RELAY_SIGNING_SECRET。',
        label: 'Vercel',
        code: 'RELAY_API_KEY=your-strong-client-key\nRELAY_ADMIN_KEY=your-admin-key\nRELAY_SIGNING_SECRET=your-signing-secret',
      },
      {
        title: '验证',
        description: '部署完成后检查公开健康端点，确认 Edge Function 已经正常响应。',
        label: 'bash',
        code: 'curl https://你的项目.vercel.app/health\n# {"status":"ok"}',
      },
      {
        title: '添加密钥',
        description: '进入 Admin 后台，添加 OpenAI、Claude、DeepSeek、MiMo 或自定义 Provider Key。',
        label: 'URL',
        code: 'https://你的项目.vercel.app/admin\n# 使用 RELAY_ADMIN_KEY 登录',
      },
      {
        title: '开始调用',
        description: '把客户端 base URL 指向你的 Relay，继续使用 OpenAI 兼容请求格式。',
        label: 'bash',
        code: 'curl -X POST https://你的项目.vercel.app/v1/chat/completions \\\n  -H "Authorization: Bearer YOUR_RELAY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"gpt-4o","messages":[{"role":"user","content":"你好！"}]}\'',
      },
    ],
    endpoints: {
      headers: ['端点', '说明', '访问'],
      rows: [
        ['GET /v1/models', '列出所有可用模型', 'Bearer Key'],
        ['GET /v1/models/:id', '查询单个模型信息', 'Bearer Key'],
        ['POST /v1/chat/completions', 'Chat Completions，支持流式和非流式', 'Bearer Key'],
        ['GET /health', '公开健康检查', 'Public'],
        ['GET /api/status', '服务状态详情', 'Public'],
      ],
    },
    modelLabels: {
      model: '模型',
      context: '上下文',
      prefix: '模型前缀',
      stream: '流式',
      vision: '视觉',
      tools: '工具',
      custom: '自定义路由',
    },
    architecture: {
      client: 'Client / SDK',
      relay: 'AI Relay',
      provider: 'Provider Router',
      keyPool: 'Key Pool',
      admin: 'Admin + KV',
      notes: ['OpenAI 兼容请求进入 Relay', '按模型前缀选择 Provider', 'Key Pool 轮换、退避、Fallback', '用量、错误与配置写入 KV'],
    },
    footer: {
      version: 'AI Relay v2.0',
      license: 'MIT License',
      powered: 'Powered by Vercel Edge + KV',
      docs: '文档',
    },
  },
  en: {
    nav: {
      features: 'Features',
      quickstart: 'Quick Start',
      api: 'API',
      models: 'Models',
      architecture: 'Architecture',
      admin: 'Admin',
    },
    hero: {
      badge: 'Serverless · One-click Vercel deploy · OpenAI-compatible',
      title: 'AI Relay',
      subtitle: 'Serverless AI API relay gateway, one-click deploy to Vercel',
      description: 'No VPS, no Docker, no backend ops. Click Deploy with Vercel, set 3 environment variables, and run your own multi-provider AI Relay in 2 minutes. Keep your OpenAI SDK and only change base_url to get key rotation, fallback, usage tracking, and an Admin console.',
      quickstart: 'Deploy in 2 minutes',
      github: 'GitHub',
      deploy: 'Deploy to Vercel',
    },
    stats: [
      { value: '0', label: 'Server ops' },
      { value: '1-click', label: 'Vercel deploy' },
      { value: '2 min', label: 'Ready to use' },
    ],
    sections: {
      featuresEyebrow: 'FEATURES',
      featuresTitle: 'Reliability primitives for an API relay',
      featuresDescription: 'AI Relay turns unstable upstream providers into one predictable endpoint with routing, key rotation, fallback, and alerting built in.',
      quickstartEyebrow: 'QUICK START',
      quickstartTitle: 'Deploy and call it in four steps',
      quickstartDescription: 'Follow the README path: deploy, verify health, add Provider keys in Admin, then call the OpenAI-compatible endpoint.',
      apiEyebrow: 'API',
      apiTitle: 'A compact OpenAI-compatible API surface',
      modelsEyebrow: 'MODELS',
      modelsTitle: 'Models supported by this instance',
      modelsDescription: 'This list is loaded from the server-side provider registry and custom Provider configuration, so it reflects the deployed instance.',
      architectureEyebrow: 'ARCHITECTURE',
      architectureTitle: 'Transparent proxy with chained fallback',
    },
    featureToggle: {
      show: 'Show more capabilities',
      hide: 'Hide extended capabilities',
    },
    featureCards: [
      { icon: '↻', title: 'Key rotation', description: 'Round-robin dispatch plus automatic 429 backoff reduces pressure on individual upstream keys.', tier: 'p0' },
      { icon: '⇄', title: 'Provider routing', description: 'Route OpenAI, Claude, DeepSeek, MiMo, and custom providers automatically by model prefix.', tier: 'p0' },
      { icon: '↪', title: 'Multi-level fallback', description: 'Chained Provider and Key Pool failover keeps upstream faults away from client code.', tier: 'p0' },
      { icon: '▣', title: '100% OpenAI-compatible', description: 'Keep /v1/chat/completions and /v1/models semantics, with almost no SDK changes.', tier: 'p0' },
      { icon: '▤', title: 'Admin console', description: 'Manage keys, quotas, usage analytics, model tests, and Provider configuration in one place.', tier: 'p0' },
      { icon: '⚡', title: 'One-click deploy', description: 'Built for Vercel Edge Runtime, practical for personal or team relays on the free tier.', tier: 'p0' },
      { icon: '≋', title: 'Streaming pass-through', description: 'Transparent SSE forwarding for realtime output, long generations, and tool calling.', tier: 'p1' },
      { icon: '◈', title: 'Webhook alerts', description: 'Send daily reports, incidents, and quota alerts to WeCom, Feishu, DingTalk, or Slack.', tier: 'p1' },
      { icon: '◇', title: 'Temporary API keys', description: 'Stateless HMAC-signed keys with expiration windows and quota limits.', tier: 'p1' },
      { icon: '⧉', title: 'Virtual model mapping', description: 'Map internal aliases to upstream model IDs so callers do not need provider-specific details.', tier: 'p1' },
      { icon: '!', title: 'Error tracking and circuit breaking', description: 'Track failures per Provider and key, then isolate unhealthy upstreams automatically.', tier: 'p1' },
    ],
    quickstartSteps: [
      {
        title: 'Deploy',
        description: 'Clone to Vercel and set RELAY_API_KEY, RELAY_ADMIN_KEY, and RELAY_SIGNING_SECRET.',
        label: 'Vercel',
        code: 'RELAY_API_KEY=your-strong-client-key\nRELAY_ADMIN_KEY=your-admin-key\nRELAY_SIGNING_SECRET=your-signing-secret',
      },
      {
        title: 'Verify',
        description: 'After deployment, check the public health endpoint to confirm the Edge Function is responding.',
        label: 'bash',
        code: 'curl https://your-project.vercel.app/health\n# {"status":"ok"}',
      },
      {
        title: 'Add keys',
        description: 'Open Admin and add OpenAI, Claude, DeepSeek, MiMo, or custom Provider keys.',
        label: 'URL',
        code: 'https://your-project.vercel.app/admin\n# Sign in with RELAY_ADMIN_KEY',
      },
      {
        title: 'Call it',
        description: 'Point your client base URL to the relay and keep the OpenAI-compatible request format.',
        label: 'bash',
        code: 'curl -X POST https://your-project.vercel.app/v1/chat/completions \\\n  -H "Authorization: Bearer YOUR_RELAY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"model":"gpt-4o","messages":[{"role":"user","content":"Hello!"}]}\'',
      },
    ],
    endpoints: {
      headers: ['Endpoint', 'Description', 'Access'],
      rows: [
        ['GET /v1/models', 'List all available models', 'Bearer Key'],
        ['GET /v1/models/:id', 'Get one model by id', 'Bearer Key'],
        ['POST /v1/chat/completions', 'Chat Completions with streaming and non-streaming modes', 'Bearer Key'],
        ['GET /health', 'Public health check', 'Public'],
        ['GET /api/status', 'Service status details', 'Public'],
      ],
    },
    modelLabels: {
      model: 'Model',
      context: 'Context',
      prefix: 'Model prefix',
      stream: 'Stream',
      vision: 'Vision',
      tools: 'Tools',
      custom: 'Custom route',
    },
    architecture: {
      client: 'Client / SDK',
      relay: 'AI Relay',
      provider: 'Provider Router',
      keyPool: 'Key Pool',
      admin: 'Admin + KV',
      notes: ['OpenAI-compatible requests enter Relay', 'Model prefixes select the Provider', 'Key Pool rotates, backs off, and falls back', 'Usage, errors, and config persist to KV'],
    },
    footer: {
      version: 'AI Relay v2.0',
      license: 'MIT License',
      powered: 'Powered by Vercel Edge + KV',
      docs: 'Docs',
    },
  },
} satisfies Record<Language, {
  nav: Record<string, string>;
  hero: Record<string, string>;
  stats: Array<{ value: string; label: string }>;
  sections: Record<string, string>;
  featureToggle: Record<string, string>;
  featureCards: Array<{ icon: string; title: string; description: string; tier: 'p0' | 'p1' }>;
  quickstartSteps: Array<{ title: string; description: string; label: string; code: string }>;
  endpoints: { headers: string[]; rows: string[][] };
  modelLabels: Record<string, string>;
  architecture: { client: string; relay: string; provider: string; keyPool: string; admin: string; notes: string[] };
  footer: Record<string, string>;
}>;

function LogoIcon({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="home-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f2fe" />
          <stop offset="52%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="home-glow-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="50%" stopColor="#00f2fe" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <polygon points="16,2.5 29.5,10.3 29.5,25.7 16,29.5 2.5,25.7 2.5,10.3" stroke="url(#home-glow-grad)" strokeWidth="2" strokeLinejoin="round" opacity="0.86" />
      <circle cx="16" cy="2.5" r="2" fill="#00f2fe" />
      <circle cx="29.5" cy="10.3" r="2" fill="#3b82f6" />
      <circle cx="29.5" cy="25.7" r="2" fill="#8b5cf6" />
      <circle cx="16" cy="29.5" r="2" fill="#10b981" />
      <circle cx="2.5" cy="25.7" r="2" fill="#8b5cf6" />
      <circle cx="2.5" cy="10.3" r="2" fill="#3b82f6" />
      <path d="M18 5.5 L9 16.5 H15 L14 25.5 L23 14.5 H17 L18 5.5 Z" fill="url(#home-logo-grad)" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h10.4m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.18-3.37-1.18-.45-1.15-1.1-1.46-1.1-1.46-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.93 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0 1 12 6.02c.85 0 1.7.11 2.5.34 1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.83-2.34 4.67-4.57 4.92.36.31.68.92.68 1.86v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.8 10h14.4M10 2.8c2 2 3 4.4 3 7.2s-1 5.2-3 7.2M10 2.8c-2 2-3 4.4-3 7.2s1 5.2 3 7.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 7.5h8v9H7zM5 12.5H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SectionHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className={styles.sectionHeader}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function CodeBlock({ id, label, code, language, copiedId, onCopy }: {
  id: string;
  label: string;
  code: string;
  language: Language;
  copiedId: string | null;
  onCopy: (id: string, code: string) => void;
}) {
  const isCopied = copiedId === id;

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        <span>{label}</span>
        <button type="button" className={styles.copyButton} onClick={() => onCopy(id, code)}>
          <CopyIcon />
          {isCopied ? copyText[language].copied : copyText[language].copy}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function formatContext(tokens: number) {
  if (tokens >= 1000000) {
    return `${Number((tokens / 1000000).toFixed(1))}M`;
  }

  return `${Math.round(tokens / 1000)}K`;
}

export default function Homepage({ providers }: { providers: HomepageProvider[] }) {
  const [language, setLanguage] = useState<Language>('zh');
  const [showMoreFeatures, setShowMoreFeatures] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const browserLanguage = navigator.language.toLowerCase();
    if (browserLanguage.startsWith('en')) {
      setLanguage('en');
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 12);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const t = content[language];
  const visibleFeatures = useMemo(
    () => t.featureCards.filter((feature) => showMoreFeatures || feature.tier === 'p0'),
    [showMoreFeatures, t.featureCards],
  );

  async function handleCopy(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.backgroundGrid} aria-hidden="true" />
      <div className={styles.glowOne} aria-hidden="true" />
      <div className={styles.glowTwo} aria-hidden="true" />

      <header className={`${styles.navbar} ${isScrolled ? styles.scrolled : ''}`}>
        <a className={styles.brand} href="#top" aria-label="AI Relay home">
          <span className={styles.brandIcon}><LogoIcon size={28} /></span>
          <span>AI Relay</span>
        </a>
        <nav className={styles.navLinks} aria-label="Primary">
          <a href="#features">{t.nav.features}</a>
          <a href="#quickstart">{t.nav.quickstart}</a>
          <a href="#api">{t.nav.api}</a>
          <a href="#models">{t.nav.models}</a>
          <a href="#architecture">{t.nav.architecture}</a>
        </nav>
        <a className={styles.adminButton} href="/admin">
          {t.nav.admin}
        </a>
        <button type="button" className={styles.languageButton} onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')} aria-label="Switch language">
          <GlobeIcon />
          <span className={language === 'zh' ? styles.activeLanguage : undefined}>中</span>
          <span>/</span>
          <span className={language === 'en' ? styles.activeLanguage : undefined}>EN</span>
        </button>
      </header>

      <section id="top" className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroLogo} aria-hidden="true">
            <LogoIcon size={64} />
          </div>
          <p className={styles.heroBadge}>{t.hero.badge}</p>
          <div className={styles.heroTitleWrapper}>
            <div className={styles.heroTitleGlow} aria-hidden="true" />
            <h1>{t.hero.title}</h1>
          </div>
          <p className={styles.heroSubtitle}>{t.hero.subtitle}</p>
          <p className={styles.heroDescription}>{t.hero.description}</p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="#quickstart">
              {t.hero.quickstart}
              <ArrowIcon />
            </a>
            <a className={styles.secondaryButton} href={githubUrl} target="_blank" rel="noreferrer">
              <span className={styles.btnIcon}><GitHubIcon /></span>
              <span className={styles.btnText}>{t.hero.github}</span>
            </a>
            <a className={styles.ghostButton} href={deployUrl} target="_blank" rel="noreferrer">
              {t.hero.deploy}
            </a>
          </div>
          <div className={styles.heroStats} aria-label="AI Relay highlights">
            {t.stats.map((stat) => (
              <div key={stat.label}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className={styles.section}>
        <SectionHeader eyebrow={t.sections.featuresEyebrow} title={t.sections.featuresTitle} description={t.sections.featuresDescription} />
        <div className={styles.featureGrid}>
          {visibleFeatures.map((feature) => (
            <article className={styles.featureCard} key={feature.title}>
              <span className={styles.featureIcon} aria-hidden="true">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
        <div className={styles.centerAction}>
          <button type="button" className={styles.secondaryButton} onClick={() => setShowMoreFeatures((value) => !value)}>
            <span className={styles.btnText}>{showMoreFeatures ? t.featureToggle.hide : t.featureToggle.show}</span>
          </button>
        </div>
      </section>

      <section id="quickstart" className={styles.section}>
        <SectionHeader eyebrow={t.sections.quickstartEyebrow} title={t.sections.quickstartTitle} description={t.sections.quickstartDescription} />
        
        {/* Interactive Steps Timeline */}
        <div className={styles.timelineNav} role="tablist" aria-label="Quick Start Steps">
          {t.quickstartSteps.map((step, index) => {
            const isActive = activeStep === index;
            return (
              <div key={step.title} className={styles.timelineNavItem}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`step-content-${index}`}
                  id={`step-tab-${index}`}
                  className={`${styles.timelineButton} ${isActive ? styles.activeTimelineButton : ''}`}
                  onClick={() => setActiveStep(index)}
                >
                  <span className={styles.timelineButtonNumber}>{index + 1}</span>
                  <span className={styles.timelineButtonText}>{step.title}</span>
                </button>
                {index < t.quickstartSteps.length - 1 && (
                  <div className={`${styles.timelineConnector} ${activeStep > index ? styles.timelineConnectorFilled : ''}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Cards with active class */}
        <div className={styles.steps}>
          {t.quickstartSteps.map((step, index) => {
            const isActive = activeStep === index;
            return (
              <article 
                id={`step-content-${index}`}
                role="tabpanel"
                aria-labelledby={`step-tab-${index}`}
                className={`${styles.stepCard} ${isActive ? styles.activeStepCard : ''}`} 
                key={step.title}
              >
                <div className={styles.stepMarker}>
                  <span>{index + 1}</span>
                </div>
                <div className={styles.stepContent}>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                  {index === 0 ? (
                    <a className={styles.deployLink} href={deployUrl} target="_blank" rel="noreferrer">
                      {t.hero.deploy}
                      <ArrowIcon />
                    </a>
                  ) : null}
                  <CodeBlock id={`step-${index}`} label={step.label} code={step.code} language={language} copiedId={copiedId} onCopy={handleCopy} />
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="api" className={styles.section}>
        <SectionHeader eyebrow={t.sections.apiEyebrow} title={t.sections.apiTitle} />
        <div className={styles.tableShell}>
          <table>
            <thead>
              <tr>
                {t.endpoints.headers.map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {t.endpoints.rows.map((row) => (
                <tr key={row[0]}>
                  <td><code>{row[0]}</code></td>
                  <td>{row[1]}</td>
                  <td><span className={row[2] === 'Public' ? styles.publicPill : styles.authPill}>{row[2]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="models" className={styles.section}>
        <SectionHeader eyebrow={t.sections.modelsEyebrow} title={t.sections.modelsTitle} description={t.sections.modelsDescription} />
        <div className={styles.providerGrid}>
          {providers.map((provider) => (
            <article className={styles.providerCard} key={provider.id}>
              <div className={styles.providerHeader}>
                <div>
                  <h3>{provider.name}</h3>
                  <p>{provider.prefixes.join(', ')}*</p>
                </div>
                <span>{provider.models.length || t.modelLabels.custom}</span>
              </div>
              {provider.models.length > 0 ? (
                <div className={styles.modelList}>
                  {provider.models.map((model) => (
                    <div className={styles.modelRow} key={model.id}>
                      <div>
                        <strong>{model.id}</strong>
                        <span>{model.displayName}</span>
                      </div>
                      <div className={styles.modelMeta}>
                        <span>{formatContext(model.contextWindow)}</span>
                        {model.supportsStream ? <em>{t.modelLabels.stream}</em> : null}
                        {model.supportsVision ? <em>{t.modelLabels.vision}</em> : null}
                        {model.supportsTools ? <em>{t.modelLabels.tools}</em> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.prefixFallback}>
                  <span>{t.modelLabels.prefix}</span>
                  <code>{provider.prefixes.join(', ')}*</code>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section id="architecture" className={styles.section}>
        <SectionHeader eyebrow={t.sections.architectureEyebrow} title={t.sections.architectureTitle} />
        <div className={styles.architecture}>
          <div className={styles.archFlowContainer}>
            <svg viewBox="0 0 760 400" className={styles.archSvg} aria-label={t.sections.architectureTitle}>
              <defs>
                <linearGradient id="path-grad-1" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#00f2fe" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
                <linearGradient id="path-grad-2" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#10b981" />
                </linearGradient>
              </defs>

              {/* Connections with running animations */}
              <path d="M 140 190 H 250" className={styles.flowPath} stroke="url(#path-grad-1)" strokeWidth="2.5" fill="none" />
              <path d="M 140 190 H 250" className={styles.flowPathActive} stroke="#00f2fe" strokeWidth="2.5" fill="none" strokeDasharray="6 6" />

              <path d="M 410 170 C 470 170, 470 100, 520 100" className={styles.flowPath} stroke="url(#path-grad-1)" strokeWidth="2.5" fill="none" />
              <path d="M 410 170 C 470 170, 470 100, 520 100" className={styles.flowPathActive} stroke="#8b5cf6" strokeWidth="2.5" fill="none" strokeDasharray="6 6" />

              <path d="M 410 210 C 470 210, 470 280, 520 280" className={styles.flowPath} stroke="url(#path-grad-1)" strokeWidth="2.5" fill="none" />
              <path d="M 410 210 C 470 210, 470 280, 520 280" className={styles.flowPathActive} stroke="#8b5cf6" strokeWidth="2.5" fill="none" strokeDasharray="6 6" />

              <path d="M 600 130 V 240" className={styles.flowPath} stroke="#8b5cf6" strokeWidth="2" fill="none" />

              <path d="M 330 240 V 310" className={styles.flowPath} stroke="#10b981" strokeWidth="2" fill="none" />
              <path d="M 330 240 V 310" className={styles.flowPathActive} stroke="#10b981" strokeWidth="2" fill="none" strokeDasharray="5 5" />

              {/* Node Cards inside foreignObjects */}
              <foreignObject x="10" y="150" width="130" height="80">
                <div className={styles.svgNode}>
                  <span className={styles.svgNodeTitle}>{t.architecture.client}</span>
                </div>
              </foreignObject>

              <foreignObject x="250" y="140" width="160" height="100">
                <div className={`${styles.svgNode} ${styles.svgNodeRelay}`}>
                  <div className={styles.svgNodeLogo}><LogoIcon size={20} /></div>
                  <span className={styles.svgNodeTitle}>{t.architecture.relay}</span>
                  <small className={styles.svgNodeSub}>Edge Runtime</small>
                </div>
              </foreignObject>

              <foreignObject x="520" y="60" width="160" height="70">
                <div className={styles.svgNode}>
                  <span className={styles.svgNodeTitle}>{t.architecture.provider}</span>
                  <small className={styles.svgNodeSub}>OpenAI / Claude / DeepSeek</small>
                </div>
              </foreignObject>

              <foreignObject x="520" y="240" width="160" height="70">
                <div className={styles.svgNode}>
                  <span className={styles.svgNodeTitle}>{t.architecture.keyPool}</span>
                  <small className={styles.svgNodeSub}>Round-Robin / 429 Backoff</small>
                </div>
              </foreignObject>

              <foreignObject x="250" y="310" width="160" height="70">
                <div className={`${styles.svgNode} ${styles.svgNodeAdmin}`}>
                  <span className={styles.svgNodeTitle}>{t.architecture.admin}</span>
                  <small className={styles.svgNodeSub}>Config & Metrics Sync</small>
                </div>
              </foreignObject>
            </svg>
          </div>
          <ul className={styles.archNotes}>
            {t.architecture.notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerBrand}>
          <LogoIcon size={24} />
          <span>{t.footer.version}</span>
        </div>
        <div className={styles.footerLinks}>
          <a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a>
          <a href={`${githubUrl}#readme`} target="_blank" rel="noreferrer">{t.footer.docs}</a>
          <span>{t.footer.license}</span>
          <span>{t.footer.powered}</span>
        </div>
      </footer>
    </main>
  );
}
