import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const controlUrl = new URL(process.env.DATABASE_ADMIN_URL ?? '');
controlUrl.pathname = '/postgres';
const control = new pg.Client({ connectionString: controlUrl.toString() });
await control.connect();
const suffix = randomBytes(6).toString('hex');
const database = `ff_bootstrap_${suffix}`;
const role = `ff_bootstrap_user_${suffix}`;
const migrator = `ff_bootstrap_owner_${suffix}`;
const admin = new URL(controlUrl);
admin.pathname = `/${database}`;
admin.username = migrator;
admin.password = randomBytes(24).toString('hex');
const runtime = new URL(admin);
runtime.username = role;
runtime.password = randomBytes(24).toString('hex');
const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_ADMIN_URL: admin.toString(),
  DATABASE_URL: runtime.toString(),
  BOOTSTRAP_TENANT_NAME: 'Bootstrap smoke organization',
  BOOTSTRAP_ADMIN_EMAIL: `admin-${suffix}@test.invalid`,
  BOOTSTRAP_ADMIN_PASSWORD: randomBytes(24).toString('hex'),
};
async function run(script: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} failed`))));
  });
}
try {
  await control.query(
    `CREATE ROLE ${migrator} LOGIN PASSWORD '${admin.password}' NOSUPERUSER NOCREATEDB CREATEROLE NOBYPASSRLS`,
  );
  await control.query(
    `CREATE DATABASE ${database} OWNER ${migrator} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`,
  );
  await run('scripts/provision.ts');
  await run('scripts/bootstrap.ts');
  const probe = new pg.Client({ connectionString: admin.toString() });
  await probe.connect();
  try {
    await probe.query('BEGIN');
    const rows = await probe.query<{ id: string }>('SELECT id FROM tenants');
    assert.equal(rows.rowCount, 1);
    env.MEMBER_TENANT_ID = rows.rows[0]!.id;
    await probe.query("SELECT set_config('app.tenant_id', $1, true)", [env.MEMBER_TENANT_ID]);
    env.MEMBER_NAME = 'Smoke manager';
    env.MEMBER_ROLE = 'manager';
    env.MEMBER_EMAIL = `manager-${suffix}@test.invalid`;
    env.MEMBER_PASSWORD = randomBytes(24).toString('hex');
    await run('scripts/member.ts');
    assert.equal((await probe.query('SELECT * FROM flow_versions')).rowCount, 4);
    assert.equal((await probe.query('SELECT * FROM memberships WHERE active = true')).rowCount, 2);
    const app = new pg.Client({ connectionString: runtime.toString() });
    await app.connect();
    try {
      assert.equal((await app.query('SELECT * FROM flow_versions')).rowCount, 0);
    } finally {
      await app.end();
    }
    console.log(
      'Bootstrap smoke passed: restricted grants, four published templates, admin and member.',
    );
  } finally {
    await probe.query('ROLLBACK');
    await probe.end();
  }
} finally {
  await control.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await control.query(`DROP ROLE IF EXISTS ${role}`);
  await control.query(`DROP ROLE IF EXISTS ${migrator}`);
  await control.end();
}
