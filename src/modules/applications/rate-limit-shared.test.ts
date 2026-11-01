import { afterEach, describe, expect, it } from 'vitest';
import * as platform from '@/platform/rate-limit';
import { applicationRateLimiter, createRateLimiter } from './rate-limit';

// The public form uses the one platform limiter (no second copy of the algorithm) with its
// own budget: 5 submissions per address per hour.
describe('application rate limiter', () => {
  afterEach(() => applicationRateLimiter.reset());

  it('is the shared platform limiter, not a copy of it', () => {
    expect(createRateLimiter).toBe(platform.createRateLimiter);
  });

  it('allows 5 submissions per address per hour', () => {
    applicationRateLimiter.reset();
    for (let i = 0; i < 5; i += 1) {
      expect(applicationRateLimiter.check('198.51.100.7').allowed).toBe(true);
    }
    const refused = applicationRateLimiter.check('198.51.100.7');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(3590);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(3600);
    expect(applicationRateLimiter.check('198.51.100.8').allowed).toBe(true);
  });
});
