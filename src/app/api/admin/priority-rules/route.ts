// ============================================================
// AI API Relay — Admin: Priority Rules API
// GET/PUT/POST/DELETE /api/admin/priority-rules
// ============================================================

import { NextRequest } from 'next/server';
import { requireAdminAuth, getPriorityRules, savePriorityRules } from '@/lib/admin';
import { detectPriorityRuleConflicts } from '@/lib/admin/priority-rules-core';

export const runtime = 'nodejs';

function error(message: string, status = 400) {
  return Response.json({ error: { message, code: status } }, { status });
}

export async function GET(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
  const rules = await getPriorityRules(forceRefresh);
  return Response.json({ rules, conflicts: detectPriorityRuleConflicts(rules), limit: 20 });
}

export async function PUT(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;
  try {
    const body = await request.json();
    const rules = await savePriorityRules(body.rules);
    return Response.json({ success: true, rules, conflicts: detectPriorityRuleConflicts(rules), limit: 20 });
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to save priority rules');
  }
}

export async function POST(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;
  try {
    const body = await request.json();
    const existing = await getPriorityRules(true);
    const rules = await savePriorityRules([...existing, body]);
    const rule = rules[rules.length - 1];
    return Response.json({ success: true, rule, rules, conflicts: detectPriorityRuleConflicts(rules), limit: 20 });
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to create priority rule');
  }
}

export async function DELETE(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;
  try {
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return error('Priority rule id is required');
    const existing = await getPriorityRules(true);
    const rules = existing.filter((rule) => rule.id !== id);
    if (rules.length === existing.length) return error(`Priority rule not found: ${id}`, 404);
    const saved = await savePriorityRules(rules);
    return Response.json({ success: true, rules: saved, conflicts: detectPriorityRuleConflicts(saved), limit: 20 });
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to delete priority rule');
  }
}
