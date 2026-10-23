import 'dotenv/config';
import EmbeddedPostgres from 'embedded-postgres';
import { resolve } from 'node:path';

const db = new EmbeddedPostgres({ databaseDir: resolve('.local/postgres'), user: 'postgres', password: process.env.DB_ADMIN_PASSWORD ?? '', port: Number(process.env.DB_PORT ?? 55432), persistent: true, authMethod: 'scram-sha-256', postgresFlags: ['-h', '127.0.0.1'], onLog: message => process.stdout.write(`${String(message)}\n`), onError: message => process.stderr.write(`${String(message)}\n`) });
if (!process.env.DB_ADMIN_PASSWORD) throw new Error('DB_ADMIN_PASSWORD missing; run pnpm setup');
if (process.argv.includes('--stop')) { await db.stop(); process.exit(0); }
await db.initialise();
await db.start();
console.log('Local PostgreSQL listening on loopback.');
let stopping = false;
async function stop(): Promise<void> { if (stopping) return; stopping = true; await db.stop(); process.exit(0); }
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
setInterval(() => {}, 60000);
