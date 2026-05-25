'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderInfo } from '../types';

type AliasRow = { target: string; source: 'system' | 'user' };

type AliasResponse = {
  aliases: Record<string, AliasRow>;
  hidden: string[];
  total: number;
};

type CsvImportRow = {
  line: number;
  alias: string;
  target_model: string;
  hidden: boolean;
  status: 'added' | 'updated' | 'skipped' | 'error';
  error?: string;
};

type CsvPreview = {
  file: File;
  mode: 'append' | 'overwrite';
  stats: { added: number; updated: number; skipped: number; errors: number };
  rows: CsvImportRow[];
  errors: Array<{ line: number; alias?: string; error: string }>;
};

interface ModelAliasesTabProps {
  apiKey: string;
  providers: ProviderInfo[];
  onRefreshData: () => Promise<void>;
}

const inputStyle = {
  padding: '0.55rem 0.75rem',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(0,0,0,0.22)',
  color: '#e5e7eb',
  width: '100%',
  boxSizing: 'border-box' as const,
};

export default function ModelAliasesTab({ apiKey, providers, onRefreshData }: ModelAliasesTabProps) {
  const [data, setData] = useState<AliasResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [newAlias, setNewAlias] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [csvMode, setCsvMode] = useState<'append' | 'overwrite'>('append');
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const modelIds = useMemo(() => {
    return Array.from(new Set(providers.flatMap((provider) => provider.models?.map((model) => model.id) || []))).sort();
  }, [providers]);

  const fetchAliases = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/model-aliases', { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Failed to load aliases');
      setData(json);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAliases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const saveAlias = async (alias: string, target: string, hidden = false) => {
    const res = await fetch('/api/admin/model-aliases', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias, target, hidden }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Failed to save alias');
    setMessage('别名已保存');
    await fetchAliases();
  };

  const deleteAlias = async (alias: string) => {
    const row = data?.aliases[alias];
    if (!row) return;
    if (!confirm(`确认删除别名 ${alias} → ${row.target}？`)) return;
    const res = await fetch(`/api/admin/model-aliases?alias=${encodeURIComponent(alias)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Failed to delete alias');
    setMessage('别名已删除');
    await fetchAliases();
  };

  const toggleHidden = async (target: string, hidden: boolean) => {
    if (!data) return;
    const hiddenSet = new Set(data.hidden);
    if (hidden) hiddenSet.delete(target); else hiddenSet.add(target);
    const userAliases = Object.fromEntries(Object.entries(data.aliases).filter(([, row]) => row.source === 'user').map(([alias, row]) => [alias, row.target]));
    const res = await fetch('/api/admin/model-aliases', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases: userAliases, hidden: Array.from(hiddenSet) }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Failed to update visibility');
    setMessage(hidden ? '模型已显示' : '模型已隐藏');
    await fetchAliases();
    await onRefreshData();
  };

  const addAlias = async () => {
    await saveAlias(newAlias, newTarget);
    setNewAlias('');
    setNewTarget('');
  };

  const importCsv = async (file: File, previewOnly = true) => {
    const form = new FormData();
    form.set('mode', csvMode);
    if (previewOnly) form.set('preview', 'true');
    form.set('file', file);
    const res = await fetch('/api/admin/model-aliases/import', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'CSV import failed');
    if (previewOnly) {
      setCsvPreview({ file, mode: csvMode, stats: json.stats, rows: json.rows || [], errors: json.errors || [] });
      setMessage(`CSV 预览：新增 ${json.stats.added}，更新 ${json.stats.updated}，跳过 ${json.stats.skipped}，错误 ${json.stats.errors}`);
      return;
    }
    setMessage(`CSV 导入完成：新增 ${json.stats.added}，更新 ${json.stats.updated}，跳过 ${json.stats.skipped}，错误 ${json.stats.errors}`);
    setCsvPreview(null);
    await fetchAliases();
    await onRefreshData();
  };

  const confirmCsvImport = async () => {
    if (!csvPreview) return;
    const { stats } = csvPreview;
    if (!confirm(`将新增 ${stats.added} 条、更新 ${stats.updated} 条、跳过 ${stats.skipped} 条、错误 ${stats.errors} 条，确认导入？`)) return;
    const form = new FormData();
    form.set('mode', csvPreview.mode);
    form.set('file', csvPreview.file);
    const res = await fetch('/api/admin/model-aliases/import', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'CSV import failed');
    setMessage(`CSV 导入完成：新增 ${json.stats.added}，更新 ${json.stats.updated}，跳过 ${json.stats.skipped}，错误 ${json.stats.errors}`);
    setCsvPreview(null);
    await fetchAliases();
    await onRefreshData();
  };

  const exportCsv = async () => {
    const res = await fetch('/api/admin/model-aliases/export', { headers: { Authorization: `Bearer ${apiKey}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(text || 'CSV export failed');
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-relay-models-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hidden = new Set(data?.hidden || []);
  const rows = Object.entries(data?.aliases || {}).filter(([, row]) => {
    const isHidden = hidden.has(row.target);
    if (filter === 'visible') return !isHidden;
    if (filter === 'hidden') return isHidden;
    return true;
  });

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff' }}>模型配置</h2>
          <p style={{ margin: '0.25rem 0 0', color: '#9ca3af', fontSize: '0.9rem' }}>别名管理、CSV 导入导出、模型可见性</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)} style={{ ...inputStyle, width: 'auto' }}>
            <option value="all">全部</option>
            <option value="visible">仅可见</option>
            <option value="hidden">仅隐藏</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#9ca3af', fontSize: '0.85rem' }}>
            <input type="radio" name="csv-mode" checked={csvMode === 'append'} onChange={() => setCsvMode('append')} /> 追加
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#9ca3af', fontSize: '0.85rem' }}>
            <input type="radio" name="csv-mode" checked={csvMode === 'overwrite'} onChange={() => setCsvMode('overwrite')} /> 覆盖
          </label>
          <button className="tab-btn" onClick={() => fileRef.current?.click()}>导入 CSV</button>
          <button className="tab-btn" onClick={exportCsv}>导出 CSV</button>
          <button className="tab-btn" onClick={fetchAliases} disabled={loading}>{loading ? '刷新中...' : '刷新'}</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0]).catch((err) => setMessage(err.message))} />
        </div>
      </div>

      {message && <div style={{ color: message.includes('失败') || message.includes('Failed') ? '#f87171' : '#93c5fd', fontSize: '0.9rem' }}>{message}</div>}

      {csvPreview && (
        <div style={{ border: '1px solid rgba(96,165,250,0.35)', borderRadius: 12, padding: '1rem', background: 'rgba(59,130,246,0.08)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#e5e7eb', fontWeight: 700 }}>CSV 导入预览 · {csvPreview.mode === 'overwrite' ? '覆盖模式' : '追加模式'}</div>
              <div style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: 4 }}>
                文件：{csvPreview.file.name}；新增 {csvPreview.stats.added}，更新 {csvPreview.stats.updated}，跳过 {csvPreview.stats.skipped}，错误 {csvPreview.stats.errors}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="tab-btn" onClick={() => setCsvPreview(null)}>取消</button>
              <button className="tab-btn" onClick={() => confirmCsvImport().catch((err) => setMessage(err.message))} disabled={csvPreview.stats.errors > 0}>
                确认导入
              </button>
            </div>
          </div>
          {csvPreview.stats.errors > 0 && (
            <div style={{ color: '#fca5a5', fontSize: '0.85rem' }}>存在错误行，请修正 CSV 后重新导入。</div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ color: '#9ca3af', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem' }}>行号</th>
                  <th style={{ padding: '0.5rem' }}>别名</th>
                  <th style={{ padding: '0.5rem' }}>目标模型</th>
                  <th style={{ padding: '0.5rem' }}>隐藏</th>
                  <th style={{ padding: '0.5rem' }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {csvPreview.rows.map((row, index) => (
                  <tr key={`${row.line}-${row.alias}-${index}`} style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'transparent' }}>
                    <td style={{ padding: '0.5rem', color: '#9ca3af' }}>{row.line}</td>
                    <td style={{ padding: '0.5rem', color: '#e5e7eb', fontFamily: 'monospace' }}>{row.alias || '-'}</td>
                    <td style={{ padding: '0.5rem', color: '#e5e7eb', fontFamily: 'monospace' }}>{row.target_model || '-'}</td>
                    <td style={{ padding: '0.5rem', color: '#9ca3af' }}>{row.hidden ? '是' : '否'}</td>
                    <td style={{ padding: '0.5rem', color: row.status === 'error' ? '#f87171' : row.status === 'skipped' ? '#fbbf24' : '#34d399' }}>
                      {row.error || row.status}
                    </td>
                  </tr>
                ))}
                {csvPreview.errors.map((err) => (
                  <tr key={`error-${err.line}-${err.alias || ''}`} style={{ background: 'rgba(248,113,113,0.08)' }}>
                    <td style={{ padding: '0.5rem', color: '#fca5a5' }}>{err.line}</td>
                    <td style={{ padding: '0.5rem', color: '#fca5a5', fontFamily: 'monospace' }}>{err.alias || '-'}</td>
                    <td style={{ padding: '0.5rem', color: '#9ca3af' }}>-</td>
                    <td style={{ padding: '0.5rem', color: '#9ca3af' }}>-</td>
                    <td style={{ padding: '0.5rem', color: '#f87171' }}>{err.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ color: '#9ca3af', fontSize: '0.8rem' }}>仅展示前 10 条有效预览与错误明细。确认后才会写入配置。</div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ color: '#9ca3af', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem' }}>别名</th>
              <th style={{ padding: '0.75rem' }}>目标模型</th>
              <th style={{ padding: '0.75rem' }}>来源</th>
              <th style={{ padding: '0.75rem' }}>可见性</th>
              <th style={{ padding: '0.75rem' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([alias, row], index) => {
              const isHidden = hidden.has(row.target);
              return (
                <tr key={alias} style={{ background: index % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'transparent', opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none', height: 48 }}>
                  <td style={{ padding: '0.75rem', color: '#e5e7eb', fontFamily: 'monospace' }}>{alias}</td>
                  <td style={{ padding: '0.75rem', color: '#e5e7eb', fontFamily: 'monospace' }}>{row.target}</td>
                  <td style={{ padding: '0.75rem', color: row.source === 'system' ? '#fbbf24' : '#34d399' }}>{row.source === 'system' ? '系统默认' : '用户自定义'}</td>
                  <td style={{ padding: '0.75rem' }}>
                    <button className="tab-btn" onClick={() => toggleHidden(row.target, isHidden)}>{isHidden ? '🙈 隐藏' : '👁️ 可见'}</button>
                  </td>
                  <td style={{ padding: '0.75rem' }}>
                    <button className="tab-btn" onClick={() => deleteAlias(alias)} disabled={row.source === 'system'}>删除</button>
                  </td>
                </tr>
              );
            })}
            <tr style={{ background: 'rgba(59,130,246,0.08)', height: 48 }}>
              <td style={{ padding: '0.75rem' }}><input value={newAlias} onChange={(e) => setNewAlias(e.target.value)} placeholder="+ 添加别名" style={inputStyle} /></td>
              <td style={{ padding: '0.75rem' }}>
                <input list="model-alias-targets" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="目标模型" style={inputStyle} />
                <datalist id="model-alias-targets">{modelIds.map((id) => <option key={id} value={id} />)}</datalist>
              </td>
              <td style={{ padding: '0.75rem', color: '#34d399' }}>用户自定义</td>
              <td style={{ padding: '0.75rem', color: '#9ca3af' }}>默认可见</td>
              <td style={{ padding: '0.75rem' }}><button className="tab-btn" onClick={addAlias} disabled={!newAlias || !newTarget}>保存</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
