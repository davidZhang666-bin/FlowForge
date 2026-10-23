import { expect, it } from 'vitest';
import { openApiDocument } from './openapi.js';
import { readFileSync } from 'node:fs';

it('resolves every local schema reference including recursive branch rules', () => {
  const document = openApiDocument();
  let references = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.$ref === 'string') {
      expect(record.$ref.startsWith('#/')).toBe(true);
      const target = record.$ref
        .slice(2)
        .split('/')
        .reduce<unknown>(
          (node, part) =>
            (node as Record<string, unknown> | undefined)?.[
              part.replace(/~1/g, '/').replace(/~0/g, '~')
            ],
          document,
        );
      expect(target, record.$ref).toBeDefined();
      references++;
    }
    Object.values(record).forEach(visit);
  };
  visit(document);
  expect(references).toBeGreaterThan(10);
  expect(document.paths['/tenants/{tenantId}/audit']).toHaveProperty('get');
});

it('keeps the checked-in API artifact synchronized with the runtime document', () => {
  expect(JSON.parse(readFileSync('docs/openapi.json', 'utf8'))).toEqual(openApiDocument());
});
