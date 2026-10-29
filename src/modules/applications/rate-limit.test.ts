import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

describe('sliding rate limit', () => {
  it('counts per key, expires hits, and resets', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });
    expect(limit.check('a').allowed).toBe(true);
    now = 500;
    expect(limit.check('a').allowed).toBe(true);
    expect(limit.check('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    expect(limit.check('b').allowed).toBe(true);
    now = 1000;
    expect(limit.check('a').allowed).toBe(true);
    limit.reset();
    expect(limit.check('a').allowed).toBe(true);
  });

  it('evicts the oldest key at capacity', () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1000, maxKeys: 2, now: () => 0 });
    limit.check('a');
    limit.check('b');
    limit.check('c');
    expect(limit.check('a').allowed).toBe(true);
    expect(limit.check('c').allowed).toBe(false);
  });
});
