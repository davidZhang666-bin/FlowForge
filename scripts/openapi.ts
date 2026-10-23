import { mkdirSync, writeFileSync } from 'node:fs';
import { openApiDocument } from '../packages/contracts/src/openapi.js';
import { format, resolveConfig } from 'prettier';
mkdirSync('docs', { recursive: true });
writeFileSync(
  'docs/openapi.json',
  await format(JSON.stringify(openApiDocument()), {
    ...(await resolveConfig('.')),
    parser: 'json',
  }),
);
