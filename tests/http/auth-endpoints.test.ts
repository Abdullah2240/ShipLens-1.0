import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as loginPost } from '@/app/api/v1/auth/login/route';
import { POST as logoutPost } from '@/app/api/v1/auth/logout/route';
import { GET as meGet } from '@/app/api/v1/auth/me/route';
import { LOGIN_THROTTLE } from '@/platform/config/constants';
import { resetEnvCache } from '@/platform/config/env';
import { closePool } from '@/platform/db';
import { route } from '@/platform/http/route';
import { hashPassword } from '../../scripts/lib/password.mjs';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { getBranchById } from '../support/probe-repo';

type Endpoint = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const APP = 'http://localhost:3000';
const PASSWORD = 'correct-horse-battery-staple';
let passwordHash: string;

function send(
  endpoint: Endpoint,
  path: string,
  init: {
    method?: string;
    cookie?: string;
    body?: unknown;
    origin?: string | null;
    requestId?: string;
    params?: Record<string, string>;
    base?: string;
  } = {},
): Promise<Response> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.cookie) headers.cookie = init.cookie;
  if (init.requestId) headers['x-request-id'] = init.requestId;
  if (method !== 'GET' && init.origin !== null) headers.origin = init.origin ?? init.base ?? APP;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return endpoint(
    new Request(`${init.base ?? APP}/api/v1${path}`, {
      method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
    { params: Promise.resolve(init.params ?? {}) },
  );
}

const login = (body: unknown, init: Parameters<typeof send>[2] = {}) =>
  send(loginPost, '/auth/login', { method: 'POST', body, ...init });
const me = (cookie?: string) => send(meGet, '/auth/me', { cookie });
const logout = (cookie?: string, init: Parameters<typeof send>[2] = {}) =>
  send(logoutPost, '/auth/logout', { method: 'POST', cookie, ...init });

/** The Cookie request header value carried by a Set-Cookie response header. */
function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0]!;
}

async function makeUser(role: string, branchId?: string) {
  const user = await seedUser(db, { role, branchId });
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, passwordHash]);
  return user;
}

async function loginAs(role: string, branchId?: string) {
  const user = await makeUser(role, branchId);
  const response = await login({ email: user.email, password: PASSWORD });
  expect(response.status).toBe(200);
  return { user, cookie: cookieFrom(response) };
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});
beforeEach(() => resetDb(db));
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('POST /api/v1/auth/login', () => {
  it('returns the user and sets an HttpOnly, SameSite=Lax session cookie', async () => {
    const branch = await seedBranch(db);
    const user = await makeUser('branch_lead', branch.id);
    const response = await login({ email: user.email, password: PASSWORD });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'branch_lead',
        branchId: branch.id,
      },
    });
    const setCookie = response.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^shiplens_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(Number(/Max-Age=(\d+)/.exec(setCookie)![1])).toBeGreaterThan(0);
    // Plain http in development, so no Secure flag here (see the https case below).
    expect(setCookie).not.toContain('Secure');
    const token = cookieFrom(response).split('=')[1]!;
    expect(text).not.toContain(token);
    expect(text).not.toContain('argon2');
    expect(text).not.toContain('password');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('marks the cookie Secure with the __Host- prefix when APP_ORIGIN is https', async () => {
    const https = 'https://shiplens.example.test';
    vi.stubEnv('APP_ORIGIN', https);
    resetEnvCache();
    try {
      const user = await makeUser('super_admin');
      const response = await login({ email: user.email, password: PASSWORD }, { base: https });
      expect(response.status).toBe(200);
      const setCookie = response.headers.get('set-cookie')!;
      expect(setCookie).toMatch(/^__Host-shiplens_session=/);
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      const cookie = cookieFrom(response);
      expect((await send(meGet, '/auth/me', { cookie, base: https })).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
      resetEnvCache();
    }
  });

  it('answers unknown email and wrong password identically', async () => {
    const user = await makeUser('super_admin');
    const wrong = await login(
      { email: user.email, password: 'not-the-password' },
      { requestId: 'same-request' },
    );
    const unknown = await login(
      { email: 'nobody@example.test', password: 'not-the-password' },
      { requestId: 'same-request' },
    );
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.text()).toBe(await wrong.text());
    expect([...unknown.headers.entries()]).toEqual([...wrong.headers.entries()]);
    expect(wrong.headers.get('set-cookie')).toBeNull();
  });

  it('throttles the sixth failure with 429 and Retry-After', async () => {
    const user = await makeUser('super_admin');
    for (let i = 0; i < LOGIN_THROTTLE.maxFailuresPerEmail; i += 1) {
      expect((await login({ email: user.email, password: 'wrong-password' })).status).toBe(401);
    }
    const limited = await login({ email: user.email, password: PASSWORD });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await limited.json()).error.code).toBe('rate_limited');
  });

  it('rejects extra keys such as role with 422 unrecognized_keys', async () => {
    const user = await makeUser('content_editor');
    const response = await login({ email: user.email, password: PASSWORD, role: 'super_admin' });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.fields[0].code).toBe('unrecognized_keys');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses login and logout without Origin or with a foreign Origin', async () => {
    const { user, cookie } = await loginAs('super_admin');
    for (const origin of [null, 'https://evil.example.test']) {
      const refusedLogin = await login({ email: user.email, password: PASSWORD }, { origin });
      expect(refusedLogin.status).toBe(403);
      expect((await refusedLogin.json()).error.code).toBe('forbidden');
      expect((await logout(cookie, { origin })).status).toBe(403);
    }
    // The refused logouts did not end the session.
    expect((await me(cookie)).status).toBe(200);
  });
});

describe('GET /api/v1/auth/me and POST /api/v1/auth/logout', () => {
  it('returns the user with the cookie and 401 without it', async () => {
    const { user, cookie } = await loginAs('finance_reviewer');
    const ok = await me(cookie);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: 'finance_reviewer',
        branchId: null,
      },
    });
    const missing = await me();
    expect(missing.status).toBe(401);
    expect((await missing.json()).error.code).toBe('unauthenticated');
  });

  it('logs out, clears the cookie and invalidates the token server-side', async () => {
    const branch = await seedBranch(db);
    const { user, cookie } = await loginAs('hr_lead', branch.id);
    const response = await logout(cookie);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    const cleared = response.headers.get('set-cookie')!;
    expect(cleared).toMatch(/^shiplens_session=;/);
    expect(cleared).toContain('Max-Age=0');
    expect((await me(cookie)).status).toBe(401);
    expect((await logout(cookie)).status).toBe(401);

    const { rows } = await db.query<{ action: string; actor_id: string; actor_role: string }>(
      "SELECT action, actor_id, actor_role FROM audit_events WHERE action IN ('auth.login', 'auth.logout') ORDER BY id",
    );
    expect(rows).toEqual([
      { action: 'auth.login', actor_id: user.id, actor_role: 'hr_lead' },
      { action: 'auth.logout', actor_id: user.id, actor_role: 'hr_lead' },
    ]);
  });

  it('shows a role change on the next request', async () => {
    const { user, cookie } = await loginAs('content_editor');
    expect((await (await me(cookie)).json()).user.role).toBe('content_editor');
    await db.query("UPDATE users SET role = 'super_admin' WHERE id = $1", [user.id]);
    expect((await (await me(cookie)).json()).user.role).toBe('super_admin');
  });
});

describe('generic probes through route()', () => {
  const createProbe = route({ auth: 'session', action: 'branch.create' }, async () => ({
    data: { ok: true },
  }));
  const readProbe = route({ auth: 'session', action: 'branch.read' }, async (c) => ({
    data: await getBranchById(c.command.pool, c.scope!, c.params.id!),
  }));
  const dashboardProbe = route({ auth: 'session', action: 'dashboard.read' }, async () => ({
    data: { ok: true },
  }));

  it('returns 403 to a branch lead and 200 to a super admin for branch.create', async () => {
    const branch = await seedBranch(db);
    const lead = await loginAs('branch_lead', branch.id);
    const admin = await loginAs('super_admin');
    const denied = await send(createProbe, '/probe', { cookie: lead.cookie });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('forbidden');
    expect((await send(createProbe, '/probe', { cookie: admin.cookie })).status).toBe(200);
  });

  it('returns byte-identical 404s for another branch and a nonexistent id', async () => {
    const own = await seedBranch(db);
    const other = await seedBranch(db);
    const lead = await loginAs('branch_lead', own.id);
    const read = (id: string) =>
      send(readProbe, `/branches/${id}`, {
        cookie: lead.cookie,
        params: { id },
        requestId: 'probe-404',
      });
    const mine = await read(own.id);
    expect(mine.status).toBe(200);
    expect((await mine.json()).id).toBe(own.id);
    const foreign = await read(other.id);
    const missing = await read(randomUUID());
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
  });

  it('returns 403 to a content editor asking for a dashboard-only action', async () => {
    const editor = await loginAs('content_editor');
    expect((await send(dashboardProbe, '/probe', { cookie: editor.cookie })).status).toBe(403);
  });
});
