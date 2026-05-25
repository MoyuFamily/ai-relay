export type PriorityRuleConditionField = 'model_prefix' | 'model_exact' | 'request_source' | 'header';
export type PriorityRuleConditionOperator = 'equals' | 'starts_with' | 'ends_with' | 'contains' | 'regex';

export interface PriorityRuleCondition {
  field: PriorityRuleConditionField;
  operator: PriorityRuleConditionOperator;
  value: string;
}

export interface PriorityRule {
  id: string;
  name: string;
  priority?: number;
  enabled: boolean;
  provider?: string;
  conditions?: PriorityRuleCondition[];
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
export const PRIORITY_RULE_CONDITION_LIMIT = 5;

const conditionFields = new Set<PriorityRuleConditionField>(['model_prefix', 'model_exact', 'request_source', 'header']);
const conditionOperators = new Set<PriorityRuleConditionOperator>(['equals', 'starts_with', 'ends_with', 'contains', 'regex']);

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function conditionToModelPattern(condition: PriorityRuleCondition): string | null {
  if (condition.field === 'model_prefix') {
    if (condition.operator === 'equals' || condition.operator === 'starts_with') return condition.value.endsWith('-') ? `${condition.value}*` : condition.value;
    if (condition.operator === 'contains') return `*${condition.value}*`;
  }
  if (condition.field === 'model_exact' && condition.operator === 'equals') return condition.value;
  return null;
}

function normalizeCondition(raw: unknown, ruleName: string): PriorityRuleCondition {
  if (!raw || typeof raw !== 'object') throw new Error(`Invalid priority rule condition for rule: ${ruleName}`);
  const obj = raw as Record<string, unknown>;
  const field = cleanString(obj.field) as PriorityRuleConditionField;
  const operator = cleanString(obj.operator) as PriorityRuleConditionOperator;
  const value = cleanString(obj.value);
  if (!conditionFields.has(field)) throw new Error(`Invalid condition field for rule: ${ruleName}`);
  if (!conditionOperators.has(operator)) throw new Error(`Invalid condition operator for rule: ${ruleName}`);
  if (!value) throw new Error(`Condition value is required for rule: ${ruleName}`);
  if (operator === 'regex') {
    try {
      new RegExp(value);
    } catch {
      throw new Error(`Invalid regex condition for rule: ${ruleName}`);
    }
  }
  return { field, operator, value: value.toLowerCase() };
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
    const conditions = Array.isArray(obj.conditions)
      ? obj.conditions.map((condition) => normalizeCondition(condition, name))
      : undefined;
    if (conditions && conditions.length > PRIORITY_RULE_CONDITION_LIMIT) {
      throw new Error(`Priority rule conditions are limited to ${PRIORITY_RULE_CONDITION_LIMIT}`);
    }
    let modelPattern = cleanString(obj.modelPattern).toLowerCase();
    if (!modelPattern && conditions) {
      modelPattern = conditions.map(conditionToModelPattern).find((pattern): pattern is string => Boolean(pattern)) || '';
    }
    const provider = cleanString(obj.provider);
    const providerOrder = Array.isArray(obj.providerOrder)
      ? obj.providerOrder.map(cleanString).filter(Boolean)
      : provider ? [provider] : [];

    if (ids.has(id)) throw new Error(`Duplicate priority rule id: ${id}`);
    ids.add(id);
    if (!modelPattern) throw new Error(`Model pattern is required for rule: ${name}`);
    if (providerOrder.length === 0) throw new Error(`Provider order is required for rule: ${name}`);

    const priority = Number(obj.priority) > 0 ? Number(obj.priority) : index + 1;
    return {
      id,
      name,
      priority,
      enabled: obj.enabled !== false,
      provider: provider || providerOrder[0],
      conditions,
      modelPattern,
      providerOrder: Array.from(new Set(providerOrder)),
      description: cleanString(obj.description) || undefined,
      createdAt: cleanString(obj.createdAt) || now,
      updatedAt: now,
    };
  }).sort((a, b) => (a.priority || 0) - (b.priority || 0)).map((rule, index) => ({ ...rule, priority: index + 1 }));
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
  if (!p.includes('*')) return p;
  return p.replace(/\*/g, (match, offset) => (p[offset - 1] === '-' ? '4o' : ''));
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
    sampleForPattern(b),
    sampleForPattern(a),
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
  return orderedIds.map((id, index) => {
    const rule = byId.get(id);
    if (!rule) throw new Error(`Unknown priority rule id: ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate priority rule id in orderedIds: ${id}`);
    seen.add(id);
    return { ...rule, priority: index + 1 };
  });
}

export interface PriorityRuleMatchContext {
  requestSource?: string;
  headers?: Record<string, string | string[] | undefined>;
}

function getConditionFieldValue(condition: PriorityRuleCondition, model: string, context: PriorityRuleMatchContext): string {
  if (condition.field === 'model_prefix' || condition.field === 'model_exact') return model;
  if (condition.field === 'request_source') return (context.requestSource || '').toLowerCase();
  const wanted = condition.value.includes(':') ? condition.value.split(':', 1)[0].trim().toLowerCase() : '';
  if (!wanted) return Object.entries(context.headers || {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(',') : value || ''}`).join('\n').toLowerCase();
  const found = Object.entries(context.headers || {}).find(([key]) => key.toLowerCase() === wanted);
  return found ? `${found[0]}: ${Array.isArray(found[1]) ? found[1].join(',') : found[1] || ''}`.toLowerCase() : '';
}

function conditionMatches(condition: PriorityRuleCondition, model: string, context: PriorityRuleMatchContext): boolean {
  const actual = getConditionFieldValue(condition, model.toLowerCase(), context);
  const expected = condition.value.toLowerCase();
  switch (condition.operator) {
    case 'equals': return actual === expected || (condition.field === 'header' && actual === expected);
    case 'starts_with': return actual.startsWith(expected);
    case 'ends_with': return actual.endsWith(expected);
    case 'contains': return actual.includes(expected);
    case 'regex': return new RegExp(expected).test(actual);
  }
}

function ruleMatches(rule: PriorityRule, model: string, context: PriorityRuleMatchContext): boolean {
  if (rule.conditions && rule.conditions.length > 0) {
    return rule.conditions.every((condition) => conditionMatches(condition, model, context));
  }
  return matchesPriorityPattern(model, rule.modelPattern);
}

export function findMatchingPriorityRule(rules: PriorityRule[], model: string, context: PriorityRuleMatchContext = {}): PriorityRule | null {
  return rules.find((rule) => rule.enabled && ruleMatches(rule, model, context)) || null;
}
