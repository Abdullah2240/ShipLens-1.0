// Password hashing shared by the app and the seed script. Plain ESM (no TypeScript) so
// the seed can run in the slim runtime image.
//
// The cost parameters are the OWASP minimum for argon2id. They may be raised after
// measuring latency on the deployed instance; they must never be lowered.
import { hash, verify } from '@node-rs/argon2';

const ARGON2ID = 2; // Algorithm.Argon2id

export const ARGON2_PARAMS = Object.freeze({ memoryCost: 19456, timeCost: 2, parallelism: 1 });

export const MAX_PASSWORD_LENGTH = 256;

/** @param {string} plain */
export async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('Password must not be empty');
  }
  if (plain.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  return hash(plain, { algorithm: ARGON2ID, ...ARGON2_PARAMS });
}

/**
 * True only for a matching password. A malformed hash or an oversized password is a
 * plain false, never an exception.
 * @param {string} storedHash
 * @param {string} plain
 */
export async function verifyPassword(storedHash, plain) {
  if (typeof storedHash !== 'string' || typeof plain !== 'string') return false;
  if (plain.length > MAX_PASSWORD_LENGTH) return false;
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
