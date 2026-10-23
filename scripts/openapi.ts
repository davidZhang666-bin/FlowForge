import { mkdirSync, writeFileSync } from 'node:fs';
import { openApiDocument } from '../packages/contracts/src/openapi.js';
mkdirSync('docs', { recursive: true });
writeFileSync('docs/openapi.json', `${JSON.stringify(openApiDocument(), null, 2)}\n`);
