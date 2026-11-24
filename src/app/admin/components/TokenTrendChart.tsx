'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatLargeNumber } from '../lib/format';

interface UsagePoint {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface ProviderUsage {
  provider: string;
  data: UsagePoint[];
}

interface UsageTrendData {
  range: string;
  granularity: 'day' | 'week' | 'month';
  sampling?: {
    sampleRate: number;
    estimated: boolean;
  };
  global: UsagePoint[];
  providers: ProviderUsage[];
}

type Granularity = 'day' | 'week' | 'month';

/** Range options per granularity */
const RANGE_OPTIONS: Record<Granularity, { value: string; label: string }[]> = {
  day: [
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
  ],
  week: [
    { value: '4w', label: '4 Weeks' },
    { value: '12w', label: '12 Weeks' },
  ],
  month: [
    { value: '6m', label: '6 Months' },
    { value: '12m', label: '12 Months' },
  ],
};

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: '日',
  week: '周',
  month: '月',
};

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10b981',
  anthropic: '#f59e0b',
  google: '#06b6d4',
  deepseek: '#3b82f6',
  openrouter: '#8b5cf6',
  xiaomi: '#ef4444',
  xiaomi_sgp_coding: '#ec4899',
  xiaomi_coding: '#a855f7',
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  xiaomi: 'Xiaomi',
  xiaomi_sgp_coding: 'MiMo SGP Coding',
  xiaomi_coding: 'MiMo Coding',
};

const PROMPT_COLOR = '#3b82f6';
const COMPLETION_COLOR = '#8b5cf6';

interface TokenTrendChartProps {
  apiKey: string;
  lang?: 'zh' | 'en';
}

export default function TokenTrendChart({ apiKey, lang = 'zh' }: TokenTrendChartProps) {
  const [data, setData] = useState<UsageTrendData | null>(null);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [range, setRange] = useState('7d');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEn = lang === 'en';

  const t = {
    title: isEn ? '📉 Token Consumption Trend' : '📉 Token 消耗趋势',
    promptTokens: isEn ? 'Prompt Tokens' : '输入 Token',
    completionTokens: isEn ? 'Completion Tokens' : '输出 Token',
    totalTokens: isEn ? 'Total Tokens' : '总 Token',
    total: isEn ? 'Total' : '共计',
    all: isEn ? 'All' : '全部',
    loading: isEn ? 'Loading trend data...' : '正在加载趋势数据...',
    error: isEn ? 'Failed to load trend data' : '加载趋势数据失败',
    noData: isEn ? 'No usage data yet for this period' : '当前周期暂无消耗数据',
    estimated: isEn ? 'Estimated' : '估算',
    estimatedNotice: isEn ? 'Trend values are estimated from a sampled write rate.' : '趋势数据基于采样写入估算。',
  };

  const rangeOptions = {
    day: [
      { value: '7d', label: isEn ? '7 Days' : '7天' },
      { value: '30d', label: isEn ? '30 Days' : '30天' },
    ],
    week: [
      { value: '4w', label: isEn ? '4 Weeks' : '4周' },
      { value: '12w', label: isEn ? '12 Weeks' : '12周' },
    ],
    month: [
      { value: '6m', label: isEn ? '6 Months' : '6个月' },
      { value: '12m', label: isEn ? '12 Months' : '12个月' },
    ],
  };

  const granularityLabels: Record<Granularity, string> = {
    day: isEn ? 'Day' : '日',
    week: isEn ? 'Week' : '周',
    month: isEn ? 'Month' : '月',
  };

  // When granularity changes, reset range to default for that granularity
  const handleGranularityChange = (g: Granularity) => {
    setGranularity(g);
    setRange(RANGE_OPTIONS[g][0].value);
  };

  const fetchTrend = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usage-trend?granularity=${granularity}&range=${range}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error('Failed to fetch trend data');
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(t.error);
    } finally {
      setLoading(false);
    }
  }, [apiKey, granularity, range, t.error]);

  useEffect(() => {
    fetchTrend();
  }, [fetchTrend]);


  /** Format x-axis labels based on granularity */
  const fmtDate = (date: string) => {
    if (granularity === 'month') {
      const month = parseInt(date.slice(5, 7), 10);
      if (isEn) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return months[month - 1] || `${month}`;
      }
      return `${month}月`;
    }
    if (granularity === 'week') {
      const weekNum = date.replace(/^\d{4}-W/, '');
      return isEn ? `W${weekNum}` : `第${weekNum}周`;
    }
    const d = new Date(date + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  /** Format tooltip labels */
  const fmtTooltipDate = (date: string) => {
    if (granularity === 'month') {
      return date;
    }
    if (granularity === 'week') {
      return isEn ? `Week ${date.replace(/^\d{4}-W/, '')}` : `第 ${date.replace(/^\d{4}-W/, '')} 周`;
    }
    const d = new Date(date + 'T00:00:00');
    return isEn
      ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  // Get chart data based on selected provider
  const chartData = (() => {
    if (!data) return [];
    if (selectedProvider === 'all') {
      return data.global;
    }
    const provider = data.providers.find((p) => p.provider === selectedProvider);
    return provider?.data || [];
  })();

  // Available providers (including 'all', sorted by consumption volume descending)
  const availableProviders = data
    ? [
        'all',
        ...[...data.providers]
          .map((p) => ({
            provider: p.provider,
            totalTokens: p.data.reduce((sum, d) => sum + d.totalTokens, 0),
          }))
          .sort((a, b) => b.totalTokens - a.totalTokens)
          .map((p) => p.provider),
      ]
    : ['all'];

  const trendEstimated = data?.sampling?.estimated === true;
  const trendSamplePercent = Math.round((data?.sampling?.sampleRate ?? 1) * 100);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        backgroundColor: '#1a1a2e',
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        fontSize: '0.85rem',
      }}>
        <div style={{ color: '#888', marginBottom: '0.5rem' }}>{fmtTooltipDate(label)}</div>
        {payload.map((entry: any, i: number) => (
          <div key={i} style={{ color: entry.color, marginBottom: '0.25rem' }}>
            {entry.name}: {formatLargeNumber(entry.value)}
          </div>
        ))}
        {payload.length >= 2 && (
          <div style={{ color: '#666', marginTop: '0.5rem', borderTop: '1px solid #333', paddingTop: '0.5rem' }}>
            {t.total}: {formatLargeNumber(payload.reduce((sum: number, p: any) => sum + p.value, 0))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section style={{
      padding: '1.5rem',
      borderRadius: '12px',
      border: '1px solid #333',
      backgroundColor: '#111',
      marginBottom: '1.5rem',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '0.75rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.2rem', marginTop: 0, margin: 0 }}>
            {t.title}
          </h2>
          {trendEstimated && (
            <span title={t.estimatedNotice} style={{
              padding: '0.2rem 0.5rem',
              borderRadius: '6px',
              fontSize: '0.72rem',
              fontWeight: 600,
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.2)',
            }}>
              {t.estimated} · {trendSamplePercent}%
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Provider filter */}
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {availableProviders.map((p) => (
              <button
                key={p}
                onClick={() => setSelectedProvider(p)}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  border: selectedProvider === p ? 'none' : '1px solid #333',
                  backgroundColor: selectedProvider === p
                    ? (p === 'all' ? '#2563eb' : (PROVIDER_COLORS[p] || '#2563eb'))
                    : 'transparent',
                  color: selectedProvider === p ? 'white' : '#888',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                {p === 'all' ? t.all : (PROVIDER_DISPLAY_NAMES[p] || p)}
              </button>
            ))}
          </div>

          {/* Separator */}
          <div style={{ width: '1px', height: '20px', backgroundColor: '#333' }} />

          {/* Granularity switcher */}
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {(['day', 'week', 'month'] as const).map((g) => (
              <button
                key={g}
                onClick={() => handleGranularityChange(g)}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  border: granularity === g ? 'none' : '1px solid #333',
                  backgroundColor: granularity === g ? '#7c3aed' : 'transparent',
                  color: granularity === g ? 'white' : '#888',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                {granularityLabels[g]}
              </button>
            ))}
          </div>

          {/* Range selector */}
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {rangeOptions[granularity].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  border: range === opt.value ? 'none' : '1px solid #333',
                  backgroundColor: range === opt.value ? '#2563eb' : 'transparent',
                  color: range === opt.value ? 'white' : '#888',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
          {t.loading}
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {!loading && !error && data && chartData.length > 0 && (
        <>
          {/* Provider-specific chart: stacked prompt/completion */}
          {selectedProvider !== 'all' ? (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <defs>
                  <linearGradient id="gradPrompt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PROMPT_COLOR} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={PROMPT_COLOR} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradCompletion" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COMPLETION_COLOR} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={COMPLETION_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDate}
                  stroke="#555"
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={formatLargeNumber}
                  stroke="#555"
                  tick={{ fontSize: 12 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: '0.85rem', color: '#888' }}
                />
                <Area
                  type="monotone"
                  dataKey="promptTokens"
                  name={t.promptTokens}
                  stroke={PROMPT_COLOR}
                  fill="url(#gradPrompt)"
                  strokeWidth={2}
                  stackId="1"
                />
                <Area
                  type="monotone"
                  dataKey="completionTokens"
                  name={t.completionTokens}
                  stroke={COMPLETION_COLOR}
                  fill="url(#gradCompletion)"
                  strokeWidth={2}
                  stackId="1"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            /* All providers: stacked area */
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#222" />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDate}
                  stroke="#555"
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={formatLargeNumber}
                  stroke="#555"
                  tick={{ fontSize: 12 }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="totalTokens"
                  name={t.totalTokens}
                  stroke="#2563eb"
                  fill="#2563eb"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}

          {/* Provider breakdown mini cards */}
          {selectedProvider === 'all' && data.providers.length > 0 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '0.75rem',
              marginTop: '1rem',
            }}>
              {[...data.providers]
                .map((p) => ({
                  ...p,
                  totalTokens: p.data.reduce((sum, d) => sum + d.totalTokens, 0),
                }))
                .sort((a, b) => b.totalTokens - a.totalTokens)
                .map((p) => {
                  const color = PROVIDER_COLORS[p.provider] || '#888';
                  return (
                    <div
                      key={p.provider}
                      onClick={() => setSelectedProvider(p.provider)}
                      style={{
                        padding: '0.75rem',
                        borderRadius: '8px',
                        border: `1px solid ${color}33`,
                        backgroundColor: `${color}11`,
                        cursor: 'pointer',
                        transition: 'border-color 0.2s',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = color;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.borderColor = `${color}33`;
                      }}
                    >
                      <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '0.25rem' }}>
                        {PROVIDER_DISPLAY_NAMES[p.provider] || p.provider}
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color }}>
                        {formatLargeNumber(p.totalTokens)}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </>
      )}

      {!loading && !error && (!data || chartData.every((d: UsagePoint) => d.totalTokens === 0)) && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#555' }}>
          {t.noData}
        </div>
      )}
    </section>
  );
}
