import 'dotenv/config';
import { createServer } from 'node:http';
import { Database } from '../../../packages/data/src/index.js';
import { BackgroundWorker } from '../../../packages/data/src/worker.js';
const db = new Database();
const worker = new BackgroundWorker(db);
let stopping = false;
let lastSuccess = 0;
const health = createServer((req, res) => {
  if (req.url !== '/health') {
    res.writeHead(404).end();
    return;
  }
  const ready = lastSuccess > 0 && Date.now() - lastSuccess < 60000;
  res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      service: 'flowforge-worker',
      status: ready ? 'ok' : 'stale',
      lastSuccess: lastSuccess ? new Date(lastSuccess).toISOString() : null,
    }),
  );
});
health.listen(Number(process.env.WORKER_PORT ?? 3102), process.env.HOST ?? '127.0.0.1');
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
console.log(JSON.stringify({ service: 'worker', status: 'ready' }));
while (!stopping) {
  try {
    await worker.tick();
    lastSuccess = Date.now();
  } catch (error) {
    console.error(
      JSON.stringify({
        service: 'worker',
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
health.close();
await db.close();
