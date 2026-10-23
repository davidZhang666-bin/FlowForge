import { expect, it } from 'vitest';
import { canonical, createToken, digest, hashPassword, verifyPassword } from './security.js';
it('stores salted password hashes and compares valid credentials', async () => {
  const a = await hashPassword('test-password');
  const b = await hashPassword('test-password');
  expect(a).not.toBe(b);
  expect(a).not.toContain('test-password');
  expect(await verifyPassword('test-password', a)).toBe(true);
  expect(await verifyPassword('wrong', a)).toBe(false);
  expect(await verifyPassword('anything', 'corrupt')).toBe(false);
});
it('creates opaque tokens and canonical request hashes', () => {
  expect(createToken()).toHaveLength(64);
  expect(createToken()).not.toBe(createToken());
  expect(digest(canonical({ b: 2, a: [1, { z: true }] }))).toBe(
    digest(canonical({ a: [1, { z: true }], b: 2 })),
  );
});
