// Session helpers for Server Components and pages. The only file in platform/http that
// imports next/headers and next/navigation; route.ts and origin.ts stay framework-free.
//
// Pages and Server Components use these for reads only and never mutate: every write goes
// through an /api/v1 route built with route(), which also enforces the Origin check.
//
// IMPORT-TIME RULE: getEnv() and getPool() are called only inside these functions.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { readSessionToken, sessionCookieName } from '@/modules/auth/cookie';
import type { SessionUser } from '@/modules/auth/types';
import type { Actor } from '@/platform/authz';
import { getEnv } from '@/platform/config/env';
import { getPool } from '@/platform/db';
import { AppError } from '@/platform/errors';
import { systemClock } from '@/platform/time';

/** The signed-in actor and user, read from the session row, or null. */
export async function getCurrentActor(): Promise<{ actor: Actor; user: SessionUser } | null> {
  const secure = getEnv().APP_ORIGIN.startsWith('https://');
  const name = sessionCookieName(secure);
  const value = (await cookies()).get(name)?.value;
  const token = readSessionToken(value ? `${name}=${value}` : null, secure);
  const { getActorFromToken } = await import('@/modules/auth');
  return getActorFromToken({ pool: getPool(), clock: systemClock }, token);
}

/** As getCurrentActor(), but redirects to the localised /login when there is no session. */
export async function requireActor(): Promise<{ actor: Actor; user: SessionUser }> {
  const found = await getCurrentActor();
  if (found) return found;
  return redirect({ href: '/login', locale: await getLocale() });
}

/**
 * Resolves the promise, turning a 403 or 404 AppError into notFound() so a page never
 * reveals whether an out-of-scope record exists. Other errors propagate.
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof AppError && (err.status === 403 || err.status === 404)) notFound();
    throw err;
  }
}
