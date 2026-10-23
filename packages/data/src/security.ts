import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(24).toString('hex'); return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [, salt, hash] = encoded.split('$');
  const valid = /^[a-f0-9]{48}$/.test(salt ?? '') && /^[a-f0-9]{128}$/.test(hash ?? '');
  const actual = await derive(password, valid ? salt! : '0'.repeat(48));
  return valid && timingSafeEqual(actual, Buffer.from(hash!, 'hex'));
}
export const createToken = (): string => randomBytes(32).toString('hex');
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
