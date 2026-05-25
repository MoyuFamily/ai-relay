import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  __adminConfigCacheForTests,
  createMemoryMockKV,
  getPriorityRules,
  savePriorityRules,
} from '../lib/admin/admin-config';
import { detectPriorityRuleConflicts, findMatchingPriorityRule, hasBlockingPriorityRuleConflicts, normalizePriorityRules } from '../lib/admin/priority-rules-core';
import { GET, PUT, POST, DELETE } from '../app/api/admin/priority-rules/route';

function installMockKV() {
  const mock = createMemoryMockKV();
  (global as any)._mockKVInstance = mock;
  (global as any)._mockKVInstance._isMock = true;
  return mock;
}

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/priority-rules', {
    method,
    headers: {
      Authorization: 'Bearer admin-test-key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('priority rules admin config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('RELAY_ADMIN_KEY', 'admin-test-key');
    __adminConfigCacheForTests.clear();
    installMockKV();
  });

  it('persists priority rules at relay:priority:rules and caches reads for 60s', async () => {
    const kv = installMockKV();
    const originalGet = kv.get.bind(kv);
    kv.get = vi.fn((key: string) => originalGet(key));

    await savePriorityRules([
      { id: 'r1', name: 'GPT primary', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai', 'deepseek'] },
    ]);

    const stored = await kv.get('relay:priority:rules');
    expect(stored).toMatchObject({ version: 1, rules: [expect.objectContaining({ id: 'r1' })], updatedAt: expect.any(Number) });
    vi.mocked(kv.get).mockClear();
    await expect(getPriorityRules()).resolves.toHaveLength(1);
    await expect(getPriorityRules()).resolves.toHaveLength(1);
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(kv.get).toHaveBeenCalledWith('relay:priority:rules');
  });

  it('normalizes rules and rejects more than 20 rules', () => {
    const rules = Array.from({ length: 21 }, (_, i) => ({
      id: `r${i}`,
      name: `Rule ${i}`,
      enabled: true,
      modelPattern: `model-${i}`,
      providerOrder: ['openai'],
    }));

    expect(() => normalizePriorityRules(rules)).toThrow('Priority rules are limited to 20');
  });

  it('detects duplicate, overlap, and shadow conflicts with severity metadata', () => {
    const conflicts = detectPriorityRuleConflicts([
      { id: 'a', name: 'Rule A', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai'] },
      { id: 'b', name: 'Rule B', enabled: true, modelPattern: 'gpt-4o', providerOrder: ['deepseek'] },
      { id: 'c', name: 'Rule C', enabled: true, modelPattern: 'o1-*', providerOrder: ['openai'] },
      { id: 'd', name: 'Rule D', enabled: true, modelPattern: 'o1-*', providerOrder: ['deepseek'] },
    ]);

    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'overlap', severity: 'warning', ruleIds: ['a', 'b'], sampleModel: 'gpt-4o' }),
      expect.objectContaining({ type: 'duplicate', severity: 'error', ruleIds: ['c', 'd'], sampleModel: 'o1-4o' }),
    ]));
  });

  it('matches enabled rules by priority order and ignores disabled rules', () => {
    const rules = normalizePriorityRules([
      { id: 'disabled', name: 'Disabled', enabled: false, modelPattern: '*', providerOrder: ['deepseek'] },
      { id: 'first', name: 'GPT wildcard', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai'] },
      { id: 'second', name: 'GPT-4o exact', enabled: true, modelPattern: 'gpt-4o', providerOrder: ['deepseek'] },
    ]);

    expect(findMatchingPriorityRule(rules, 'gpt-4o')?.id).toBe('first');
    expect(findMatchingPriorityRule(rules, 'claude-3-5-sonnet')).toBeNull();
  });

  it('matches bare patterns as prefix and supports ? glob wildcards', () => {
    expect(findMatchingPriorityRule(normalizePriorityRules([
      { id: 'prefix', name: 'GPT-4o prefix', enabled: true, modelPattern: 'gpt-4o', providerOrder: ['openai'] },
    ]), 'gpt-4o-mini')?.id).toBe('prefix');

    expect(findMatchingPriorityRule(normalizePriorityRules([
      { id: 'reasoning', name: 'Reasoning', enabled: true, modelPattern: 'o?-mini', providerOrder: ['openai'] },
    ]), 'o3-mini')?.id).toBe('reasoning');
  });

  it('blocks saving duplicate priority rules but allows warning-only overlaps', async () => {
    const duplicateRules = [
      { id: 'a', name: 'GPT OpenAI', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai'] },
      { id: 'b', name: 'GPT DeepSeek', enabled: true, modelPattern: 'gpt-*', providerOrder: ['deepseek'] },
    ];

    expect(hasBlockingPriorityRuleConflicts(detectPriorityRuleConflicts(duplicateRules))).toBe(true);
    let res = await PUT(req('PUT', { rules: duplicateRules }));
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: { message: expect.stringContaining('Priority rule conflict') } });

    const overlapRules = [
      { id: 'a', name: 'GPT wildcard', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai'] },
      { id: 'b', name: 'GPT-4o exact', enabled: true, modelPattern: 'gpt-4o', providerOrder: ['deepseek'] },
    ];
    expect(hasBlockingPriorityRuleConflicts(detectPriorityRuleConflicts(overlapRules))).toBe(false);
    res = await PUT(req('PUT', { rules: overlapRules }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, conflicts: [expect.objectContaining({ type: 'overlap' })] });
  });

  it('reorders priority rules through orderedIds without mutating rule contents', async () => {
    await savePriorityRules([
      { id: 'a', name: 'A', enabled: true, modelPattern: 'a-*', providerOrder: ['openai'] },
      { id: 'b', name: 'B', enabled: true, modelPattern: 'b-*', providerOrder: ['deepseek'] },
      { id: 'c', name: 'C', enabled: true, modelPattern: 'c-*', providerOrder: ['anthropic'] },
    ]);

    const res = await PUT(req('PUT', { orderedIds: ['c', 'a', 'b'] }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      rules: [
        expect.objectContaining({ id: 'c', name: 'C' }),
        expect.objectContaining({ id: 'a', name: 'A' }),
        expect.objectContaining({ id: 'b', name: 'B' }),
      ],
    });
  });

  it('exposes CRUD API for priority rules', async () => {
    let res = await PUT(req('PUT', { rules: [
      { id: 'r1', name: 'GPT primary', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai', 'deepseek'] },
    ] }));
    await expect(res.json()).resolves.toMatchObject({ success: true, rules: [{ id: 'r1' }] });

    res = await POST(req('POST', { name: 'Reasoning', modelPattern: 'o1-*', providerOrder: ['openai'] }));
    await expect(res.json()).resolves.toMatchObject({ success: true, rule: { name: 'Reasoning' } });

    res = await GET(req('GET'));
    const body = await res.json();
    expect(body.rules).toHaveLength(2);
    expect(body.conflicts).toEqual([]);

    res = await DELETE(req('DELETE', { id: 'r1' }));
    await expect(res.json()).resolves.toMatchObject({ success: true });
    await expect(getPriorityRules()).resolves.toHaveLength(1);
  });
});
