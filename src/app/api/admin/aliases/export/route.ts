import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getModelAliasConfig } from '@/lib/admin/admin-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM_ALIASES: Record<string, string> = {
  'gpt-4': 'gpt-4-turbo',
  'gpt-3.5': 'gpt-3.5-turbo',
  'claude-3': 'claude-3-5-sonnet-20241022',
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-haiku': 'claude-3-5-haiku-20241022',
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-pro',
};

function esc(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function GET(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;
  const config = await getModelAliasConfig(true);
  const hidden = new Set(config.hidden);
  const rows = ['alias,target_model,hidden,note'];
  const merged = new Map<string, { target: string; note: string }>();
  for (const [alias, target] of Object.entries(SYSTEM_ALIASES)) {
    merged.set(alias, { target, note: '系统默认' });
  }
  for (const [alias, target] of Object.entries(config.aliases)) {
    merged.set(alias, { target, note: '用户自定义' });
  }
  for (const [alias, row] of Array.from(merged.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push([alias, row.target, hidden.has(row.target) ? 'true' : 'false', row.note].map(esc).join(','));
  }
  return new Response(`${rows.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ai-relay-models-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
