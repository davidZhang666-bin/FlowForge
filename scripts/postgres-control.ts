import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

export async function stopLocalDatabase(): Promise<void> {
  const data = resolve('.local/postgres');
  if (!existsSync(resolve(data, 'postmaster.pid'))) return;
  const options = readFileSync(resolve(data, 'postmaster.opts'), 'utf8');
  const binary = options.match(/^"([^"]+)"/)?.[1] ?? options.match(/^(.+?)\s+"-D"/)?.[1];
  if (!binary || !['postgres', 'postgres.exe'].includes(basename(binary)))
    throw new Error('Cannot identify the local PostgreSQL executable');
  const insideModules = relative(resolve('node_modules'), resolve(binary));
  if (insideModules.startsWith('..') || isAbsolute(insideModules))
    throw new Error('Refusing to control a PostgreSQL installation outside this workspace');
  const control = resolve(dirname(binary), process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  await new Promise<void>((resolveStop, reject) => {
    const child = spawn(control, ['-D', data, '-m', 'fast', '-w', 'stop'], {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveStop() : reject(new Error(`pg_ctl stop failed: ${code}`)),
    );
  });
}
