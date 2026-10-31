import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { SessionUser } from '@/modules/auth';
import type { Actor } from '@/platform/authz';
import { authorize } from '@/platform/authz';
import { Conflict, NotFound, RateLimited } from '@/platform/errors';
import { logger } from '@/platform/log/logger';
import { fixedClock } from '@/platform/time';
import { createRoute, type RouteDeps } from './route';

const ORIGIN = 'https://app.example.com';
const actor: Actor = { userId: 'user-1', role: 'branch_lead', branchId: 'branch-1' };
const user: SessionUser = {
  id: 'user-1',
  email: 'lead@example.test',
  name: 'Lead',
  role: 'branch_lead',
  branchId: 'branch-1',
};
const token = 'A'.repeat(43);
const cookie = `__Host-shiplens_session=${token}`;

function setup() {
  const resolveActor = vi.fn<RouteDeps['resolveActor']>(async () => ({ actor, user }));
  const handler = vi.fn(async () => ({ data: { ok: true } }));
  const env = vi.fn(() => ({ APP_ORIGIN: ORIGIN }));
  const pool = vi.fn(() => ({}) as Pool);
  const authorizeFn = vi.fn(authorize);
  const wrap = createRoute({
    env,
    pool,
    clock: fixedClock('2026-10-28T00:00:00Z'),
    resolveActor,
    authorizeFn,
  });
  const request = (
    method = 'GET',
    options: {
      origin?: string;
      cookie?: string;
      body?: string;
      contentType?: string;
      url?: string;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const headers = new Headers(options.headers);
    if (options.origin) headers.set('origin', options.origin);
    if (options.cookie) headers.set('cookie', options.cookie);
    if (options.contentType) headers.set('content-type', options.contentType);
    return new Request(options.url ?? `${ORIGIN}/api/v1/probe`, {
      method,
      headers,
      body: options.body,
    });
  };
  const call = (endpoint: ReturnType<typeof wrap>, req: Request) =>
    endpoint(req, { params: Promise.resolve({ id: 'item-1' }) });
  return { wrap, request, call, resolveActor, handler, env, pool, authorizeFn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('route() Origin check', () => {
  it.each([
    undefined,
    'null',
    'https://other.test',
    'http://app.example.com',
    'https://app.example.com.evil.test',
  ])('refuses mutation Origin %s before session lookup or handler', async (origin) => {
    const s = setup();
    const response = await s.call(
      s.wrap({ auth: 'session', action: 'branch.read' }, s.handler),
      s.request('POST', { origin, cookie }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toBe('Cross-origin request refused');
    expect(s.resolveActor).not.toHaveBeenCalled();
    expect(s.authorizeFn).not.toHaveBeenCalled();
    expect(s.handler).not.toHaveBeenCalled();
  });

  it('refuses a mutation with Sec-Fetch-Site but no Origin', async () => {
    const s = setup();
    const response = await s.call(
      s.wrap({ auth: 'public' }, s.handler),
      s.request('POST', { headers: { 'sec-fetch-site': 'same-origin' } }),
    );
    expect(response.status).toBe(403);
    expect(s.handler).not.toHaveBeenCalled();
  });

  it('accepts the app Origin and skips the check for read methods', async () => {
    const s = setup();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await s.call(
        s.wrap({ auth: 'public' }, s.handler),
        s.request(method, { origin: ORIGIN }),
      );
      expect(response.status).toBe(200);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const response = await s.call(s.wrap({ auth: 'public' }, s.handler), s.request(method));
      expect(response.status).toBe(200);
    }
  });

  it('checks Origin on a GET marked mutating and skips it on a POST marked non-mutating', async () => {
    const s = setup();
    const forced = await s.call(
      s.wrap({ auth: 'public', mutating: true }, s.handler),
      s.request('GET'),
    );
    expect(forced.status).toBe(403);
    const relaxed = await s.call(
      s.wrap({ auth: 'public', mutating: false }, s.handler),
      s.request('POST'),
    );
    expect(relaxed.status).toBe(200);
  });
});

describe('route() request id', () => {
  it('echoes a well-formed id and replaces malformed ones', async () => {
    const s = setup();
    const endpoint = s.wrap({ auth: 'public' }, async () => {
      throw new NotFound();
    });
    const valid = await s.call(
      endpoint,
      s.request('GET', { headers: { 'x-request-id': 'abc_123-XYZ' } }),
    );
    expect(valid.headers.get('x-request-id')).toBe('abc_123-XYZ');
    expect((await valid.json()).error.requestId).toBe('abc_123-XYZ');
    for (const bad of ['x'.repeat(65), 'has space', 'semi;colon']) {
      const response = await s.call(
        endpoint,
        s.request('GET', { headers: { 'x-request-id': bad } }),
      );
      const id = response.headers.get('x-request-id');
      expect(id).toMatch(/^[a-f0-9-]{36}$/);
      expect((await response.json()).error.requestId).toBe(id);
    }
  });

  it('puts the request id on successful responses too', async () => {
    const s = setup();
    const response = await s.call(s.wrap({ auth: 'public' }, s.handler), s.request());
    expect(response.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
  });
});

describe('route() session and authorisation', () => {
  it('returns 401 without a session and 403 for a denied action, never reaching the handler', async () => {
    const s = setup();
    const endpoint = s.wrap({ auth: 'session', action: 'branch.create' }, s.handler);
    s.resolveActor.mockResolvedValueOnce(null as never);
    const absent = await s.call(endpoint, s.request('GET'));
    expect(absent.status).toBe(401);
    expect((await absent.json()).error.code).toBe('unauthenticated');
    const denied = await s.call(endpoint, s.request('GET', { cookie }));
    expect(denied.status).toBe(403);
    expect(s.authorizeFn).toHaveBeenCalledWith(actor, 'branch.create');
    expect(s.handler).not.toHaveBeenCalled();
  });

  it('reads the token from the cookie matching the APP_ORIGIN scheme', async () => {
    const s = setup();
    await s.call(s.wrap({ auth: 'session' }, s.handler), s.request('GET', { cookie }));
    expect(s.resolveActor).toHaveBeenLastCalledWith(token);
    await s.call(
      s.wrap({ auth: 'session' }, s.handler),
      s.request('GET', { cookie: `shiplens_session=${token}` }),
    );
    expect(s.resolveActor).toHaveBeenLastCalledWith(null);
  });

  it('logs denied requests with request id, action, role and path but no cookie or body', async () => {
    const s = setup();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const endpoint = s.wrap(
      { auth: 'session', action: 'branch.create', body: z.object({ secret: z.string() }) },
      s.handler,
    );
    const response = await s.call(
      endpoint,
      s.request('POST', {
        origin: ORIGIN,
        cookie,
        body: JSON.stringify({ secret: 'body-value' }),
        contentType: 'application/json',
        headers: { 'x-request-id': 'deny-1' },
      }),
    );
    expect(response.status).toBe(403);
    expect(warn).toHaveBeenCalledWith('http.denied', {
      requestId: 'deny-1',
      action: 'branch.create',
      role: 'branch_lead',
      path: '/api/v1/probe',
    });
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('body-value');
  });

  it('passes only the session actor, never client-supplied role or branch', async () => {
    const s = setup();
    const endpoint = s.wrap(
      {
        auth: 'session',
        action: 'branch.read',
        query: z.object({ role: z.string(), branchId: z.string() }),
        body: z.object({ role: z.string(), branchId: z.string() }),
      },
      async (c) => ({
        data: {
          actor: c.actor,
          user: c.user,
          scope: c.scope,
          params: c.params,
          query: c.query,
          body: c.body,
          commandActor: c.command.actor,
          requestId: c.requestId,
          ip: c.ip,
        },
      }),
    );
    const response = await s.call(
      endpoint,
      s.request('POST', {
        origin: ORIGIN,
        cookie,
        url: `${ORIGIN}/api/v1/probe?role=super_admin&branchId=other`,
        body: JSON.stringify({ role: 'super_admin', branchId: 'other' }),
        contentType: 'application/json',
        headers: {
          'x-role': 'super_admin',
          'x-branch-id': 'other',
          'x-forwarded-for': '1.2.3.4, 5.6.7.8',
          'x-request-id': 'echo-1',
        },
      }),
    );
    const data = await response.json();
    expect(data.actor).toEqual(actor);
    expect(data.user).toEqual(user);
    expect(data.scope).toEqual({ kind: 'branch', branchId: 'branch-1' });
    expect(data.params).toEqual({ id: 'item-1' });
    expect(data.commandActor).toEqual(actor);
    expect(data.requestId).toBe('echo-1');
    expect(data.query).toEqual({ role: 'super_admin', branchId: 'other' });
    expect(data.body).toEqual({ role: 'super_admin', branchId: 'other' });
    expect(data.ip).toBe('1.2.3.4');
  });

  it('keeps a public context anonymous and leaves ip undefined without a forwarded header', async () => {
    const s = setup();
    const endpoint = s.wrap({ auth: 'public' }, async (c) => ({
      data: {
        actor: c.actor,
        user: c.user,
        scope: c.scope,
        commandActor: c.command.actor,
        ip: c.ip ?? 'none',
      },
    }));
    const response = await s.call(endpoint, s.request('GET', { cookie }));
    expect(await response.json()).toEqual({
      actor: null,
      user: null,
      scope: null,
      commandActor: null,
      ip: 'none',
    });
    expect(s.resolveActor).not.toHaveBeenCalled();
  });
});

describe('route() input parsing', () => {
  it.each([
    ['invalid JSON', '{', 'application/json', 'invalid_json'],
    ['wrong content type', '{}', 'text/plain', 'invalid_content_type'],
    ['a body over 64 KB', 'x'.repeat(65_537), 'application/json', 'payload_too_large'],
  ])('returns 422 for %s', async (_label, body, contentType, code) => {
    const s = setup();
    const response = await s.call(
      s.wrap({ auth: 'public', body: z.object({ name: z.string() }) }, s.handler),
      s.request('POST', { origin: ORIGIN, body, contentType }),
    );
    expect(response.status).toBe(422);
    const result = await response.json();
    expect(result.error.code).toBe('validation_failed');
    expect(result.error.details.fields[0].code).toBe(code);
    expect(s.handler).not.toHaveBeenCalled();
  });

  it('accepts a JSON content type with a charset parameter', async () => {
    const s = setup();
    const response = await s.call(
      s.wrap({ auth: 'public', body: z.object({ name: z.string() }) }, s.handler),
      s.request('POST', {
        origin: ORIGIN,
        body: '{"name":"a"}',
        contentType: 'application/json; charset=utf-8',
      }),
    );
    expect(response.status).toBe(200);
  });

  it('maps body and query schema failures to field errors', async () => {
    const s = setup();
    const body = await s.call(
      s.wrap({ auth: 'public', body: z.object({ name: z.string() }) }, s.handler),
      s.request('POST', { origin: ORIGIN, body: '{}', contentType: 'application/json' }),
    );
    expect(body.status).toBe(422);
    expect((await body.json()).error.details.fields[0].path).toBe('name');
    const query = await s.call(
      s.wrap({ auth: 'public', query: z.object({ page: z.coerce.number().min(1) }) }, s.handler),
      s.request('GET', { url: `${ORIGIN}/api/v1/probe?page=0` }),
    );
    expect(query.status).toBe(422);
    expect((await query.json()).error.details.fields[0].path).toBe('page');
  });

  it('parses the query before resolving the session', async () => {
    const s = setup();
    const response = await s.call(
      s.wrap({ auth: 'session', query: z.object({ page: z.coerce.number().min(1) }) }, s.handler),
      s.request('GET', { cookie, url: `${ORIGIN}/api/v1/probe?page=0` }),
    );
    expect(response.status).toBe(422);
    expect(s.resolveActor).not.toHaveBeenCalled();
  });
});

describe('route() errors and responses', () => {
  it('maps application errors and hides unknown error messages', async () => {
    const s = setup();
    const responseFor = (error: Error) =>
      s.call(
        s.wrap({ auth: 'public' }, async () => {
          throw error;
        }),
        s.request('GET', { headers: { 'x-request-id': 'same-id' } }),
      );
    const a = await responseFor(new NotFound());
    const b = await responseFor(new NotFound());
    expect(a.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
    const conflict = await responseFor(new Conflict('duplicate'));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('duplicate');
    const limited = await responseFor(new RateLimited(30));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');

    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const unknown = await responseFor(new Error('private detail'));
    expect(unknown.status).toBe(500);
    const text = await unknown.text();
    expect(text).not.toContain('private detail');
    expect(JSON.parse(text).error).toEqual({
      code: 'internal_error',
      message: 'Internal error',
      requestId: 'same-id',
    });
    expect(log).toHaveBeenCalledWith(
      'http.error',
      expect.objectContaining({ requestId: 'same-id' }),
    );
  });

  it('never logs the request body on a 500', async () => {
    const s = setup();
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const response = await s.call(
      s.wrap({ auth: 'public', body: z.object({ name: z.string() }) }, async () => {
        throw new Error('boom');
      }),
      s.request('POST', {
        origin: ORIGIN,
        body: JSON.stringify({ name: 'body-only-value' }),
        contentType: 'application/json',
      }),
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(log.mock.calls)).not.toContain('body-only-value');
  });

  it('adds no-store, nosniff and request id to every response kind', async () => {
    const s = setup();
    const handlers = [
      async () => new Response('ok'),
      async () => ({ status: 201, data: { ok: true } }),
      async () => ({ status: 204 }),
      async () => {
        throw new NotFound();
      },
    ];
    for (const handler of handlers) {
      const response = await s.call(s.wrap({ auth: 'public' }, handler), s.request());
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-request-id')).toBeTruthy();
    }
  });

  it('serialises status, data and headers, and sends an empty body for 204', async () => {
    const s = setup();
    const created = await s.call(
      s.wrap({ auth: 'public' }, async () => ({
        status: 201,
        data: { id: 'x' },
        headers: { 'set-cookie': 'a=b' },
      })),
      s.request(),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get('set-cookie')).toBe('a=b');
    expect(await created.json()).toEqual({ id: 'x' });
    const empty = await s.call(
      s.wrap({ auth: 'public' }, async () => ({ status: 204 })),
      s.request(),
    );
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe('');
  });
});

describe('route() import-time safety', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('imports route, origin, index and the auth route files with no environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('APP_ORIGIN', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', '');
    vi.resetModules();
    const envModule = await import('@/platform/config/env');
    envModule.resetEnvCache();
    // getEnv() throws in this environment, so any module-scope call would fail the import.
    expect(() => envModule.getEnv()).toThrow();
    await expect(import('./route')).resolves.toHaveProperty('route');
    await expect(import('./origin')).resolves.toHaveProperty('isAllowedOrigin');
    await expect(import('./index')).resolves.toHaveProperty('route');
    await expect(import('@/app/api/v1/auth/login/route')).resolves.toHaveProperty('POST');
    await expect(import('@/app/api/v1/auth/logout/route')).resolves.toHaveProperty('POST');
    await expect(import('@/app/api/v1/auth/me/route')).resolves.toHaveProperty('GET');
  });

  it('keeps route.ts and origin.ts free of framework imports', () => {
    for (const file of ['route.ts', 'origin.ts', 'index.ts']) {
      const source = readFileSync(path.join(import.meta.dirname, file), 'utf8');
      expect(source).not.toMatch(/from ['"]next\//);
      expect(source).not.toMatch(/['"]\.\/server['"]/);
    }
  });
});
