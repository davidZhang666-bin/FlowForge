import 'dotenv/config';
import pg from 'pg';
import { spawnSync } from 'node:child_process';

const admin = new URL(process.env.DATABASE_ADMIN_URL ?? '');
const runtime = new URL(process.env.DATABASE_URL ?? '');
const role = decodeURIComponent(runtime.username);
if (admin.host !== runtime.host || admin.pathname !== runtime.pathname)
  throw new Error('Migration and runtime URLs must address the same database');
if (!/^[a-z][a-z0-9_]{0,62}$/.test(role) || role === decodeURIComponent(admin.username))
  throw new Error('Use a separate lowercase runtime role');
if (decodeURIComponent(runtime.password).length < 24)
  throw new Error('Runtime database password must have at least 24 characters');
const migration = spawnSync(
  process.execPath,
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { stdio: 'inherit' },
);
if (migration.status !== 0) process.exit(migration.status ?? 1);
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  const existing = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
    [role],
  );
  if (!existing.rowCount) {
    const sql = await client.query<{ statement: string }>(
      "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', $1::text, $2::text) AS statement",
      [role, decodeURIComponent(runtime.password)],
    );
    await client.query(sql.rows[0]!.statement);
  } else if (existing.rows[0]!.rolsuper || existing.rows[0]!.rolbypassrls) {
    throw new Error('Runtime role must not be superuser or BYPASSRLS');
  }
  const owner = await client.query(
    'SELECT 1 FROM pg_tables WHERE schemaname = $1 AND tableowner = $2 LIMIT 1',
    ['public', role],
  );
  if (owner.rowCount) throw new Error('Runtime role must not own application tables');
  // role is restricted to a lowercase SQL identifier above.
  await client.query(
    `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}; REVOKE UPDATE, DELETE ON flow_versions, domain_events, audit_logs, management_logs FROM ${role}; REVOKE ALL ON _prisma_migrations FROM ${role}`,
  );
  const probe = new pg.Client({ connectionString: runtime.toString() });
  await probe.connect();
  await probe.end();
  console.log('Migrations and restricted runtime grants are ready.');
} finally {
  await client.end();
}
