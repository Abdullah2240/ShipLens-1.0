import { hashPassword, verifyPassword } from '../../../scripts/lib/password.mjs';
import { command, type CommandContext } from '../../platform/audit';
import type { Actor } from '../../platform/authz/actor';
import { ROLES, type Role } from '../../platform/authz/roles';
import { logger } from '../../platform/log/logger';
import {
  findSessionWithUser,
  findUserByEmail,
  insertLoginAttempt,
  insertSession,
  revokeSession,
  touchSession,
  type SessionWithUserRow,
  type UserRow,
} from './repo';
import { absoluteExpiry, hashToken, isSessionLive, newToken, shouldTouch } from './session';
import { assertNotThrottled } from './throttle';
import { InvalidCredentials, type LoginInput, type LoginResult, type SessionUser } from './types';

const MAX_EMAIL_LENGTH = 254;
const MAX_TOKEN_LENGTH = 256;

// Verified against when the email is unknown, so an unknown email costs one argon2
// verification just like a wrong password. Built lazily with the live parameters, once
// per process.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-unknown-emails');
  return dummyHash;
}

function normaliseEmail(raw: string): string {
  return String(raw).trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

function toSessionUser(u: {
  id: string;
  email: string;
  name: string;
  role: Role;
  branch_id: string | null;
}): SessionUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, branchId: u.branch_id };
}

// Built only from a verified database row, never from request input.
function actorFor(u: { id: string; role: Role; branch_id: string | null; name: string }): Actor {
  return { userId: u.id, role: u.role, branchId: u.branch_id, name: u.name };
}

async function recordFailure(ctx: CommandContext, email: string, ip: string | null): Promise<void> {
  const systemCtx: CommandContext = { ...ctx, actor: null };
  await command(
    systemCtx,
    'auth.record_failed_login',
    (tx) => insertLoginAttempt(tx, { email, ip, succeeded: false, at: ctx.clock.now() }),
    { audit: 'none' },
  );
  logger.warn('login failed', { requestId: ctx.requestId, ip });
}

export async function login(ctx: CommandContext, input: LoginInput): Promise<LoginResult> {
  const email = normaliseEmail(input.email);
  const password = String(input.password);
  const ip = input.ip ?? null;
  const userAgent = input.userAgent ? input.userAgent.slice(0, 512) : null;

  try {
    await assertNotThrottled(ctx.pool, { email, ip }, ctx.clock);
  } catch (err) {
    logger.warn('login throttled', { requestId: ctx.requestId, ip });
    throw err;
  }

  const found: UserRow | null = await findUserByEmail(ctx.pool, email);
  const matches = await verifyPassword(
    found ? found.password_hash : await getDummyHash(),
    password,
  );

  if (!found || !matches || !found.is_active || !isRole(found.role)) {
    await recordFailure(ctx, email, ip);
    throw new InvalidCredentials();
  }
  const role = found.role;

  const token = newToken();
  const now = ctx.clock.now();
  const expiresAt = absoluteExpiry(now);
  const userCtx: CommandContext = {
    ...ctx,
    actor: actorFor({ id: found.id, role, branch_id: found.branch_id, name: found.name }),
  };

  await command(userCtx, 'auth.login', async (tx, audit) => {
    const sessionId = await insertSession(tx, {
      tokenHash: hashToken(token),
      userId: found.id,
      now,
      expiresAt,
      ip,
      userAgent,
    });
    await insertLoginAttempt(tx, { email, ip, succeeded: true, at: now });
    audit({
      action: 'auth.login',
      entityType: 'session',
      entityId: sessionId,
      branchId: found.branch_id,
    });
  });

  return {
    token,
    user: toSessionUser({ ...found, role }),
    expiresAt,
  };
}

export async function logout(ctx: CommandContext, token: string): Promise<void> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return;
  const row = await findSessionWithUser(ctx.pool, hashToken(token));
  if (!row || row.revoked_at !== null || !isRole(row.role)) return;
  const role = row.role;

  const userCtx: CommandContext = {
    ...ctx,
    actor: actorFor({ id: row.user_id, role, branch_id: row.branch_id, name: row.name }),
  };
  await command(userCtx, 'auth.logout', async (tx, audit) => {
    await revokeSession(tx, row.session_id, ctx.clock.now());
    audit({
      action: 'auth.logout',
      entityType: 'session',
      entityId: row.session_id,
      branchId: row.branch_id,
    });
  });
}

/**
 * The only producer of an Actor for HTTP requests. Role, branch and active flag come
 * from the database on every call.
 */
export async function getActorFromToken(
  ctx: Pick<CommandContext, 'pool' | 'clock'>,
  token: string | null,
): Promise<{ actor: Actor; user: SessionUser } | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const row: SessionWithUserRow | null = await findSessionWithUser(ctx.pool, hashToken(token));
  if (!row) return null;

  const now = ctx.clock.now();
  if (!isSessionLive(row, now) || !isRole(row.role)) return null;

  if (shouldTouch(row, now)) await touchSession(ctx.pool, row.session_id, now);

  const user = {
    id: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
    branch_id: row.branch_id,
  };
  return { actor: actorFor(user), user: toSessionUser(user) };
}
