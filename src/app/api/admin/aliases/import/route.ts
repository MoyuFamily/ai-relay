import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getModelAliasConfig, saveModelAliasConfig } from '@/lib/admin/admin-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALIAS_RE = /^[a-z0-9_-]+$/;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { cells.push(current); current = ''; continue; }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

export async function POST(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;
  const form = await request.formData();
  const mode = String(form.get('mode') || 'append');
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: { message: 'CSV file is required' } }, { status: 400 });
  }
  if (file.size > 50 * 1024) {
    return Response.json({ error: { message: 'CSV file is too large' } }, { status: 400 });
  }
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length <= 1) return Response.json({ success: true, stats: { added: 0, updated: 0, skipped: 0, errors: 0 }, errors: [] });
  if (lines.length - 1 > 200) {
    return Response.json({ error: { message: '最多 200 条' } }, { status: 400 });
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const aliasIdx = header.indexOf('alias');
  const targetIdx = header.indexOf('target_model');
  const hiddenIdx = header.indexOf('hidden');
  if (aliasIdx < 0 || targetIdx < 0) {
    return Response.json({ error: { message: 'CSV must contain alias and target_model columns' } }, { status: 400 });
  }

  const existing = await getModelAliasConfig(true);
  const next = mode === 'overwrite' ? { aliases: {}, hidden: [] as string[] } : { aliases: { ...existing.aliases }, hidden: [...existing.hidden] };
  const hidden = new Set(next.hidden);
  const seen = new Set<string>();
  const errors: Array<{ line: number; error: string }> = [];
  let added = 0, updated = 0, skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const alias = (cells[aliasIdx] || '').toLowerCase();
    const target = cells[targetIdx] || '';
    const isHidden = hiddenIdx >= 0 && /^true$/i.test(cells[hiddenIdx] || '');
    if (!ALIAS_RE.test(alias) || !target) { errors.push({ line: i + 1, error: 'invalid alias or target_model' }); skipped++; continue; }
    if (seen.has(alias)) { errors.push({ line: i + 1, error: 'duplicate alias' }); skipped++; continue; }
    seen.add(alias);
    if (mode === 'append' && existing.aliases[alias]) { skipped++; continue; }
    if (next.aliases[alias]) updated++; else added++;
    next.aliases[alias] = target;
    if (isHidden) hidden.add(target); else hidden.delete(target);
  }

  next.hidden = Array.from(hidden);
  await saveModelAliasConfig(next);
  return Response.json({ success: true, stats: { added, updated, skipped, errors: errors.length }, errors });
}
