import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getModelAliasConfig } from '@/lib/admin/admin-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function esc(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function GET(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;
  const config = await getModelAliasConfig(true);
  const hidden = new Set(config.hidden);
  const rows = ['alias,target_model,hidden,note'];
  for (const [alias, target] of Object.entries(config.aliases).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push([alias, target, hidden.has(target) ? 'true' : 'false', ''].map(esc).join(','));
  }
  return new Response(`${rows.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="ai-relay-models-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
