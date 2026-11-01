import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { createSessionCookie } from '../../../tests/support/session';
import { createRoute } from './route';

const pool = testPool();
const route = createRoute({
  env: () => ({ APP_ORIGIN: 'http://localhost:3000' }),
  pool: () => pool,
});
const echo = route({ auth: 'session' }, async (c) => ({
  data: { actor: c.actor, user: c.user, commandActor: c.command.actor },
}));

async function call(
  endpoint: typeof echo,
  cookie?: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; url?: string } = {},
) {
  return endpoint(
    new Request(init.url ?? 'http://localhost:3000/api/v1/probe', {
      method: init.method ?? 'GET',
      headers: { ...(cookie ? { cookie } : {}), ...init.headers },
      body: init.body,
    }),
    { params: Promise.resolve({}) },
  );
}

beforeEach(async () => resetDb(pool));
afterAll(async () => closeTestPool());

describe('route() with real sessions', () => {
  it('reads actor and user from the session row', async () => {
    const branch = await seedBranch(pool);
    const user = await seedUser(pool, { role: 'branch_lead', branchId: branch.id });
    const cookie = await createSessionCookie(pool, user.id);
    const response = await call(echo, cookie);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({
      actor: { userId: user.id, role: 'branch_lead', branchId: branch.id },
      user: { id: user.id, email: user.email, role: 'branch_lead', branchId: branch.id },
    });
    expect(data.commandActor).toEqual(data.actor);
  });

  it('ignores role and branch sent by the client in query, body and headers', async () => {
    const branch = await seedBranch(pool);
    const other = await seedBranch(pool);
    const user = await seedUser(pool, { role: 'branch_lead', branchId: branch.id });
    const cookie = await createSessionCookie(pool, user.id);
    const response = await call(echo, cookie, {
      method: 'POST',
      url: `http://localhost:3000/api/v1/probe?role=super_admin&branchId=${other.id}`,
      headers: {
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
        'x-role': 'super_admin',
        'x-branch-id': other.id,
      },
      body: JSON.stringify({ role: 'super_admin', branchId: other.id }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).actor).toMatchObject({
      role: 'branch_lead',
      branchId: branch.id,
    });
  });

  it('reads the role from the database on every request', async () => {
    const user = await seedUser(pool, { role: 'content_editor' });
    const cookie = await createSessionCookie(pool, user.id);
    expect((await (await call(echo, cookie)).json()).actor.role).toBe('content_editor');
    await pool.query("UPDATE users SET role = 'super_admin' WHERE id = $1", [user.id]);
    expect((await (await call(echo, cookie)).json()).actor.role).toBe('super_admin');
  });

  it('returns 401 for no cookie, unknown token, revoked and expired sessions', async () => {
    const user = await seedUser(pool, { role: 'super_admin' });
    const cookie = await createSessionCookie(pool, user.id);
    expect((await call(echo)).status).toBe(401);
    expect((await call(echo, `shiplens_session=${'Z'.repeat(43)}`)).status).toBe(401);
    await pool.query('UPDATE sessions SET revoked_at = now()');
    expect((await call(echo, cookie)).status).toBe(401);
    await pool.query(
      "UPDATE sessions SET revoked_at = NULL, expires_at = now() - interval '1 minute'",
    );
    expect((await call(echo, cookie)).status).toBe(401);
  });

  it('denies a branch lead branch.create and allows a super admin', async () => {
    const branch = await seedBranch(pool);
    const lead = await seedUser(pool, { role: 'branch_lead', branchId: branch.id });
    const admin = await seedUser(pool, { role: 'super_admin' });
    const create = route({ auth: 'session', action: 'branch.create' }, async (c) => ({
      data: { scope: c.scope },
    }));
    expect((await call(create, await createSessionCookie(pool, lead.id))).status).toBe(403);
    const allowed = await call(create, await createSessionCookie(pool, admin.id));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ scope: { kind: 'all' } });
  });
});
