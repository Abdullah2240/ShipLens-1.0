import type { Queryable } from '../../platform/db';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
  branch_id: string | null;
  is_active: boolean;
}

export interface SessionWithUserRow {
  session_id: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  user_id: string;
  email: string;
  name: string;
  role: string;
  branch_id: string | null;
  is_active: boolean;
}

/** `email` must already be trimmed and lowercased. */
export async function findUserByEmail(db: Queryable, email: string): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT id, email, name, password_hash, role, branch_id, is_active
       FROM users WHERE lower(email) = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function insertSession(
  db: Queryable,
  s: {
    tokenHash: string;
    userId: string;
    now: Date;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $3, $4, $5, $6) RETURNING id`,
    [s.tokenHash, s.userId, s.now, s.expiresAt, s.ip, s.userAgent],
  );
  return rows[0]!.id;
}

/** Session and its user's current role, branch and active flag in one query. */
export async function findSessionWithUser(
  db: Queryable,
  tokenHash: string,
): Promise<SessionWithUserRow | null> {
  const { rows } = await db.query<SessionWithUserRow>(
    `SELECT s.id AS session_id, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
            u.id AS user_id, u.email, u.name, u.role, u.branch_id, u.is_active
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function touchSession(db: Queryable, sessionId: string, now: Date): Promise<void> {
  await db.query('UPDATE sessions SET last_seen_at = $2 WHERE id = $1 AND revoked_at IS NULL', [
    sessionId,
    now,
  ]);
}

export async function revokeSession(db: Queryable, sessionId: string, now: Date): Promise<void> {
  await db.query('UPDATE sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL', [
    sessionId,
    now,
  ]);
}

export async function insertLoginAttempt(
  db: Queryable,
  a: { email: string; ip: string | null; succeeded: boolean; at: Date },
): Promise<void> {
  await db.query(
    'INSERT INTO login_attempts (email, ip, succeeded, attempted_at) VALUES ($1, $2, $3, $4)',
    [a.email, a.ip, a.succeeded, a.at],
  );
}

/** Times of failed attempts for a key since `since`, oldest first. */
export async function failureTimes(
  db: Queryable,
  key: { email: string } | { ip: string },
  since: Date,
): Promise<Date[]> {
  const [column, value] = 'email' in key ? ['email', key.email] : ['ip', key.ip];
  const { rows } = await db.query<{ attempted_at: Date }>(
    `SELECT attempted_at FROM login_attempts
      WHERE ${column} = $1 AND succeeded = false AND attempted_at > $2
      ORDER BY attempted_at ASC`,
    [value, since],
  );
  return rows.map((r) => r.attempted_at);
}
