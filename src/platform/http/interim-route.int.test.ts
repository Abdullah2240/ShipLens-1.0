import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { createSessionCookie } from '../../../tests/support/session';
import { createRoute } from './interim-route';

const pool = testPool();
const route = createRoute({
  env: () => ({ APP_ORIGIN: 'http://localhost:3000' }),
  pool: () => pool,
});
const endpoint = route({ auth: 'session' }, async (c) => ({
  data: { actor: c.actor, user: c.user },
}));

async function call(cookie?: string) {
  const headers = cookie ? { cookie } : undefined;
  return endpoint(new Request('http://localhost:3000/api/v1/probe', { headers }), {
    params: Promise.resolve({}),
  });
}

beforeEach(async () => resetDb(pool));
afterAll(async () => closeTestPool());

describe('interim route real sessions', () => {
  it('reads actor and user from the session row', async () => {
    const branch = await seedBranch(pool);
    const user = await seedUser(pool, { role: 'branch_lead', branchId: branch.id });
    const cookie = await createSessionCookie(pool, user.id);
    const response = await call(cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      actor: { userId: user.id, role: 'branch_lead', branchId: branch.id },
      user: { id: user.id, email: user.email },
    });
  });

  it('returns 401 for no cookie, unknown token, revoked and expired sessions', async () => {
    const user = await seedUser(pool, { role: 'super_admin' });
    const cookie = await createSessionCookie(pool, user.id);
    expect((await call()).status).toBe(401);
    expect((await call(`shiplens_session=${'Z'.repeat(43)}`)).status).toBe(401);
    await pool.query('UPDATE sessions SET revoked_at = now()');
    expect((await call(cookie)).status).toBe(401);
    await pool.query(
      "UPDATE sessions SET revoked_at = NULL, expires_at = now() - interval '1 minute'",
    );
    expect((await call(cookie)).status).toBe(401);
  });

  it('denies a branch lead the branch.create action', async () => {
    const branch = await seedBranch(pool);
    const user = await seedUser(pool, { role: 'branch_lead', branchId: branch.id });
    const cookie = await createSessionCookie(pool, user.id);
    const protectedRoute = route({ auth: 'session', action: 'branch.create' }, async () => ({
      data: { ok: true },
    }));
    const response = await protectedRoute(
      new Request('http://localhost:3000/api/v1/branches', { headers: { cookie } }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(403);
  });
});
