import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluateRule, validateRule } from './rules.js';
import type { Rule } from '../../contracts/src/index.js';

describe('declarative rules', () => {
  it('bounds complexity and treats invalid and absent values as non-matches', () => {
    let rule: Rule = { op: 'eq', field: 'type', value: 'LEAVE' };
    for (let i = 0; i < 10; i++) rule = { op: 'not', rule };
    expect(validateRule(rule)).toContain('条件嵌套不能超过 8 层');
    expect(evaluateRule(rule, {})).toBe(false);
    expect(evaluateRule({ op: 'eq', field: 'unknown', value: 'x' }, {})).toBe(false);
    expect(evaluateRule({ op: 'eq', field: 'type', value: 'LEAVE' }, { type: null })).toBe(false);
    expect(evaluateRule({ op: 'in', field: 'type', value: ['LEAVE'] }, { type: 1 })).toBe(false);
    for (const op of ['gt', 'gte', 'lt', 'lte'] as const)
      expect(evaluateRule({ op, field: 'amountCents', value: 2 }, { amountCents: '3' })).toBe(
        false,
      );
  });
  it.each([
    ['eq', 10, true],
    ['ne', 10, false],
    ['gt', 9, true],
    ['gte', 10, true],
    ['lt', 11, true],
    ['lte', 10, true],
  ] as const)('%s numeric boundary', (op, value, expected) => {
    expect(evaluateRule({ op, field: 'amountCents', value }, { amountCents: 10 })).toBe(expected);
  });
  it('supports nested boolean conditions and department membership', () => {
    expect(
      evaluateRule(
        {
          op: 'all',
          rules: [
            { op: 'in', field: 'departmentId', value: ['sales'] },
            { op: 'not', rule: { op: 'eq', field: 'type', value: 'LEAVE' } },
          ],
        },
        { departmentId: 'sales', type: 'EXPENSE' },
      ),
    ).toBe(true);
    expect(
      evaluateRule(
        {
          op: 'any',
          rules: [
            { op: 'eq', field: 'type', value: 'LEAVE' },
            { op: 'eq', field: 'priority', value: 'HIGH' },
          ],
        },
        { type: 'EXPENSE', priority: 'HIGH' },
      ),
    ).toBe(true);
  });
  it('rejects fields, operands and types outside the DSL', () => {
    expect(validateRule({ op: 'eq', field: '__proto__', value: 'x' })).not.toHaveLength(0);
    expect(validateRule({ op: 'gt', field: 'type', value: 'X' })).not.toHaveLength(0);
    expect(validateRule({ op: 'in', field: 'amountCents', value: ['1'] })).not.toHaveLength(0);
    expect(validateRule({ op: 'eq', field: 'amountCents', value: '1' })).not.toHaveLength(0);
    expect(evaluateRule({ op: 'ne', field: 'type', value: 'X' }, {})).toBe(false);
    expect(evaluateRule({ op: 'gt', field: 'amountCents', value: 1 }, { amountCents: '2' })).toBe(
      false,
    );
  });
  it('is deterministic across generated amounts', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1e9 }),
        fc.integer({ min: 0, max: 1e9 }),
        (amount, threshold) =>
          evaluateRule(
            { op: 'gte', field: 'amountCents', value: threshold },
            { amountCents: amount },
          ) ===
          amount >= threshold,
      ),
    );
  });
});
