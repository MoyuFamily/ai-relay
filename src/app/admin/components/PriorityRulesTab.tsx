'use client';

import type { PriorityRule, PriorityRuleConflict } from '../types';

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
}

export default function PriorityRulesTab({ rules = [] }: PriorityRulesTabProps) {
  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <h2 style={{ margin: 0, color: '#fff' }}>Priority Rules</h2>
      {rules.length === 0 ? (
        <div className="stat-card" style={{ color: '#9ca3af' }}>No priority rules configured.</div>
      ) : rules.map((rule) => (
        <div key={rule.id} className="stat-card" style={{ color: '#d1d5db' }}>
          <strong style={{ color: '#fff' }}>{rule.name}</strong>
          <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>{rule.modelPattern} → {rule.providerOrder.join(' / ')}</div>
        </div>
      ))}
    </div>
  );
}
