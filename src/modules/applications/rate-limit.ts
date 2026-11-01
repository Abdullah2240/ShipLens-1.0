import { createRateLimiter } from '@/platform/rate-limit';

// The shared platform limiter (in memory, per server process), with the public form's own
// budget. Per process is sufficient for the single free-plan instance.
export { createRateLimiter };

export const applicationRateLimiter = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 });
