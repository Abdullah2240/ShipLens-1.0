import { LOGIN_THROTTLE } from '../../platform/config/constants';
import type { Queryable } from '../../platform/db';
import { RateLimited } from '../../platform/errors';
import type { Clock } from '../../platform/time';
import { failureTimes } from './repo';

const WINDOW_MS = LOGIN_THROTTLE.windowMinutes * 60_000;

/** Seconds until enough old failures leave the window for one more attempt. */
function retryAfter(times: Date[], max: number, now: Date): number {
  const blocking = times[times.length - max]!;
  const ms = blocking.getTime() + WINDOW_MS - now.getTime();
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Throws RateLimited when the submitted email string, or the client ip, has too many
 * failed attempts in the window. The email is only a key: it does not matter whether
 * an account with it exists.
 */
export async function assertNotThrottled(
  db: Queryable,
  key: { email: string; ip?: string | null },
  clock: Clock,
): Promise<void> {
  const now = clock.now();
  const since = new Date(now.getTime() - WINDOW_MS);

  const byEmail = await failureTimes(db, { email: key.email }, since);
  if (byEmail.length >= LOGIN_THROTTLE.maxFailuresPerEmail) {
    throw new RateLimited(retryAfter(byEmail, LOGIN_THROTTLE.maxFailuresPerEmail, now));
  }

  if (key.ip) {
    const byIp = await failureTimes(db, { ip: key.ip }, since);
    if (byIp.length >= LOGIN_THROTTLE.maxFailuresPerIp) {
      throw new RateLimited(retryAfter(byIp, LOGIN_THROTTLE.maxFailuresPerIp, now));
    }
  }
}
