import 'dotenv/config';
import { Database } from '../../../packages/data/src/index.js';
import { BackgroundWorker } from '../../../packages/data/src/worker.js';
const db = new Database(); const worker = new BackgroundWorker(db);
let stopping = false;
process.on('SIGINT', () => { stopping = true; }); process.on('SIGTERM', () => { stopping = true; });
console.log(JSON.stringify({ service: 'worker', status: 'ready' }));
while (!stopping) {
  try { await worker.tick(); } catch (error) { console.error(JSON.stringify({ service: 'worker', error: error instanceof Error ? error.message : 'unknown' })); }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
await db.close();
