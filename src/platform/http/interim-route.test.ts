import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Actor } from '@/platform/authz';
import { authorize } from '@/platform/authz';
import { Conflict, NotFound, RateLimited } from '@/platform/errors';
import { logger } from '@/platform/log/logger';
import { fixedClock } from '@/platform/time';
import type { SessionUser } from '@/modules/auth';
import { createRoute } from './interim-route';

const actor: Actor = { userId: 'user-1', role: 'branch_lead', branchId: 'branch-1' };
const user: SessionUser = {
  id: 'user-1',
  email: 'lead@example.test',
  name: 'Lead',
  role: 'branch_lead',
  branchId: 'branch-1',
};
const token = 'A'.repeat(43);

function setup() {
  const resolveActor = vi.fn(async () => ({ actor, user }));
  const handler = vi.fn(async () => ({ data: { ok: true } }));
  const env = vi.fn(() => ({ APP_ORIGIN: 'https://app.example.com' }));
  const pool = vi.fn(() => ({}) as Pool);
  const wrap = createRoute({
    env,
    pool,
    clock: fixedClock('2026-10-28T00:00:00Z'),
    resolveActor,
    authorizeFn: authorize,
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
    return new Request(options.url ?? 'https://app.example.com/api/v1/probe', {
      method,
      headers,
      body: options.body,
    });
  };
  const call = (endpoint: ReturnType<typeof wrap>, req: Request) =>
    endpoint(req, { params: Promise.resolve({ id: 'item-1' }) });
  return { wrap, request, call, resolveActor, handler, env, pool };
}

describe('interim route adapter', () => {
  it.each([
    undefined,
    'null',
    'https://other.test',
    'http://app.example.com',
    'https://app.example.com.evil.test',
  ])('rejects unsafe mutation Origin %s before actor resolution', async (origin) => {
    const s = setup();
    const response = await s.call(
      s.wrap({ auth: 'session' }, s.handler),
      s.request('POST', { origin, cookie: `__Host-shiplens_session=${token}` }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('forbidden');
    expect(s.resolveActor).not.toHaveBeenCalled();
    expect(s.handler).not.toHaveBeenCalled();
  });

  it('accepts safe Origin and skips the check for read methods', async () => {
    const s = setup();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        (
          await s.call(
            s.wrap({ auth: 'public' }, s.handler),
            s.request(method, { origin: 'https://app.example.com' }),
          )
        ).status,
      ).toBe(200);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect((await s.call(s.wrap({ auth: 'public' }, s.handler), s.request(method))).status).toBe(
        200,
      );
    }
  });

  it('uses a valid request id and replaces invalid ids', async () => {
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
    const invalid = await s.call(
      endpoint,
      s.request('GET', { headers: { 'x-request-id': 'x'.repeat(65) } }),
    );
    expect(invalid.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('requires a session and checks the action before invoking the handler', async () => {
    const s = setup();
    const endpoint = s.wrap({ auth: 'session', action: 'branch.create' }, s.handler);
    s.resolveActor.mockResolvedValueOnce(null as never);
    const absent = await s.call(endpoint, s.request('GET'));
    expect(absent.status).toBe(401);
    expect(s.handler).not.toHaveBeenCalled();
    const denied = await s.call(
      endpoint,
      s.request('GET', { cookie: `__Host-shiplens_session=${token}` }),
    );
    expect(denied.status).toBe(403);
    expect(s.handler).not.toHaveBeenCalled();
  });

  it('passes only the resolved actor, scope, params, query, command and first forwarded IP', async () => {
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
          ip: c.ip,
        },
      }),
    );
    const response = await s.call(
      endpoint,
      s.request('POST', {
        origin: 'https://app.example.com',
        cookie: `__Host-shiplens_session=${token}`,
        url: 'https://app.example.com/api/v1/probe?role=super_admin&branchId=other',
        body: JSON.stringify({ role: 'super_admin', branchId: 'other' }),
        contentType: 'application/json',
        headers: {
          'x-role': 'super_admin',
          'x-branch-id': 'other',
          'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        },
      }),
    );
    const data = await response.json();
    expect(data.actor).toEqual(actor);
    expect(data.user).toEqual(user);
    expect(data.scope).toEqual({ kind: 'branch', branchId: 'branch-1' });
    expect(data.params).toEqual({ id: 'item-1' });
    expect(data.commandActor).toEqual(actor);
    expect(data.body).toEqual({ role: 'super_admin', branchId: 'other' });
    expect(data.ip).toBe('1.2.3.4');
  });

  it('keeps public context anonymous', async () => {
    const s = setup();
    const endpoint = s.wrap({ auth: 'public' }, async (c) => ({
      data: { actor: c.actor, user: c.user, scope: c.scope, commandActor: c.command.actor },
    }));
    expect(
      await (
        await s.call(endpoint, s.request('GET', { cookie: `__Host-shiplens_session=${token}` }))
      ).json(),
    ).toEqual({ actor: null, user: null, scope: null, commandActor: null });
    expect(s.resolveActor).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid JSON', '{', 'application/json', 'invalid_json'],
    ['wrong type', '{}', 'text/plain', 'invalid_content_type'],
    ['large body', 'x'.repeat(65_537), 'application/json', 'payload_too_large'],
  ])('returns 422 for %s', async (_label, body, contentType, code) => {
    const s = setup();
    const response = await s.call(
      s.wrap({ auth: 'public', body: z.object({ name: z.string() }) }, s.handler),
      s.request('POST', { origin: 'https://app.example.com', body, contentType }),
    );
    expect(response.status).toBe(422);
    const result = await response.json();
    expect(result.error.code).toBe('validation_failed');
    expect(result.error.details.fields[0].code).toBe(code);
    expect(s.handler).not.toHaveBeenCalled();
  });

  it('maps body and query schema failures to field errors', async () => {
    const s = setup();
    const body = await s.call(
      s.wrap({ auth: 'public', body: z.object({ name: z.string() }) }, s.handler),
      s.request('POST', {
        origin: 'https://app.example.com',
        body: '{}',
        contentType: 'application/json',
      }),
    );
    expect(body.status).toBe(422);
    expect((await body.json()).error.details.fields[0].path).toBe('name');
    const query = await s.call(
      s.wrap({ auth: 'public', query: z.object({ page: z.coerce.number().min(1) }) }, s.handler),
      s.request('GET', { url: 'https://app.example.com/api/v1/probe?page=0' }),
    );
    expect(query.status).toBe(422);
  });

  it('maps application errors and logs unknown errors without request data', async () => {
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
    expect(await a.json()).toEqual(await b.json());
    const conflict = await responseFor(new Conflict('duplicate'));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('duplicate');
    const limited = await responseFor(new RateLimited(30));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('30');
    const log = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const unknown = await responseFor(new Error('private detail'));
    expect(unknown.status).toBe(500);
    expect((await unknown.json()).error.message).toBe('Internal error');
    expect(log).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('cookie');
    log.mockRestore();
  });

  it('adds security headers to returned Response and JSON responses', async () => {
    const s = setup();
    for (const handler of [
      async () => new Response('ok'),
      async () => ({ status: 201, data: { ok: true } }),
    ]) {
      const response = await s.call(s.wrap({ auth: 'public' }, handler), s.request());
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-request-id')).toBeTruthy();
    }
  });
});
