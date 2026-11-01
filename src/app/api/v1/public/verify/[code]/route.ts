import { lookupVerification, verifyRateLimiter } from '@/modules/verification';
import { NotFound, RateLimited } from '@/platform/errors';
import { route } from '@/platform/http/route';

// Public check of an approved weekly report by its code (?s= passes the printed seal).
// Rate limited per client address before any database work; unknown, malformed and
// non-approved codes are the same 404. The body is the public projection only.
export const dynamic = 'force-dynamic';
export const GET = route({ auth: 'public' }, async (c) => {
  const limit = verifyRateLimiter.check(c.ip ?? 'unknown');
  if (!limit.allowed) throw new RateLimited(limit.retryAfterSeconds);

  const seal = new URL(c.req.url).searchParams.get('s') ?? undefined;
  const result = await lookupVerification(c.command.pool, c.params.code ?? '', { seal });
  if (!result) throw new NotFound();
  return { data: { data: result } };
});
