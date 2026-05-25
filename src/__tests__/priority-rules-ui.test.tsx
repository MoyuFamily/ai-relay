import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PriorityRulesTab, {
  createBlankPriorityRule,
  getRuleConflictState,
  movePriorityRule,
} from '@/app/admin/components/PriorityRulesTab';
import type { PriorityRuleConflict } from '@/app/admin/types';

describe('iteration three priority rules UI helpers', () => {
  it('reorders rules with bounded drag/arrow movement', () => {
    const rules = [
      { id: 'a', name: 'A', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai'] },
      { id: 'b', name: 'B', enabled: true, modelPattern: 'o1-*', providerOrder: ['openai'] },
      { id: 'c', name: 'C', enabled: true, modelPattern: 'claude-*', providerOrder: ['anthropic'] },
    ];

    expect(movePriorityRule(rules, 2, 0).map((rule) => rule.id)).toEqual(['c', 'a', 'b']);
    expect(movePriorityRule(rules, 0, -1).map((rule) => rule.id)).toEqual(['a', 'b', 'c']);
    expect(movePriorityRule(rules, 1, 9).map((rule) => rule.id)).toEqual(['a', 'b', 'c']);
  });

  it('creates a blank rule seeded with available providers and a unique id', () => {
    const first = createBlankPriorityRule(['openai', 'deepseek']);
    const second = createBlankPriorityRule(['openai']);

    expect(first).toMatchObject({ enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai', 'deepseek'] });
    expect(second.id).not.toEqual(first.id);
  });

  it('derives the strongest realtime conflict state for a rule card', () => {
    const conflicts: PriorityRuleConflict[] = [
      { type: 'overlap', severity: 'warning', ruleIds: ['a', 'b'], ruleNames: ['A', 'B'], sampleModel: 'gpt-4o', matchedModels: ['gpt-4o'], message: 'warning' },
      { type: 'duplicate', severity: 'error', ruleIds: ['c', 'a'], ruleNames: ['C', 'A'], sampleModel: 'o1-mini', matchedModels: ['o1-mini'], message: 'error' },
    ];

    expect(getRuleConflictState('a', conflicts)).toMatchObject({ severity: 'error', count: 2 });
    expect(getRuleConflictState('b', conflicts)).toMatchObject({ severity: 'warning', count: 1 });
    expect(getRuleConflictState('x', conflicts)).toMatchObject({ severity: null, count: 0 });
  });

  it('derives realtime conflicts from local draft rules before save', () => {
    const html = renderToStaticMarkup(
      <PriorityRulesTab
        rules={[
          { id: 'a', name: 'GPT OpenAI', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai'] },
          { id: 'b', name: 'GPT DeepSeek', enabled: true, modelPattern: 'gpt-*', providerOrder: ['deepseek'] },
        ]}
        providers={[
          { id: 'openai', name: 'OpenAI', keyCount: 1, availableKeys: 1, configured: true, modelPrefixes: ['gpt-'] },
          { id: 'deepseek', name: 'DeepSeek', keyCount: 1, availableKeys: 1, configured: true, modelPrefixes: ['deepseek-'] },
        ]}
        conflicts={[]}
        loading={false}
        message=""
        onSaveRules={() => undefined}
      />
    );

    expect(html).toContain('冲突 1');
    expect(html).toContain('duplicate');
    expect(html).toContain('规则重复');
    expect(html).toContain('disabled=""');
  });
});
