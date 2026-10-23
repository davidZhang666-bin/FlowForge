import type { Rule } from '../../contracts/src/index.js';

export const ruleFields: Record<string, 'string' | 'number'> = {
  amountCents: 'number', leaveMinutes: 'number', departmentId: 'string', type: 'string', priority: 'string',
};
export function validateRule(rule: Rule, depth = 0): string[] {
  if (depth > 8) return ['条件嵌套不能超过 8 层'];
  if (rule.op === 'all' || rule.op === 'any') return rule.rules.flatMap(r => validateRule(r, depth + 1));
  if (rule.op === 'not') return validateRule(rule.rule, depth + 1);
  if (!('field' in rule)) return ['未知条件'];
  const type = ruleFields[rule.field];
  if (!type) return [`不支持的条件字段：${rule.field}`];
  if (rule.op === 'in') return Array.isArray(rule.value) && type === 'string' ? [] : ['in 仅支持字符串字段和字符串数组'];
  if (Array.isArray(rule.value) || typeof rule.value !== type) return [`${rule.field} 条件值类型不匹配`];
  if (['gt', 'gte', 'lt', 'lte'].includes(rule.op) && type !== 'number') return ['大小比较仅支持数值字段'];
  return [];
}

/** Total, deterministic evaluator: fields are whitelisted and no expression is executed. */
export function evaluateRule(rule: Rule, input: Record<string, unknown>): boolean {
  if (validateRule(rule).length) return false;
  if (rule.op === 'all') return rule.rules.every(r => evaluateRule(r, input));
  if (rule.op === 'any') return rule.rules.some(r => evaluateRule(r, input));
  if (rule.op === 'not') return !evaluateRule(rule.rule, input);
  if (!('field' in rule)) return false;
  const actual = input[rule.field];
  if (actual === undefined || actual === null) return false;
  switch (rule.op) {
    case 'eq': return actual === rule.value;
    case 'ne': return actual !== rule.value;
    case 'in': return Array.isArray(rule.value) && typeof actual === 'string' && rule.value.includes(actual);
    case 'gt': return typeof actual === 'number' && typeof rule.value === 'number' && actual > rule.value;
    case 'gte': return typeof actual === 'number' && typeof rule.value === 'number' && actual >= rule.value;
    case 'lt': return typeof actual === 'number' && typeof rule.value === 'number' && actual < rule.value;
    case 'lte': return typeof actual === 'number' && typeof rule.value === 'number' && actual <= rule.value;
  }
}
