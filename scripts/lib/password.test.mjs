import { describe, expect, it } from 'vitest';
import { ARGON2_PARAMS, hashPassword, verifyPassword } from './password.mjs';

// Throwaway literals only; these are not credentials.
const PLAIN = 'correct horse battery staple';

describe('password hashing', () => {
  it('uses argon2id at the pinned parameters', async () => {
    const hash = await hashPassword(PLAIN);
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });

  it('salts: two hashes of the same password differ', async () => {
    const [a, b] = await Promise.all([hashPassword(PLAIN), hashPassword(PLAIN)]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword(PLAIN);
    expect(await verifyPassword(hash, PLAIN)).toBe(true);
    expect(await verifyPassword(hash, `${PLAIN}!`)).toBe(false);
  });

  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', PLAIN)).toBe(false);
    expect(await verifyPassword('', PLAIN)).toBe(false);
    expect(await verifyPassword('$argon2id$garbage', PLAIN)).toBe(false);
  });

  it('rejects empty and oversized passwords', async () => {
    await expect(hashPassword('')).rejects.toThrow();
    await expect(hashPassword('x'.repeat(257))).rejects.toThrow();
    await expect(hashPassword('x'.repeat(256))).resolves.toBeTypeOf('string');
  });

  it('verify refuses oversized input without hashing it', async () => {
    const hash = await hashPassword(PLAIN);
    expect(await verifyPassword(hash, 'x'.repeat(257))).toBe(false);
  });

  it('never drops below the OWASP minimums', () => {
    expect(ARGON2_PARAMS.memoryCost).toBeGreaterThanOrEqual(19456);
    expect(ARGON2_PARAMS.timeCost).toBeGreaterThanOrEqual(2);
    expect(ARGON2_PARAMS.parallelism).toBeGreaterThanOrEqual(1);
    expect(ARGON2_PARAMS).toEqual({ memoryCost: 19456, timeCost: 2, parallelism: 1 });
  });
});
