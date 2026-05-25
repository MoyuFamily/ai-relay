'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { detectPriorityRuleConflicts } from '@/lib/admin/priority-rules-core';
import type { PriorityRule, PriorityRuleConflict, ProviderInfo } from '../types';

export function movePriorityRule<T>(rules: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= rules.length || toIndex < 0 || toIndex >= rules.length) {
    return rules;
  }
  const next = [...rules];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function createBlankPriorityRule(providerOrder: string[]): PriorityRule {
  const now = new Date().toISOString();
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `rule-${random}`,
    name: 'New rule',
    enabled: true,
    modelPattern: 'gpt-*',
    providerOrder,
    createdAt: now,
    updatedAt: now,
  };
}

export function getRuleConflictState(ruleId: string, conflicts: PriorityRuleConflict[]): { severity: 'warning' | 'error' | null; count: number } {
  const matched = conflicts.filter((conflict) => conflict.ruleIds.includes(ruleId));
  if (matched.some((conflict) => conflict.severity === 'error')) {
    return { severity: 'error', count: matched.length };
  }
  if (matched.length > 0) {
    return { severity: 'warning', count: matched.length };
  }
  return { severity: null, count: 0 };
}

interface PriorityRulesTabProps {
  rules?: PriorityRule[];
  providers?: ProviderInfo[];
  conflicts?: PriorityRuleConflict[];
  loading?: boolean;
  message?: string;
  onAddRule?: () => void;
  onDeleteRule?: (id: string) => void;
  onReorderRules?: (rules: PriorityRule[]) => void;
  onSaveRules?: (rules: PriorityRule[]) => void;
}

const inputStyle: React.CSSProperties = {
  padding: '0.55rem 0.75rem',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(0,0,0,0.22)',
  color: '#e5e7eb',
  boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  padding: '0.45rem 0.7rem',
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: '#d1d5db',
  cursor: 'pointer',
};

export default function PriorityRulesTab({
  rules = [],
  providers = [],
  conflicts = [],
  loading = false,
  message = '',
  onAddRule,
  onDeleteRule,
  onReorderRules,
  onSaveRules,
}: PriorityRulesTabProps) {
  const [draftRules, setDraftRules] = useState<PriorityRule[]>(rules);

  useEffect(() => {
    setDraftRules(rules);
  }, [rules]);

  const configuredProviders = useMemo(() => providers.filter((provider) => provider.configured), [providers]);
  const providerIds = configuredProviders.length > 0 ? configuredProviders.map((provider) => provider.id) : providers.map((provider) => provider.id);
  const realtimeConflicts = useMemo(() => detectPriorityRuleConflicts(draftRules), [draftRules]);
  const visibleConflicts = realtimeConflicts;
  const blockingCount = visibleConflicts.filter((conflict) => conflict.severity === 'error').length;

  const updateDraft = (next: PriorityRule[]) => {
    setDraftRules(next);
    onReorderRules?.(next);
  };

  const updateRule = (id: string, patch: Partial<PriorityRule>) => {
    setDraftRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const addRule = () => {
    const next = [...draftRules, createBlankPriorityRule(providerIds.slice(0, 2))];
    setDraftRules(next);
    onAddRule?.();
  };

  const removeRule = (id: string) => {
    setDraftRules((current) => current.filter((rule) => rule.id !== id));
    onDeleteRule?.(id);
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: '#fff' }}>优先级规则</h2>
          <p style={{ margin: '0.25rem 0 0', color: '#9ca3af', fontSize: '0.9rem' }}>
            拖拽/箭头排序，第一条命中的规则优先生效，最多 20 条。
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {visibleConflicts.length > 0 && (
            <span style={{ color: blockingCount > 0 ? '#f87171' : '#fbbf24', fontWeight: 700 }}>
              ⚠️ 冲突 {visibleConflicts.length}
            </span>
          )}
          <button style={buttonStyle} onClick={addRule} disabled={draftRules.length >= 20 || loading}>新增规则</button>
          <button style={buttonStyle} onClick={() => onSaveRules?.(draftRules)} disabled={loading || blockingCount > 0}>
            {loading ? '保存中...' : '保存规则'}
          </button>
        </div>
      </div>

      {message && <div style={{ color: message.includes('失败') || message.includes('Failed') ? '#f87171' : '#93c5fd', fontSize: '0.9rem' }}>{message}</div>}

      {visibleConflicts.length > 0 && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {visibleConflicts.map((conflict, index) => (
            <div key={`${conflict.type}-${index}`} style={{ border: `1px solid ${conflict.severity === 'error' ? 'rgba(248,113,113,0.55)' : 'rgba(251,191,36,0.55)'}`, borderRadius: 10, padding: '0.75rem', color: conflict.severity === 'error' ? '#fecaca' : '#fde68a', background: conflict.severity === 'error' ? 'rgba(127,29,29,0.18)' : 'rgba(120,53,15,0.18)' }}>
              <strong>{conflict.severity === 'error' ? '错误' : '警告'} · {conflict.type}</strong>
              <div style={{ marginTop: '0.25rem', color: '#d1d5db' }}>{conflict.message}</div>
            </div>
          ))}
        </div>
      )}

      {draftRules.length === 0 ? (
        <div className="stat-card" style={{ color: '#9ca3af', border: '1px dashed rgba(255,255,255,0.15)', padding: '1.5rem', textAlign: 'center' }}>
          暂无优先级规则。点击「新增规则」开始配置。
        </div>
      ) : draftRules.map((rule, index) => {
        const state = getRuleConflictState(rule.id, visibleConflicts);
        const borderColor = state.severity === 'error' ? 'rgba(248,113,113,0.75)' : state.severity === 'warning' ? 'rgba(251,191,36,0.75)' : 'rgba(52,211,153,0.35)';
        return (
          <div key={rule.id} className="stat-card" style={{ color: '#d1d5db', border: `1px solid ${borderColor}`, borderRadius: 14, padding: '1rem', background: 'rgba(255,255,255,0.035)', display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: '#60a5fa', fontWeight: 700 }}>#{index + 1}</span>
                <input value={rule.name} onChange={(event) => updateRule(rule.id, { name: event.target.value })} style={{ ...inputStyle, minWidth: 180 }} aria-label="规则名称" />
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: '#9ca3af' }}>
                  <input type="checkbox" checked={rule.enabled} onChange={(event) => updateRule(rule.id, { enabled: event.target.checked })} /> 启用
                </label>
                {state.severity && <span style={{ color: state.severity === 'error' ? '#f87171' : '#fbbf24', fontWeight: 700 }}>{state.severity === 'error' ? '错误' : '警告'} {state.count}</span>}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button style={buttonStyle} onClick={() => updateDraft(movePriorityRule(draftRules, index, index - 1))} disabled={index === 0}>↑</button>
                <button style={buttonStyle} onClick={() => updateDraft(movePriorityRule(draftRules, index, index + 1))} disabled={index === draftRules.length - 1}>↓</button>
                <button style={{ ...buttonStyle, color: '#fca5a5' }} onClick={() => removeRule(rule.id)}>删除</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 2fr)', gap: '0.75rem' }}>
              <label style={{ display: 'grid', gap: '0.35rem', color: '#9ca3af', fontSize: '0.85rem' }}>
                model pattern
                <input value={rule.modelPattern} onChange={(event) => updateRule(rule.id, { modelPattern: event.target.value })} placeholder="gpt-*" style={{ ...inputStyle, width: '100%' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem', color: '#9ca3af', fontSize: '0.85rem' }}>
                provider order
                <input value={rule.providerOrder.join(', ')} onChange={(event) => updateRule(rule.id, { providerOrder: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} placeholder="openai, deepseek" style={{ ...inputStyle, width: '100%' }} />
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
