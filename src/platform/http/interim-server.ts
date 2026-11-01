// TEMPORARY. Replaced by src/platform/http/server.ts and getShellSession work from
// plans 01-11 and 01-15. Admin pages use these helpers until those plans land.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { sessionCookieName, readSessionToken } from '@/modules/auth/cookie';
import type { SessionUser } from '@/modules/auth/types';
import type { Actor } from '@/platform/authz';
import { getEnv } from '@/platform/config/env';
import { getPool } from '@/platform/db';
import { AppError } from '@/platform/errors';
import { systemClock } from '@/platform/time';

export async function getPageActor(): Promise<{ actor: Actor; user: SessionUser } | null> {
  const secure = getEnv().APP_ORIGIN.startsWith('https://');
  const name = sessionCookieName(secure);
  const value = (await cookies()).get(name)?.value;
  const token = readSessionToken(value ? `${name}=${value}` : null, secure);
  const { getActorFromToken } = await import('@/modules/auth');
  return getActorFromToken({ pool: getPool(), clock: systemClock }, token);
}

export async function requirePageActor(): Promise<{ actor: Actor; user: SessionUser }> {
  const found = await getPageActor();
  if (found) return found;
  return redirect({ href: '/login', locale: await getLocale() });
}

export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof AppError && (err.status === 403 || err.status === 404)) notFound();
    throw err;
  }
}
