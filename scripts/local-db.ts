import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { startWindowsDatabase, stopLocalDatabase } from './postgres-control.js';

if (process.argv.includes('--stop')) {
  await stopLocalDatabase();
  process.exit(0);
}
class ManagedPostgres extends EmbeddedPostgres {
  override async stop(): Promise<void> {
    await stopLocalDatabase();
  }
}

const db = new ManagedPostgres({
  databaseDir: resolve('.local/postgres'),
  user: 'postgres',
  password: process.env.DB_ADMIN_PASSWORD ?? '',
  port: Number(process.env.DB_PORT ?? 55432),
  persistent: true,
  authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-h', '127.0.0.1'],
  onLog: (message) => process.stdout.write(`${String(message)}\n`),
  onError: (message) => process.stderr.write(`${String(message)}\n`),
});
if (!process.env.DB_ADMIN_PASSWORD) throw new Error('DB_ADMIN_PASSWORD missing; run pnpm setup');
if (!existsSync(resolve('.local/postgres/PG_VERSION'))) await db.initialise();
if (process.platform === 'win32') await startWindowsDatabase(Number(process.env.DB_PORT ?? 55432));
else await db.start();
console.log('Local PostgreSQL listening on loopback.');
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await db.stop();
  process.exit(0);
}
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
setInterval(() => {
  if (!existsSync(resolve('.local/postgres/postmaster.pid'))) process.exit(0);
}, 2000);
