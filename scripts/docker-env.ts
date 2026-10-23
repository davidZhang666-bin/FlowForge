import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
writeFileSync(
  '.env.docker',
  `DB_ADMIN_PASSWORD=${randomBytes(24).toString('hex')}\nDB_APP_PASSWORD=${randomBytes(24).toString('hex')}\nWEB_ORIGIN=http://localhost:8080\nWEB_BIND_PORT=8080\n`,
  { flag: 'wx', mode: 0o600 },
);
console.log(
  'Created .env.docker with random database credentials; existing files are never replaced.',
);
