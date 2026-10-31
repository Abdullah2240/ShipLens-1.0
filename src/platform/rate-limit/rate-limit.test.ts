import { describe, expect, it } from 'vitest';
import { clientIpFrom, createRateLimiter } from './index';

describe('createRateLimiter', () => {
  it('allows up to max hits per key inside the window, then refuses', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 3, windowMs: 60_000, now: () => now });
    for (let i = 0; i < 3; i += 1) {
      expect(limit.check('a')).toEqual({ allowed: true, retryAfterSeconds: 0 });
      now += 1000;
    }
    expect(limit.check('a').allowed).toBe(false);
  });

  it('counts each key separately', () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    expect(limit.check('a').allowed).toBe(true);
    expect(limit.check('a').allowed).toBe(false);
    expect(limit.check('b').allowed).toBe(true);
  });

  it('expires hits once they leave the sliding window', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });
    limit.check('a');
    now = 500;
    limit.check('a');
    expect(limit.check('a').allowed).toBe(false);
    now = 999;
    expect(limit.check('a').allowed).toBe(false);
    now = 1000;
    // The first hit (t=0) has left the window; the second (t=500) has not.
    expect(limit.check('a').allowed).toBe(true);
    expect(limit.check('a').allowed).toBe(false);
  });

  it('a refused check does not extend the window', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });
    limit.check('a');
    now = 900;
    expect(limit.check('a').allowed).toBe(false);
    now = 1000;
    expect(limit.check('a').allowed).toBe(true);
  });

  it('rounds retryAfterSeconds up to whole seconds', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 1, windowMs: 60_000, now: () => now });
    limit.check('a');
    now = 100;
    expect(limit.check('a')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now = 58_001;
    expect(limit.check('a')).toEqual({ allowed: false, retryAfterSeconds: 2 });
    now = 59_000;
    expect(limit.check('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('never reports a retryAfterSeconds below 1 when refusing', () => {
    let now = 0;
    const limit = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });
    limit.check('a');
    now = 999.9;
    expect(limit.check('a')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('evicts the oldest key once maxKeys is reached', () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1000, maxKeys: 2, now: () => 0 });
    limit.check('a');
    limit.check('b');
    limit.check('c');
    // 'a' was evicted to make room for 'c', so it starts afresh.
    expect(limit.check('a').allowed).toBe(true);
    expect(limit.check('c').allowed).toBe(false);
  });

  it('reset forgets every key', () => {
    const limit = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    limit.check('a');
    limit.check('b');
    limit.reset();
    expect(limit.check('a').allowed).toBe(true);
    expect(limit.check('b').allowed).toBe(true);
  });

  it('defaults to the system clock', () => {
    const limit = createRateLimiter({ max: 1, windowMs: 60_000 });
    expect(limit.check('a').allowed).toBe(true);
    const refused = limit.check('a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});

describe('clientIpFrom', () => {
  const headers = (value?: string) =>
    new Headers(value === undefined ? {} : { 'x-forwarded-for': value });

  it('takes the first x-forwarded-for entry', () => {
    expect(clientIpFrom(headers('a, b'))).toBe('a');
    expect(clientIpFrom(headers('203.0.113.7, 10.0.0.1, 10.0.0.2'))).toBe('203.0.113.7');
  });

  it('trims whitespace', () => {
    expect(clientIpFrom(headers(' a '))).toBe('a');
  });

  it("falls back to 'unknown' when the header is missing or empty", () => {
    expect(clientIpFrom(headers())).toBe('unknown');
    expect(clientIpFrom(headers(''))).toBe('unknown');
    expect(clientIpFrom(headers(' , b'))).toBe('unknown');
  });
});
