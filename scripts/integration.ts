import 'dotenv/config';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

if (!process.env.DATABASE_ADMIN_URL)
  throw new Error('DATABASE_ADMIN_URL is required for isolated database tests');
const adminUrl = new URL(process.env.DATABASE_ADMIN_URL);
adminUrl.pathname = '/postgres';
const control = new pg.Client({ connectionString: adminUrl.toString() });
await control.connect();
const suffix = randomBytes(6).toString('hex');
const name = `ff_test_${suffix}`;
const role = `ff_test_user_${suffix}`;
const password = randomBytes(24).toString('hex');
const testAdmin = new URL(adminUrl);
testAdmin.pathname = `/${name}`;
const testRuntime = new URL(testAdmin);
testRuntime.username = role;
testRuntime.password = password;
const env = {
  ...process.env,
  DATABASE_ADMIN_URL: testAdmin.toString(),
  DATABASE_URL: testRuntime.toString(),
  FLOWFORGE_TEST: process.argv.includes('--e2e') ? '0' : '1',
  ...(process.argv.includes('--e2e')
    ? {
        PORT: '3101',
        WEB_PORT: '5174',
        WEB_ORIGIN: 'http://localhost:5174',
        VITE_API_TARGET: 'http://127.0.0.1:3101',
        PLAYWRIGHT_BASE_URL: 'http://localhost:5174',
        E2E_ISOLATED: '1',
        DEMO_PASSWORD: 'FlowForge2026!',
      }
    : {}),
};
async function run(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}
try {
  await control.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await control.query(`CREATE DATABASE ${name}`);
  const migration = await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy']);
  if (migration !== 0) throw new Error('Test database migration failed');
  const grants = new pg.Client({ connectionString: testAdmin.toString() });
  await grants.connect();
  await grants.query(
    `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}; REVOKE UPDATE, DELETE ON flow_versions, domain_events, audit_logs FROM ${role}; REVOKE ALL ON _prisma_migrations FROM ${role}`,
  );
  await grants.end();
  if (process.argv.includes('--e2e')) {
    const seeded = await run(['--import', 'tsx', 'scripts/seed.ts']);
    if (seeded !== 0) throw new Error('E2E fixtures could not be created');
    process.exitCode = await run(['node_modules/@playwright/test/cli.js', 'test']);
  } else {
    process.exitCode = await run([
      'node_modules/vitest/vitest.mjs',
      'run',
      '--project',
      'integration',
    ]);
  }
} finally {
  // Names are generated locally from hexadecimal bytes; never remove a user-named database.
  await control.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await control.query(`DROP ROLE IF EXISTS ${role}`);
  await control.end();
}
