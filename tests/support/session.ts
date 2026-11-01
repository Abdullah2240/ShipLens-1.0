import type { Pool } from 'pg';
import { sessionCookieName } from '@/modules/auth/cookie';
import { hashToken, newToken } from '@/modules/auth/session';

export async function createSessionCookie(
  pool: Pool,
  userId: string,
  opts: { secure?: boolean; ttlMinutes?: number } = {},
): Promise<string> {
  const token = newToken();
  await pool.query(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 * interval '1 minute'))",
    [hashToken(token), userId, opts.ttlMinutes ?? 60],
  );
  return `${sessionCookieName(opts.secure ?? false)}=${token}`;
}
