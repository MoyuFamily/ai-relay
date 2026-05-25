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
  ruleIds: [string, string];
  ruleNames: [string, string];
  sampleModel: string;
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
  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(normalizedModel);
}

function sampleForPattern(pattern: string): string {
  const p = pattern.toLowerCase().trim();
  if (!p || p === '*') return 'gpt-4o';
  return p.includes('*') ? p.replace(/\*/g, '4o') : p;
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
      conflicts.push({
        ruleIds: [enabled[i].id, enabled[j].id],
        ruleNames: [enabled[i].name, enabled[j].name],
        sampleModel: sample,
        message: `${enabled[i].name} 和 ${enabled[j].name} 的条件存在交集，${sample} 将按 ${enabled[i].name} 的优先级执行`,
      });
    }
  }
  return conflicts;
}

export function findMatchingPriorityRule(rules: PriorityRule[], model: string): PriorityRule | null {
  return rules.find((rule) => rule.enabled && matchesPriorityPattern(model, rule.modelPattern)) || null;
}
