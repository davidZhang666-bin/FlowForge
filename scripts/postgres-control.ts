import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export async function startWindowsDatabase(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid database port');
  const embedded = createRequire(import.meta.resolve('embedded-postgres'));
  const binaries = (await import(
    pathToFileURL(embedded.resolve('@embedded-postgres/windows-x64')).href
  )) as { pg_ctl: string };
  // pg_ctl starts PostgreSQL with a restricted Windows token, including on elevated CI runners.
  await new Promise<void>((resolveStart, reject) => {
    const child = spawn(
      binaries.pg_ctl,
      [
        '-D',
        resolve('.local/postgres'),
        '-l',
        resolve('.local/postgres-server.log'),
        '-o',
        `-h 127.0.0.1 -p ${port}`,
        '-w',
        'start',
      ],
      { stdio: 'inherit', windowsHide: true, env: { ...process.env, LC_MESSAGES: 'C' } },
    );
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolveStart() : reject(new Error(`pg_ctl start failed: ${code}`)),
    );
  });
}

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
