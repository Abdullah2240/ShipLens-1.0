import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../../../scripts/lib/password.mjs';
import type { CommandContext } from '../../platform/audit';
import type { AuditRow } from '../../platform/audit';
import { LOGIN_THROTTLE, SESSION } from '../../platform/config/constants';
import { RateLimited, mapError } from '../../platform/errors';
import { logger } from '../../platform/log/logger';
import { fixedClock } from '../../platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { getActorFromToken, login, logout } from './service';
import { hashToken } from './session';
import { InvalidCredentials } from './types';

// Count real verifications while still running them.
vi.mock('../../../scripts/lib/password.mjs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../scripts/lib/password.mjs')>();
  return { ...real, verifyPassword: vi.fn(real.verifyPassword) };
});

const pool = testPool();
const START = '2026-10-28T10:00:00Z';
const PASSWORD = 'throwaway-pass-for-tests';
const WRONG = 'definitely-not-the-password';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let clock = fixedClock(START);
let passwordHash: string;

function ctx(): CommandContext {
  return { actor: null, requestId: 'req-auth-1', clock, pool };
}

async function makeUser(
  opts: { role?: string; email?: string; active?: boolean; withBranch?: boolean } = {},
) {
  const role = opts.role ?? 'super_admin';
  const branch = role === 'branch_lead' || role === 'hr_lead' ? await seedBranch(pool) : null;
  const user = await seedUser(pool, {
    role,
    branchId: branch?.id,
    email: opts.email ?? `u-${Math.random().toString(36).slice(2, 10)}@example.test`,
  });
  await pool.query('UPDATE users SET password_hash = $2, is_active = $3 WHERE id = $1', [
    user.id,
    passwordHash,
    opts.active ?? true,
  ]);
  return user;
}

async function auditRows(): Promise<AuditRow[]> {
  const { rows } = await pool.query<AuditRow>('SELECT * FROM audit_events ORDER BY id');
  return rows;
}

async function sessionRows() {
  const { rows } = await pool.query('SELECT * FROM sessions ORDER BY created_at');
  return rows as Record<string, unknown>[];
}

async function expectInvalid(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InvalidCredentials);
  return err as InvalidCredentials;
}

beforeEach(async () => {
  await resetDb(pool);
  clock = fixedClock(START);
  passwordHash ??= await hashPassword(PASSWORD);
  vi.mocked(verifyPassword).mockClear();
});

afterAll(async () => {
  await closeTestPool();
});

describe('login', () => {
  it('returns a 256-bit token, stores only its sha256 and sets the absolute expiry', async () => {
    const user = await makeUser({ email: 'ada@example.test' });
    const res = await login(ctx(), {
      email: 'ada@example.test',
      password: PASSWORD,
      ip: '10.0.0.1',
      userAgent: 'vitest',
    });

    expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.user).toEqual({
      id: user.id,
      email: 'ada@example.test',
      name: user.name,
      role: 'super_admin',
      branchId: null,
    });
    expect(res.expiresAt.getTime()).toBe(new Date(START).getTime() + SESSION.absoluteDays * DAY);

    const rows = await sessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(hashToken(res.token));
    expect(rows[0]!.ip).toBe('10.0.0.1');
    for (const row of rows) {
      for (const value of Object.values(row)) {
        expect(String(value)).not.toContain(res.token);
      }
    }
    for (const row of await auditRows()) {
      expect(JSON.stringify(row)).not.toContain(res.token);
    }
  });

  it('audits auth.login with the authenticated actor id, role and branch', async () => {
    const user = await makeUser({ role: 'branch_lead', email: 'lead@example.test' });
    const res = await login(ctx(), { email: 'lead@example.test', password: PASSWORD });
    const [row] = await auditRows();
    const [session] = await sessionRows();
    expect(row).toMatchObject({
      action: 'auth.login',
      entity_type: 'session',
      entity_id: session!.id,
      actor_id: user.id,
      actor_role: 'branch_lead',
      branch_id: user.branch_id,
      request_id: 'req-auth-1',
    });
    expect(res.user.branchId).toBe(user.branch_id);

    const { rows } = await pool.query('SELECT succeeded FROM login_attempts WHERE email = $1', [
      'lead@example.test',
    ]);
    expect(rows).toEqual([{ succeeded: true }]);
  });

  it('issues a new token on every login', async () => {
    await makeUser({ email: 'ada@example.test' });
    const a = await login(ctx(), { email: 'ada@example.test', password: PASSWORD });
    const b = await login(ctx(), { email: 'ada@example.test', password: PASSWORD });
    expect(a.token).not.toBe(b.token);
    expect(await sessionRows()).toHaveLength(2);
  });

  it('trims and lowercases the email', async () => {
    await makeUser({ email: 'ada@example.test' });
    const res = await login(ctx(), { email: '  ADA@Example.Test ', password: PASSWORD });
    expect(res.user.email).toBe('ada@example.test');
  });

  it('gives unknown email, wrong password and inactive user the identical error', async () => {
    await makeUser({ email: 'ada@example.test' });
    await makeUser({ email: 'off@example.test', active: false });

    const unknown = await expectInvalid(
      login(ctx(), { email: 'ghost@example.test', password: PASSWORD }),
    );
    const wrong = await expectInvalid(login(ctx(), { email: 'ada@example.test', password: WRONG }));
    const inactive = await expectInvalid(
      login(ctx(), { email: 'off@example.test', password: PASSWORD }),
    );

    for (const err of [unknown, wrong, inactive]) {
      expect(err.code).toBe('invalid_credentials');
      expect(err.status).toBe(401);
      expect(err.message).toBe(unknown.message);
    }
    const bodies = [unknown, wrong, inactive].map((e) => JSON.stringify(mapError(e, 'r1')));
    expect(new Set(bodies).size).toBe(1);
    expect(await sessionRows()).toHaveLength(0);
  });

  it('verifies against a dummy hash when the email is unknown', async () => {
    await makeUser({ email: 'ada@example.test' });
    await expectInvalid(login(ctx(), { email: 'ghost@example.test', password: PASSWORD }));
    expect(verifyPassword).toHaveBeenCalledTimes(1);

    vi.mocked(verifyPassword).mockClear();
    await expectInvalid(login(ctx(), { email: 'ada@example.test', password: WRONG }));
    expect(verifyPassword).toHaveBeenCalledTimes(1);
  });

  it('records failures without an audit event or any secret in the log', async () => {
    await makeUser({ email: 'ada@example.test' });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expectInvalid(
      login(ctx(), { email: 'ada@example.test', password: WRONG, ip: '10.0.0.9' }),
    );

    expect(await auditRows()).toHaveLength(0);
    const { rows } = await pool.query('SELECT email, ip, succeeded FROM login_attempts');
    expect(rows).toEqual([{ email: 'ada@example.test', ip: '10.0.0.9', succeeded: false }]);

    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(WRONG);
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain(passwordHash);
    warn.mockRestore();
  });

  it('treats an oversized password as a plain wrong password', async () => {
    await makeUser({ email: 'ada@example.test' });
    await expectInvalid(login(ctx(), { email: 'ada@example.test', password: 'x'.repeat(5000) }));
  });
});

describe('login throttling', () => {
  const max = LOGIN_THROTTLE.maxFailuresPerEmail;

  async function fail(email: string, n: number, ip?: string) {
    for (let i = 0; i < n; i++) {
      await expectInvalid(login(ctx(), { email, password: WRONG, ip }));
    }
  }

  it('refuses even the correct password after the maximum failures, then recovers', async () => {
    await makeUser({ email: 'ada@example.test' });
    await fail('ada@example.test', max);

    const err = await login(ctx(), { email: 'ada@example.test', password: PASSWORD }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RateLimited);
    expect((err as RateLimited).retryAfterSeconds).toBeGreaterThan(0);
    expect((err as RateLimited).retryAfterSeconds).toBeLessThanOrEqual(
      LOGIN_THROTTLE.windowMinutes * 60,
    );
    expect(mapError(err, 'r').status).toBe(429);
    expect(await sessionRows()).toHaveLength(0);

    clock.advance(LOGIN_THROTTLE.windowMinutes * MIN + 1000);
    const ok = await login(ctx(), { email: 'ada@example.test', password: PASSWORD });
    expect(ok.token).toHaveLength(43);
  });

  it('does not count a throttled attempt as another failure', async () => {
    await makeUser({ email: 'ada@example.test' });
    await fail('ada@example.test', max);
    await login(ctx(), { email: 'ada@example.test', password: PASSWORD }).catch(() => {});
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM login_attempts');
    expect(rows[0].n).toBe(max);
  });

  it('keys on the email string, case-insensitively, even if the account does not exist', async () => {
    await expectInvalid(login(ctx(), { email: 'Ghost@Example.Test', password: WRONG }));
    await expectInvalid(login(ctx(), { email: 'ghost@example.test', password: WRONG }));
    await fail('GHOST@example.test', max - 2);
    const err = await login(ctx(), { email: 'ghost@example.test', password: WRONG }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(RateLimited);
  });

  it('does not throttle other emails', async () => {
    await makeUser({ email: 'ada@example.test' });
    await makeUser({ email: 'bob@example.test' });
    await fail('ada@example.test', max);
    const ok = await login(ctx(), { email: 'bob@example.test', password: PASSWORD });
    expect(ok.user.email).toBe('bob@example.test');
  });

  it('throttles an ip after too many failures across different emails', async () => {
    await makeUser({ email: 'ada@example.test' });
    for (let i = 0; i < LOGIN_THROTTLE.maxFailuresPerIp; i++) {
      await expectInvalid(
        login(ctx(), { email: `ghost${i}@example.test`, password: WRONG, ip: '10.9.9.9' }),
      );
    }
    const err = await login(ctx(), {
      email: 'ada@example.test',
      password: PASSWORD,
      ip: '10.9.9.9',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimited);

    const other = await login(ctx(), {
      email: 'ada@example.test',
      password: PASSWORD,
      ip: '10.1.1.1',
    });
    expect(other.token).toHaveLength(43);
  });
});

describe('getActorFromToken', () => {
  async function loggedIn(role = 'super_admin') {
    const user = await makeUser({ role, email: `${role}@example.test` });
    const res = await login(ctx(), { email: `${role}@example.test`, password: PASSWORD });
    return { user, token: res.token };
  }

  it('returns the actor and user for a valid token', async () => {
    const { user, token } = await loggedIn('branch_lead');
    const found = await getActorFromToken(ctx(), token);
    expect(found?.actor).toMatchObject({
      userId: user.id,
      role: 'branch_lead',
      branchId: user.branch_id,
    });
    expect(found?.user).toMatchObject({ id: user.id, role: 'branch_lead' });
  });

  it('returns null for null, empty, unknown and oversized tokens', async () => {
    await loggedIn();
    expect(await getActorFromToken(ctx(), null)).toBeNull();
    expect(await getActorFromToken(ctx(), '')).toBeNull();
    expect(await getActorFromToken(ctx(), 'A'.repeat(43))).toBeNull();
    expect(await getActorFromToken(ctx(), 'A'.repeat(10_000))).toBeNull();
  });

  it('rejects after the absolute lifetime even if the session stays in use', async () => {
    const { token } = await loggedIn();
    const login0 = clock.now().getTime();
    const abs = SESSION.absoluteDays * DAY;

    clock.set(new Date(login0 + abs - 1000));
    await pool.query('UPDATE sessions SET last_seen_at = $1', [clock.now()]);
    expect(await getActorFromToken(ctx(), token)).not.toBeNull();

    clock.set(new Date(login0 + abs + 1000));
    await pool.query('UPDATE sessions SET last_seen_at = $1', [clock.now()]);
    expect(await getActorFromToken(ctx(), token)).toBeNull();
  });

  it('rejects after the idle limit', async () => {
    const { token } = await loggedIn();
    const login0 = clock.now().getTime();

    clock.set(new Date(login0 + SESSION.idleMinutes * MIN - 1000));
    expect(await getActorFromToken(ctx(), token)).not.toBeNull();
  });

  it('rejects an idle session (13h without use)', async () => {
    const { token } = await loggedIn();
    clock.advance(13 * HOUR);
    expect(await getActorFromToken(ctx(), token)).toBeNull();
  });

  it('keeps a session alive while it is used within the idle limit', async () => {
    const { token } = await loggedIn();
    for (let i = 0; i < 4; i++) {
      clock.advance(11 * HOUR);
      expect(await getActorFromToken(ctx(), token)).not.toBeNull();
    }
  });

  it('rejects a revoked session', async () => {
    const { token } = await loggedIn();
    await pool.query('UPDATE sessions SET revoked_at = now()');
    expect(await getActorFromToken(ctx(), token)).toBeNull();
  });

  it('rejects the session of a deactivated user on the next lookup', async () => {
    const { user, token } = await loggedIn();
    expect(await getActorFromToken(ctx(), token)).not.toBeNull();
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);
    expect(await getActorFromToken(ctx(), token)).toBeNull();
  });

  it('reads role from the database on every lookup', async () => {
    const { user, token } = await loggedIn();
    expect((await getActorFromToken(ctx(), token))?.actor.role).toBe('super_admin');
    await pool.query("UPDATE users SET role = 'finance_reviewer' WHERE id = $1", [user.id]);
    const after = await getActorFromToken(ctx(), token);
    expect(after?.actor.role).toBe('finance_reviewer');
    expect(after?.user.role).toBe('finance_reviewer');
  });

  it('reads branch from the database on every lookup', async () => {
    const { user, token } = await loggedIn('branch_lead');
    const other = await seedBranch(pool);
    await pool.query('UPDATE users SET branch_id = $2 WHERE id = $1', [user.id, other.id]);
    expect((await getActorFromToken(ctx(), token))?.actor.branchId).toBe(other.id);
  });

  it('touches last_seen_at at most once per touch interval', async () => {
    const { token } = await loggedIn();
    const seen = async () =>
      (
        await pool.query<{ t: Date }>('SELECT last_seen_at AS t FROM sessions')
      ).rows[0]!.t.getTime();
    const t0 = new Date(START).getTime();
    expect(await seen()).toBe(t0);

    clock.advance((SESSION.touchIntervalSeconds - 1) * 1000);
    await getActorFromToken(ctx(), token);
    expect(await seen()).toBe(t0);

    clock.advance(2000);
    await getActorFromToken(ctx(), token);
    const t1 = clock.now().getTime();
    expect(await seen()).toBe(t1);

    clock.advance(30_000);
    await getActorFromToken(ctx(), token);
    expect(await seen()).toBe(t1);
  });
});

describe('logout', () => {
  it('revokes the session server-side and audits auth.logout with the user actor', async () => {
    const user = await makeUser({ role: 'hr_lead', email: 'hr@example.test' });
    const { token } = await login(ctx(), { email: 'hr@example.test', password: PASSWORD });
    clock.advance(5 * MIN);

    await logout(ctx(), token);

    const [session] = await sessionRows();
    expect(session!.revoked_at).toEqual(clock.now());
    expect(await getActorFromToken(ctx(), token)).toBeNull();

    const rows = (await auditRows()).filter((r) => r.action === 'auth.logout');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entity_type: 'session',
      entity_id: session!.id,
      actor_id: user.id,
      actor_role: 'hr_lead',
      branch_id: user.branch_id,
    });
  });

  it('is a no-op for an unknown token and a second logout', async () => {
    await makeUser({ email: 'ada@example.test' });
    const { token } = await login(ctx(), { email: 'ada@example.test', password: PASSWORD });

    await expect(logout(ctx(), 'A'.repeat(43))).resolves.toBeUndefined();
    await expect(logout(ctx(), '')).resolves.toBeUndefined();
    await logout(ctx(), token);
    await expect(logout(ctx(), token)).resolves.toBeUndefined();

    const logouts = (await auditRows()).filter((r) => r.action === 'auth.logout');
    expect(logouts).toHaveLength(1);
  });
});
