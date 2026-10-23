import 'dotenv/config';
import { spawn } from 'node:child_process';
const commands = [
  ['--import', 'tsx', 'apps/api/src/main.ts'],
  ['--import', 'tsx', 'apps/worker/src/main.ts'],
  ['node_modules/vite/bin/vite.js', '--config', 'apps/web/vite.config.ts'],
];
const children = commands.map(args => spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true }));
let stopping = false;
function stop(code = 0): void { if (stopping) return; stopping = true; for (const child of children) child.kill(); process.exitCode = code; }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
for (const child of children) child.on('exit', code => { if (!stopping) stop(code ?? 1); });
