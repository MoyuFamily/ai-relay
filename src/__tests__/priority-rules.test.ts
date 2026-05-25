import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  __adminConfigCacheForTests,
  createMemoryMockKV,
  getPriorityRules,
  savePriorityRules,
} from '../lib/admin/admin-config';
import { detectPriorityRuleConflicts, normalizePriorityRules } from '../lib/admin/priority-rules-core';
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

    await expect(kv.get('relay:priority:rules')).resolves.toBeTruthy();
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

  it('detects overlapping model-pattern conflicts before save', () => {
    const conflicts = detectPriorityRuleConflicts([
      { id: 'a', name: 'Rule A', enabled: true, modelPattern: 'gpt-*', providerOrder: ['openai'] },
      { id: 'b', name: 'Rule B', enabled: true, modelPattern: 'gpt-4o', providerOrder: ['deepseek'] },
      { id: 'c', name: 'Rule C', enabled: true, modelPattern: 'o1-*', providerOrder: ['openai'] },
    ]);

    expect(conflicts).toEqual([
      expect.objectContaining({ ruleIds: ['a', 'b'], sampleModel: 'gpt-4o' }),
    ]);
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
