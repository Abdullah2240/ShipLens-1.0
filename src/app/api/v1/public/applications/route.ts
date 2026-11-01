import {
  applicationInputSchema,
  applicationRateLimiter,
  submitApplication,
} from '@/modules/applications';
import { RateLimited } from '@/platform/errors';
import { route } from '@/platform/http/interim-route';
import { logger } from '@/platform/log/logger';

export const dynamic = 'force-dynamic';

export const POST = route({ auth: 'public', body: applicationInputSchema }, async (c) => {
  // Body validation finishes before this check; invalid requests never reach the database.
  const limit = applicationRateLimiter.check(c.ip ?? 'unknown');
  if (!limit.allowed) throw new RateLimited(limit.retryAfterSeconds);

  if (c.body.website) {
    logger.warn('application.honeypot');
    return { status: 201, data: { ok: true } };
  }

  await submitApplication(c.command, c.body);
  return { status: 201, data: { ok: true } };
});
