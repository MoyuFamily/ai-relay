import { NextRequest } from 'next/server';
import { requireAdminAuth } from '@/lib/admin';
import { getModelAliasConfig, saveModelAliasConfig } from '@/lib/admin/admin-config';
import { getAllProviders } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALIAS_RE = /^[a-z0-9_-]+$/;

type ImportMode = 'append' | 'overwrite';
type ImportRow = {
  line: number;
  alias: string;
  target_model: string;
  hidden: boolean;
  status: 'added' | 'updated' | 'skipped' | 'error';
  error?: string;
};

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

function jsonError(message: string, status = 400) {
  return Response.json({ error: { message } }, { status });
}

async function getRegisteredModels(): Promise<Set<string>> {
  const providers = await getAllProviders(true);
  const models = new Set<string>();
  for (const provider of Object.values(providers)) {
    for (const model of provider.models || []) models.add(model.id.toLowerCase());
  }
  return models;
}

export async function POST(request: NextRequest) {
  const authResponse = requireAdminAuth(request);
  if (authResponse) return authResponse;
  const form = await request.formData();
  const mode: ImportMode = String(form.get('mode') || 'append') === 'overwrite' ? 'overwrite' : 'append';
  const previewOnly = String(form.get('preview') || '').toLowerCase() === 'true';
  const file = form.get('file');
  if (!(file instanceof File)) {
    return jsonError('CSV file is required');
  }
  if (file.size > 50 * 1024) {
    return jsonError('CSV file is too large');
  }
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const emptyStats = { added: 0, updated: 0, skipped: 0, errors: 0 };
  if (lines.length <= 1) return Response.json({ success: true, preview: previewOnly, stats: emptyStats, rows: [], errors: [] });
  if (lines.length - 1 > 200) {
    return jsonError('最多 200 条');
  }

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const aliasIdx = header.indexOf('alias');
  const targetIdx = header.indexOf('target_model');
  const hiddenIdx = header.indexOf('hidden');
  if (aliasIdx < 0 || targetIdx < 0) {
    return jsonError('CSV must contain alias and target_model columns');
  }

  const existing = await getModelAliasConfig(true);
  const next = mode === 'overwrite' ? { aliases: {}, hidden: [] as string[] } : { aliases: { ...existing.aliases }, hidden: [...existing.hidden] };
  const hidden = new Set(next.hidden);
  const registeredModels = await getRegisteredModels();
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  const errors: Array<{ line: number; alias?: string; error: string }> = [];
  const stats = { ...emptyStats };

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const alias = (cells[aliasIdx] || '').trim().toLowerCase();
    const target = (cells[targetIdx] || '').trim();
    const isHidden = hiddenIdx >= 0 && /^true$/i.test(cells[hiddenIdx] || '');
    const line = i + 1;

    const fail = (message: string) => {
      stats.skipped++;
      stats.errors++;
      errors.push({ line, alias: alias || undefined, error: message });
      rows.push({ line, alias, target_model: target, hidden: isHidden, status: 'error' as const, error: message });
    };

    if (!ALIAS_RE.test(alias) || !target) { fail('格式错误'); continue; }
    if (!registeredModels.has(target.toLowerCase())) { fail('模型不存在'); continue; }
    if (seen.has(alias)) { fail('CSV 内重复'); continue; }
    seen.add(alias);
    if (mode === 'append' && existing.aliases[alias]) {
      stats.skipped++;
      stats.errors++;
      const message = '已存在';
      errors.push({ line, alias, error: message });
      rows.push({ line, alias, target_model: target, hidden: isHidden, status: 'skipped', error: message });
      continue;
    }

    const status = next.aliases[alias] ? 'updated' : 'added';
    if (status === 'updated') stats.updated++; else stats.added++;
    rows.push({ line, alias, target_model: target, hidden: isHidden, status });
    next.aliases[alias] = target;
    if (isHidden) hidden.add(target); else hidden.delete(target);
  }

  next.hidden = Array.from(hidden);
  if (!previewOnly) {
    await saveModelAliasConfig(next);
  }
  return Response.json({ success: true, preview: previewOnly, mode, stats, rows: rows.slice(0, 10), errors });
}
