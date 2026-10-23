import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import pg from 'pg';

mkdirSync('.local', { recursive: true });
if (!existsSync('.env')) {
  const admin = randomBytes(24).toString('hex');
  const app = randomBytes(24).toString('hex');
  writeFileSync(
    '.env',
    `DB_ADMIN_PASSWORD=${admin}\nDB_APP_PASSWORD=${app}\nDB_PORT=55432\nDATABASE_ADMIN_URL=postgresql://postgres:${admin}@127.0.0.1:55432/flowforge\nDATABASE_URL=postgresql://ff_app:${app}@127.0.0.1:55432/flowforge\nWEB_ORIGIN=http://localhost:5173\nPORT=3100\nDEMO_PASSWORD=FlowForge2026!\n`,
    { mode: 0o600 },
  );
}
config({ quiet: true });
const url = process.env.DATABASE_ADMIN_URL;
if (!url) throw new Error('DATABASE_ADMIN_URL is required');
const server = new URL(url);
server.pathname = '/postgres';
async function connect(): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: server.toString(),
    connectionTimeoutMillis: 1000,
  });
  await client.connect();
  return client;
}
let admin: pg.Client;
try {
  admin = await connect();
} catch {
  if (!['127.0.0.1', 'localhost'].includes(server.hostname))
    throw new Error('External database unavailable');
  const log = openSync('.local/postgres.log', 'a');
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/local-db.ts'], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  child.unref();
  let connected: pg.Client | undefined;
  for (let attempt = 0; attempt < 400; attempt++) {
    if (child.exitCode !== null) break;
    try {
      connected = await connect();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  if (!connected) {
    let tail = ['.local/postgres.log', '.local/postgres-server.log']
      .filter(existsSync)
      .map((path) => readFileSync(path, 'utf8').slice(-4000))
      .join('\n');
    for (const secret of [process.env.DB_ADMIN_PASSWORD, process.env.DB_APP_PASSWORD])
      if (secret) tail = tail.replaceAll(secret, '[redacted]');
    throw new Error(`Local PostgreSQL did not start; recent database log:\n${tail}`);
  }
  admin = connected;
}
const databaseName = new URL(url).pathname.slice(1);
if (!/^[a-z][a-z0-9_]{0,62}$/.test(databaseName))
  throw new Error('Database name must be a simple lowercase identifier');
const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
if (!found.rowCount) await admin.query(`CREATE DATABASE "${databaseName}"`);
await admin.end();
const control = new pg.Client({ connectionString: url });
await control.connect();
const password = process.env.DB_APP_PASSWORD;
if (!password || !/^[a-f0-9]{48}$/.test(password))
  throw new Error('DB_APP_PASSWORD must contain 48 random hexadecimal characters');
const role = await control.query("SELECT 1 FROM pg_roles WHERE rolname = 'ff_app'");
if (!role.rowCount)
  await control.query(
    `CREATE ROLE ff_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
await control.end();
for (const args of [['generate'], ['migrate', 'deploy']]) {
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const grants = new pg.Client({ connectionString: url });
await grants.connect();
await grants.query(
  'GRANT USAGE ON SCHEMA public TO ff_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ff_app; REVOKE UPDATE, DELETE ON flow_versions, domain_events, audit_logs, management_logs FROM ff_app; REVOKE ALL ON _prisma_migrations FROM ff_app',
);
await grants.end();
console.log('Database is ready. Run pnpm db:seed, then pnpm dev.');
