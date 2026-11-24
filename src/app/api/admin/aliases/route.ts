import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getModelAliasConfig, saveModelAliasConfig } from '@/lib/admin/admin-config';
import { getAllProviders } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AliasRow = { target: string; source: 'system' | 'user' };

const SYSTEM_ALIASES: Record<string, string> = {
  'gpt-best': 'gpt-6.2-astra',
  'gpt-latest': 'gpt-6.2-sol',
  'gpt-fast': 'gpt-6-luna',
  'claude-best': 'claude-fable-5-2',
  'claude-opus': 'claude-opus-5-5',
  'claude-sonnet': 'claude-sonnet-5-5',
  'claude-fast': 'claude-haiku-5-5',
  'gemini-best': 'gemini-4-neon',
  'gemini-latest': 'gemini-4-argon',
  'gemini-fast': 'gemini-4-hydrogen',
  'deepseek-fast': 'deepseek-flash',
  'deepseek-pro': 'deepseek-v4-pro',
};

const ALIAS_RE = /^[a-z0-9_-]+$/;

function error(message: string, status = 400) {
  return Response.json({ error: { message } }, { status });
}

function normalizeAlias(alias: unknown): string {
  return String(alias || '').trim().toLowerCase();
}

function validateAlias(alias: string): string | null {
  if (!alias) return 'Alias is required';
  if (!ALIAS_RE.test(alias)) return 'Alias must contain only a-z, 0-9, - or _';
  return null;
}

async function isRegisteredModel(target: string): Promise<boolean> {
  const lower = target.toLowerCase();
  const providers = await getAllProviders(true);
  return Object.values(providers).some((provider) => {
    if (provider.models?.some((model) => model.id.toLowerCase() === lower)) return true;
    return provider.modelPrefixes.some((prefix) => {
      const isWildcard = prefix.endsWith('-') || prefix.endsWith('.') || prefix.endsWith('_');
      if (isWildcard) {
        return lower.startsWith(prefix);
      }
      return lower === prefix;
    });
  });
}

async function responsePayload() {
  const config = await getModelAliasConfig(true);
  const aliases: Record<string, AliasRow> = {};
  for (const [alias, target] of Object.entries(SYSTEM_ALIASES)) {
    aliases[alias] = { target, source: 'system' };
  }
  for (const [alias, target] of Object.entries(config.aliases)) {
    aliases[alias] = { target, source: 'user' };
  }
  return { aliases, hidden: config.hidden, total: Object.keys(aliases).length };
}

export async function GET(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;
  return Response.json(await responsePayload(), { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}

export async function PUT(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;
  const body = await request.json();
  const inputAliases = body.aliases || {};
  const aliases: Record<string, string> = {};
  for (const [rawAlias, rawTarget] of Object.entries(inputAliases)) {
    const alias = normalizeAlias(rawAlias);
    const validation = validateAlias(alias);
    if (validation) return error(validation);
    const target = String(rawTarget || '').trim();
    if (!target) return error(`Target model is required for alias ${alias}`);
    if (!(await isRegisteredModel(target))) return error('Target model does not exist');
    aliases[alias] = target;
  }
  if (Object.keys(aliases).length > 200) return error('Aliases are limited to 200 entries');
  const config = await saveModelAliasConfig({ aliases, hidden: Array.isArray(body.hidden) ? body.hidden : [] });
  return Response.json({ success: true, ...config });
}

export async function POST(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;
  const body = await request.json();
  const alias = normalizeAlias(body.alias);
  const validation = validateAlias(alias);
  if (validation) return error(validation);
  const target = String(body.target || body.target_model || '').trim();
  if (!target) return error('Target model is required');
  if (!(await isRegisteredModel(target))) return error('Target model does not exist');
  const config = await getModelAliasConfig(true);
  if (!config.aliases[alias] && Object.keys(config.aliases).length >= 200) return error('Aliases are limited to 200 entries');
  config.aliases[alias] = target;
  if (body.hidden === true) config.hidden = Array.from(new Set([...config.hidden, target]));
  const saved = await saveModelAliasConfig(config);
  return Response.json({ success: true, alias: { alias, target, source: 'user' }, hidden: saved.hidden });
}

export async function DELETE(request: NextRequest) {
  const authResponse = await requireAdminAuth(request);
  if (authResponse) return authResponse;
  const alias = normalizeAlias(new URL(request.url).searchParams.get('alias'));
  const validation = validateAlias(alias);
  if (validation) return error(validation);
  if (SYSTEM_ALIASES[alias]) return error('System aliases cannot be deleted');
  const config = await getModelAliasConfig(true);
  delete config.aliases[alias];
  await saveModelAliasConfig(config);
  return Response.json({ success: true });
}
