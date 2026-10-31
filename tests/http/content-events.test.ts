import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

import { GET as listRoute, POST as createRoute } from '@/app/api/v1/content/events/route';
import { GET as getRoute, PATCH as patchRoute } from '@/app/api/v1/content/events/[id]/route';
import { POST as publishRoute } from '@/app/api/v1/content/events/[id]/publish/route';
import { POST as unpublishRoute } from '@/app/api/v1/content/events/[id]/unpublish/route';
import { listUpcomingEvents } from '@/modules/public-site';
import { closePool } from '@/platform/db';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const base = 'http://localhost:3000/api/v1/content/events';
const ORIGIN = 'http://localhost:3000';
const clock = fixedClock('2026-11-01T00:00:00.000Z');
const publicList = () => listUpcomingEvents(db, 'en', clock);

function send(
  handler: Handler,
  method: string,
  opts: {
    id?: string;
    suffix?: string;
    cookie?: string;
    body?: unknown;
    origin?: string | null;
  } = {},
): Promise<Response> {
  const params: Record<string, string> = opts.id !== undefined ? { id: opts.id } : {};
  const path = opts.id !== undefined ? `/${opts.id}${opts.suffix ?? ''}` : '';
  const origin = opts.origin === undefined ? (method === 'GET' ? null : ORIGIN) : opts.origin;
  return handler(
    new Request(`${base}${path}`, {
      method,
      headers: {
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(origin ? { origin } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve(params) },
  );
}

const camp = {
  titleEn: 'Health camp',
  titleUr: 'طبی کیمپ',
  location: 'Community hall',
  startsAt: '2026-11-15T09:00:00Z',
  endsAt: '2026-11-15T11:00:00Z',
};

async function cookieFor(role: string): Promise<string> {
  const branchId = role === 'hr_lead' || role === 'branch_lead' ? (await seedBranch(db)).id : null;
  const user = await seedUser(db, { role, branchId });
  return createSessionCookie(db, user.id);
}
async function auditCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM audit_events');
  return rows[0]!.n;
}
function expectNoStore(response: Response) {
  expect(response.headers.get('cache-control')).toBe('no-store');
}
async function created(cookie: string, body: unknown = camp): Promise<{ id: string }> {
  const response = await send(createRoute, 'POST', { cookie, body });
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

beforeEach(async () => {
  await resetDb(db);
  revalidatePath.mockReset();
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('content event routes', () => {
  it('requires a session and the content role on every route', async () => {
    const id = randomUUID();
    const routes: { name: string; call: (cookie?: string) => Promise<Response> }[] = [
      { name: 'list', call: (cookie) => send(listRoute, 'GET', { cookie }) },
      { name: 'create', call: (cookie) => send(createRoute, 'POST', { cookie, body: camp }) },
      { name: 'get', call: (cookie) => send(getRoute, 'GET', { id, cookie }) },
      {
        name: 'patch',
        call: (cookie) => send(patchRoute, 'PATCH', { id, cookie, body: { location: 'x' } }),
      },
      {
        name: 'publish',
        call: (cookie) => send(publishRoute, 'POST', { id, suffix: '/publish', cookie }),
      },
      {
        name: 'unpublish',
        call: (cookie) => send(unpublishRoute, 'POST', { id, suffix: '/unpublish', cookie }),
      },
    ];
    for (const { call } of routes) {
      const response = await call();
      expect(response.status).toBe(401);
      expectNoStore(response);
    }
    for (const role of ['hr_lead', 'branch_lead', 'finance_reviewer']) {
      const cookie = await cookieFor(role);
      for (const { name, call } of routes) {
        const response = await call(cookie);
        expect({ role, name, status: response.status }).toEqual({ role, name, status: 403 });
        expectNoStore(response);
      }
    }
    expect(await auditCount()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects mutations without a matching Origin', async () => {
    const cookie = await cookieFor('content_editor');
    const { id } = await created(cookie);
    const before = await auditCount();
    for (const response of [
      await send(createRoute, 'POST', { cookie, body: camp, origin: null }),
      await send(patchRoute, 'PATCH', { id, cookie, body: { location: 'x' }, origin: null }),
      await send(publishRoute, 'POST', { id, suffix: '/publish', cookie, origin: null }),
      await send(unpublishRoute, 'POST', {
        id,
        suffix: '/unpublish',
        cookie,
        origin: 'https://evil.example',
      }),
    ]) {
      expect(response.status).toBe(403);
      expectNoStore(response);
    }
    expect(await auditCount()).toBe(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('drafts, publishes, edits and unpublishes with the public list following the published copy', async () => {
    const cookie = await cookieFor('content_editor');

    const create = await send(createRoute, 'POST', { cookie, body: camp });
    expect(create.status).toBe(201);
    expectNoStore(create);
    const draft = (await create.json()).data;
    expect(draft).toMatchObject({
      slug: expect.stringMatching(/^evt-[0-9a-f]{8}$/),
      titleEn: 'Health camp',
      startsAt: '2026-11-15T09:00:00.000Z',
      status: 'draft',
    });
    expect(await publicList()).toEqual([]);

    const list = await send(listRoute, 'GET', { cookie });
    expect(list.status).toBe(200);
    expectNoStore(list);
    expect((await list.json()).data).toEqual([expect.objectContaining({ id: draft.id })]);

    const read = await send(getRoute, 'GET', { id: draft.id, cookie });
    expect(read.status).toBe(200);
    expect((await read.json()).data).toMatchObject({ id: draft.id, location: 'Community hall' });

    const published = await send(publishRoute, 'POST', {
      id: draft.id,
      suffix: '/publish',
      cookie,
    });
    expect(published.status).toBe(200);
    expectNoStore(published);
    expect((await published.json()).data).toMatchObject({ status: 'published' });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await publicList()).toEqual([
      expect.objectContaining({ title: 'Health camp', location: 'Community hall' }),
    ]);

    const patched = await send(patchRoute, 'PATCH', {
      id: draft.id,
      cookie,
      body: { titleEn: 'Health camp (moved)', location: 'Main hall' },
    });
    expect(patched.status).toBe(200);
    expectNoStore(patched);
    expect((await patched.json()).data).toMatchObject({
      titleEn: 'Health camp (moved)',
      status: 'published',
      hasUnpublishedChanges: true,
    });
    expect(await publicList()).toEqual([
      expect.objectContaining({ title: 'Health camp', location: 'Community hall' }),
    ]);
    expect(revalidatePath).toHaveBeenCalledTimes(1);

    const unpublished = await send(unpublishRoute, 'POST', {
      id: draft.id,
      suffix: '/unpublish',
      cookie,
    });
    expect(unpublished.status).toBe(200);
    expectNoStore(unpublished);
    expect((await unpublished.json()).data).toMatchObject({ status: 'draft' });
    expect(await publicList()).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it('lets a super admin run the same flow', async () => {
    const cookie = await cookieFor('super_admin');
    const { id } = await created(cookie);
    expect((await send(publishRoute, 'POST', { id, suffix: '/publish', cookie })).status).toBe(200);
    expect(await publicList()).toHaveLength(1);
  });

  it('rejects invalid bodies with 422 and writes nothing', async () => {
    const cookie = await cookieFor('content_editor');
    const fieldsOf = async (response: Response) => {
      expect(response.status).toBe(422);
      expectNoStore(response);
      return (await response.json()).error.details.fields;
    };

    expect(
      await fieldsOf(
        await send(createRoute, 'POST', {
          cookie,
          body: { ...camp, endsAt: '2026-11-15T08:00:00Z' },
        }),
      ),
    ).toEqual([expect.objectContaining({ path: 'endsAt', message: 'ends_before_start' })]);
    expect(
      await fieldsOf(
        await send(createRoute, 'POST', {
          cookie,
          body: { ...camp, startsAt: '2026-11-15T09:00:00+05:00' },
        }),
      ),
    ).toEqual([expect.objectContaining({ path: 'startsAt', message: 'invalid_datetime' })]);
    expect(
      await fieldsOf(
        await send(createRoute, 'POST', { cookie, body: { ...camp, status: 'published' } }),
      ),
    ).toEqual([expect.objectContaining({ code: 'unrecognized_keys' })]);
    expect(await fieldsOf(await send(createRoute, 'POST', { cookie, body: {} }))).toEqual([
      expect.objectContaining({ path: 'titleEn', message: 'required' }),
    ]);

    const { id } = await created(cookie);
    expect(await fieldsOf(await send(patchRoute, 'PATCH', { id, cookie, body: {} }))).toEqual([
      expect.objectContaining({ message: 'empty_patch' }),
    ]);
    expect(
      await fieldsOf(await send(patchRoute, 'PATCH', { id, cookie, body: { slug: 'mine' } })),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unrecognized_keys' })]));

    const undated = await created(cookie, { titleEn: 'Undated' });
    expect(
      await fieldsOf(
        await send(publishRoute, 'POST', { id: undated.id, suffix: '/publish', cookie }),
      ),
    ).toEqual([{ path: 'startsAt', code: 'required_to_publish', message: 'required_to_publish' }]);

    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM events');
    expect(rows[0]!.n).toBe(2);
    expect(await auditCount()).toBe(2);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('answers a single-date PATCH that breaks the stored pair with 422 on endsAt, not 500', async () => {
    const cookie = await cookieFor('content_editor');
    const { id } = await created(cookie);
    const before = await (await send(getRoute, 'GET', { id, cookie })).json();

    for (const body of [
      { startsAt: '2026-11-15T12:00:00.000Z' },
      { endsAt: '2026-11-15T08:00:00.000Z' },
    ]) {
      const response = await send(patchRoute, 'PATCH', { id, cookie, body });
      expect(response.status).toBe(422);
      expectNoStore(response);
      expect((await response.json()).error).toMatchObject({
        code: 'validation_failed',
        details: {
          fields: [{ path: 'endsAt', code: 'ends_before_start', message: 'ends_before_start' }],
        },
      });
    }
    expect(await (await send(getRoute, 'GET', { id, cookie })).json()).toEqual(before);

    const fine = await send(patchRoute, 'PATCH', {
      id,
      cookie,
      body: { startsAt: '2026-11-15T10:00:00.000Z' },
    });
    expect(fine.status).toBe(200);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns 409 for unpublishing a draft and an identical 404 for unknown ids', async () => {
    const cookie = await cookieFor('content_editor');
    const { id } = await created(cookie);
    const conflict = await send(unpublishRoute, 'POST', { id, suffix: '/unpublish', cookie });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe('not_published');

    const bodies: unknown[] = [];
    for (const target of [randomUUID(), 'not-a-uuid']) {
      for (const response of [
        await send(getRoute, 'GET', { id: target, cookie }),
        await send(patchRoute, 'PATCH', { id: target, cookie, body: { location: 'x' } }),
        await send(publishRoute, 'POST', { id: target, suffix: '/publish', cookie }),
        await send(unpublishRoute, 'POST', { id: target, suffix: '/unpublish', cookie }),
      ]) {
        expect(response.status).toBe(404);
        expectNoStore(response);
        const body = await response.json();
        delete body.error.requestId;
        bodies.push(body);
      }
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await auditCount()).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
