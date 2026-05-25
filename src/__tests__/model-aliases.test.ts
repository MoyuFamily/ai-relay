import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  __adminConfigCacheForTests,
  createMemoryMockKV,
  getModelAliasConfig,
  saveModelAliasConfig,
} from '../lib/admin/admin-config';
import { resolveModelAlias } from '../lib/providers/resolver';
import { GET as modelsGET } from '../app/v1/models/route';
import { GET, PUT, POST, DELETE } from '../app/api/admin/aliases/route';
import { POST as importPOST } from '../app/api/admin/aliases/import/route';
import { GET as exportGET } from '../app/api/admin/aliases/export/route';

function installMockKV() {
  const mock = createMemoryMockKV();
  (global as any)._mockKVInstance = mock;
  (global as any)._mockKVInstance._isMock = true;
  return mock;
}

function req(method: string, body?: unknown, url = 'http://localhost/api/admin/aliases') {
  return new NextRequest(url, {
    method,
    headers: {
      Authorization: 'Bearer admin-test-key',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function csvReq(csv: string, mode = 'append') {
  const form = new FormData();
  form.set('mode', mode);
  form.set('file', new File([csv], 'aliases.csv', { type: 'text/csv' }));
  return new NextRequest('http://localhost/api/admin/aliases/import', {
    method: 'POST',
    headers: { Authorization: 'Bearer admin-test-key' },
    body: form,
  });
}

describe('model aliases admin config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('RELAY_ADMIN_KEY', 'admin-test-key');
    __adminConfigCacheForTests.clear();
    installMockKV();
  });

  it('persists aliases and hidden models at relay:models:aliases with a 5 minute read cache', async () => {
    const kv = installMockKV();
    const originalGet = kv.get.bind(kv);
    kv.get = vi.fn((key: string) => originalGet(key));

    await saveModelAliasConfig({ aliases: { fast: 'gpt-4o-mini' }, hidden: ['davinci-002'] });

    await expect(kv.get('relay:models:aliases')).resolves.toBeTruthy();
    vi.mocked(kv.get).mockClear();
    await expect(getModelAliasConfig()).resolves.toMatchObject({ aliases: { fast: 'gpt-4o-mini' }, hidden: ['davinci-002'] });
    await expect(getModelAliasConfig()).resolves.toMatchObject({ aliases: { fast: 'gpt-4o-mini' } });
    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('resolves user aliases from KV before falling back to system aliases', async () => {
    await saveModelAliasConfig({ aliases: { fast: 'gpt-4o-mini', 'gpt-4': 'gpt-4o' }, hidden: [] });

    await expect(resolveModelAlias('FAST')).resolves.toBe('gpt-4o-mini');
    await expect(resolveModelAlias('gpt-4')).resolves.toBe('gpt-4o');
    await expect(resolveModelAlias('claude-3')).resolves.toBe('claude-3-5-sonnet-20241022');
  });

  it('rejects aliases whose target model is not registered in any provider', async () => {
    const res = await POST(req('POST', { alias: 'ghost', target: 'not-a-real-model' }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: { message: 'Target model does not exist' } });
  });

  it('resolves alias chains and stops cyclic aliases at a safe depth', async () => {
    await saveModelAliasConfig({
      aliases: {
        fast: 'smart',
        smart: 'gpt-4o-mini',
        loop_a: 'loop_b',
        loop_b: 'loop_a',
      },
      hidden: [],
    });

    await expect(resolveModelAlias('fast')).resolves.toBe('gpt-4o-mini');
    await expect(resolveModelAlias('loop_a')).resolves.toBe('loop_a');
  });

  it('exposes CRUD API for model aliases and rejects invalid aliases', async () => {
    let res = await POST(req('POST', { alias: 'Fast_Model', target: 'gpt-4o-mini', hidden: false }));
    await expect(res.json()).resolves.toMatchObject({ success: true, alias: { alias: 'fast_model', target: 'gpt-4o-mini', source: 'user' } });

    res = await POST(req('POST', { alias: 'bad alias', target: 'gpt-4o-mini' }));
    expect(res.status).toBe(400);

    res = await PUT(req('PUT', { aliases: { smart: 'claude-3-5-sonnet-20241022' }, hidden: ['davinci-002'] }));
    await expect(res.json()).resolves.toMatchObject({ success: true, hidden: ['davinci-002'] });

    res = await GET(req('GET'));
    const body = await res.json();
    expect(body.aliases.smart).toMatchObject({ target: 'claude-3-5-sonnet-20241022', source: 'user' });
    expect(body.total).toBeGreaterThan(0);

    res = await DELETE(req('DELETE', undefined, 'http://localhost/api/admin/aliases?alias=smart'));
    await expect(res.json()).resolves.toMatchObject({ success: true });
    await expect(getModelAliasConfig()).resolves.toMatchObject({ aliases: {} });
  });

  it('imports and exports CSV with alias targets and hidden flags', async () => {
    const csv = 'alias,target_model,hidden,note\nfast,gpt-4o-mini,false,team\nlegacy,gpt-3.5-turbo,true,old\n';

    const importRes = await importPOST(csvReq(csv));
    await expect(importRes.json()).resolves.toMatchObject({ success: true, stats: { added: 2, errors: 0 } });

    const exportRes = await exportGET(req('GET', undefined, 'http://localhost/api/admin/aliases/export'));
    expect(exportRes.headers.get('content-type')).toContain('text/csv');
    const exported = await exportRes.text();
    expect(exported).toContain('alias,target_model,hidden,note');
    expect(exported).toContain('fast,gpt-4o-mini,false,');
    expect(exported).toContain('legacy,gpt-3.5-turbo,true,');
  });

  it('filters hidden models from /v1/models without disabling direct alias resolution', async () => {
    await saveModelAliasConfig({ aliases: { legacy: 'davinci-002' }, hidden: ['davinci-002'] });

    const res = await modelsGET(new NextRequest('http://localhost/v1/models'));
    const body = await res.json();
    expect(body.data.some((model: { id: string }) => model.id === 'davinci-002')).toBe(false);
    await expect(resolveModelAlias('legacy')).resolves.toBe('davinci-002');
  });
});
