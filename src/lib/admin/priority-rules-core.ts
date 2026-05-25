export interface PriorityRule {
  id: string;
  name: string;
  enabled: boolean;
  modelPattern: string;
  providerOrder: string[];
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PriorityRuleConflict {
  type: 'overlap' | 'duplicate' | 'shadow';
  severity: 'warning' | 'error';
  ruleIds: [string, string];
  ruleNames: [string, string];
  sampleModel: string;
  matchedModels: string[];
  message: string;
}

export const PRIORITY_RULE_LIMIT = 20;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePriorityRules(input: unknown): PriorityRule[] {
  if (!Array.isArray(input)) {
    throw new Error('Priority rules payload must be an array');
  }
  if (input.length > PRIORITY_RULE_LIMIT) {
    throw new Error(`Priority rules are limited to ${PRIORITY_RULE_LIMIT}`);
  }

  const now = new Date().toISOString();
  const ids = new Set<string>();
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new Error(`Invalid priority rule at index ${index}`);
    }
    const obj = raw as Record<string, unknown>;
    const id = cleanString(obj.id) || crypto.randomUUID();
    const name = cleanString(obj.name) || `Rule ${index + 1}`;
    const modelPattern = cleanString(obj.modelPattern).toLowerCase();
    const providerOrder = Array.isArray(obj.providerOrder)
      ? obj.providerOrder.map(cleanString).filter(Boolean)
      : [];

    if (ids.has(id)) throw new Error(`Duplicate priority rule id: ${id}`);
    ids.add(id);
    if (!modelPattern) throw new Error(`Model pattern is required for rule: ${name}`);
    if (providerOrder.length === 0) throw new Error(`Provider order is required for rule: ${name}`);

    return {
      id,
      name,
      enabled: obj.enabled !== false,
      modelPattern,
      providerOrder: Array.from(new Set(providerOrder)),
      description: cleanString(obj.description) || undefined,
      createdAt: cleanString(obj.createdAt) || now,
      updatedAt: now,
    };
  });
}

export function matchesPriorityPattern(model: string, pattern: string): boolean {
  const normalizedModel = model.toLowerCase();
  const normalizedPattern = pattern.toLowerCase().trim();
  if (!normalizedPattern) return false;
  if (normalizedPattern === '*') return true;

  const hasGlob = /[*?]/.test(normalizedPattern);
  if (!hasGlob) {
    return normalizedModel.startsWith(normalizedPattern);
  }

  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`).test(normalizedModel);
}

function sampleForPattern(pattern: string): string {
  const p = pattern.toLowerCase().trim();
  if (!p || p === '*') return 'gpt-4o';
  return p.includes('*') ? p.replace(/\*/g, '4o') : p;
}

function patternSpecificity(pattern: string): number {
  return pattern.replace(/\*/g, '').length;
}

function sameProviderOrder(a: PriorityRule, b: PriorityRule): boolean {
  return a.providerOrder.length === b.providerOrder.length && a.providerOrder.every((provider, index) => provider === b.providerOrder[index]);
}

function classifyConflict(a: PriorityRule, b: PriorityRule, sample: string): Pick<PriorityRuleConflict, 'type' | 'severity' | 'message'> {
  if (a.modelPattern === b.modelPattern && !sameProviderOrder(a, b)) {
    return {
      type: 'duplicate',
      severity: 'error',
      message: `规则重复：${a.name} 和 ${b.name} 使用相同条件但目标供应商不同`,
    };
  }

  const type: PriorityRuleConflict['type'] = sameProviderOrder(a, b) ? 'shadow' : 'overlap';
  const shadowText = type === 'shadow' ? `${b.name} 可能被 ${a.name} 覆盖，` : '';
  return {
    type,
    severity: 'warning',
    message: `${shadowText}${a.name} 和 ${b.name} 的条件存在交集，${sample} 将按 ${a.name} 的优先级执行`,
  };
}

function patternsOverlap(a: string, b: string): string | null {
  const candidates = Array.from(new Set([
    sampleForPattern(a),
    sampleForPattern(b),
    'gpt-4o',
    'gpt-4o-mini',
    'o1-mini',
    'o3-mini',
    'deepseek-chat',
    'claude-3-5-sonnet',
  ]));
  return candidates.find((candidate) => matchesPriorityPattern(candidate, a) && matchesPriorityPattern(candidate, b)) || null;
}

export function detectPriorityRuleConflicts(rules: PriorityRule[]): PriorityRuleConflict[] {
  const enabled = rules.filter((rule) => rule.enabled);
  const conflicts: PriorityRuleConflict[] = [];
  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const sample = patternsOverlap(enabled[i].modelPattern, enabled[j].modelPattern);
      if (!sample) continue;
      const classification = classifyConflict(enabled[i], enabled[j], sample);
      conflicts.push({
        ...classification,
        ruleIds: [enabled[i].id, enabled[j].id],
        ruleNames: [enabled[i].name, enabled[j].name],
        sampleModel: sample,
        matchedModels: [sample],
      });
    }
  }
  return conflicts;
}

export function hasBlockingPriorityRuleConflicts(conflicts: PriorityRuleConflict[]): boolean {
  return conflicts.some((conflict) => conflict.severity === 'error');
}

export function reorderPriorityRules(rules: PriorityRule[], orderedIds: string[]): PriorityRule[] {
  if (orderedIds.length !== rules.length) {
    throw new Error('orderedIds must include every priority rule id');
  }
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const seen = new Set<string>();
  return orderedIds.map((id) => {
    const rule = byId.get(id);
    if (!rule) throw new Error(`Unknown priority rule id: ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate priority rule id in orderedIds: ${id}`);
    seen.add(id);
    return rule;
  });
}

export function findMatchingPriorityRule(rules: PriorityRule[], model: string): PriorityRule | null {
  return rules.find((rule) => rule.enabled && matchesPriorityPattern(model, rule.modelPattern)) || null;
}
