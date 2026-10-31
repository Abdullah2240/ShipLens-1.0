import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

import { GET as listRoute } from '@/app/api/v1/content/entries/route';
import {
  GET as getRoute,
  PUT as putRoute,
} from '@/app/api/v1/content/entries/[key]/[locale]/route';
import { GET as previewRoute } from '@/app/api/v1/content/entries/[key]/[locale]/preview/route';
import { POST as publishRoute } from '@/app/api/v1/content/entries/[key]/[locale]/publish/route';
import { POST as unpublishRoute } from '@/app/api/v1/content/entries/[key]/[locale]/unpublish/route';
import { getPublishedContent } from '@/modules/public-site';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const base = 'http://localhost:3000/api/v1/content/entries';
const ORIGIN = 'http://localhost:3000';

function send(
  handler: Handler,
  method: string,
  opts: {
    key?: string;
    locale?: string;
    suffix?: string;
    cookie?: string;
    body?: unknown;
    origin?: string | null;
  } = {},
): Promise<Response> {
  const params: Record<string, string> = {};
  if (opts.key !== undefined) params.key = opts.key;
  if (opts.locale !== undefined) params.locale = opts.locale;
  const path = opts.key !== undefined ? `/${opts.key}/${opts.locale}${opts.suffix ?? ''}` : '';
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

const entry = { key: 'about', locale: 'en' };
const ROUTES: { name: string; call: (cookie?: string) => Promise<Response> }[] = [
  { name: 'list', call: (cookie) => send(listRoute, 'GET', { cookie }) },
  { name: 'get', call: (cookie) => send(getRoute, 'GET', { ...entry, cookie }) },
  {
    name: 'put',
    call: (cookie) => send(putRoute, 'PUT', { ...entry, cookie, body: { title: 'Hi' } }),
  },
  {
    name: 'publish',
    call: (cookie) => send(publishRoute, 'POST', { ...entry, suffix: '/publish', cookie }),
  },
  {
    name: 'unpublish',
    call: (cookie) => send(unpublishRoute, 'POST', { ...entry, suffix: '/unpublish', cookie }),
  },
  {
    name: 'preview',
    call: (cookie) => send(previewRoute, 'GET', { ...entry, suffix: '/preview', cookie }),
  },
];

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

beforeEach(async () => {
  await resetDb(db);
  revalidatePath.mockReset();
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('content entry routes', () => {
  it('requires a session and the content role on every route', async () => {
    for (const { call } of ROUTES) {
      const response = await call();
      expect(response.status).toBe(401);
      expectNoStore(response);
    }
    for (const role of ['hr_lead', 'branch_lead', 'finance_reviewer']) {
      const cookie = await cookieFor(role);
      for (const { name, call } of ROUTES) {
        const response = await call(cookie);
        expect({ role, name, status: response.status }).toEqual({ role, name, status: 403 });
        expectNoStore(response);
      }
    }
    expect(await auditCount()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns an identical 404 for unknown keys and locales', async () => {
    const cookie = await cookieFor('content_editor');
    const bodies: unknown[] = [];
    for (const target of [
      { key: 'admin', locale: 'en' },
      { key: 'about', locale: 'fr' },
    ]) {
      for (const response of [
        await send(getRoute, 'GET', { ...target, cookie }),
        await send(putRoute, 'PUT', { ...target, cookie, body: { title: 'x' } }),
        await send(publishRoute, 'POST', { ...target, suffix: '/publish', cookie }),
        await send(unpublishRoute, 'POST', { ...target, suffix: '/unpublish', cookie }),
        await send(previewRoute, 'GET', { ...target, suffix: '/preview', cookie }),
      ]) {
        expect(response.status).toBe(404);
        expectNoStore(response);
        const body = await response.json();
        delete body.error.requestId;
        bodies.push(body);
      }
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await auditCount()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('keeps drafts private and publishes and unpublishes explicitly', async () => {
    const cookie = await cookieFor('content_editor');

    const list = await send(listRoute, 'GET', { cookie });
    expect(list.status).toBe(200);
    expectNoStore(list);
    expect((await list.json()).data).toHaveLength(8);

    const saved = await send(putRoute, 'PUT', {
      ...entry,
      cookie,
      body: { title: 'About us', body: 'First public text' },
    });
    expect(saved.status).toBe(200);
    expectNoStore(saved);
    expect((await saved.json()).data).toMatchObject({
      key: 'about',
      locale: 'en',
      exists: true,
      title: 'About us',
      status: 'draft',
    });
    expect(await getPublishedContent(db, 'about', 'en')).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();

    const read = await send(getRoute, 'GET', { ...entry, cookie });
    expect(read.status).toBe(200);
    expectNoStore(read);
    expect((await read.json()).data.body).toBe('First public text');

    const published = await send(publishRoute, 'POST', { ...entry, suffix: '/publish', cookie });
    expect(published.status).toBe(200);
    expectNoStore(published);
    expect((await published.json()).data).toMatchObject({ status: 'published' });
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await getPublishedContent(db, 'about', 'en')).toMatchObject({
      title: 'About us',
      body: 'First public text',
    });

    const edited = await send(putRoute, 'PUT', {
      ...entry,
      cookie,
      body: { body: 'Unreleased edit' },
    });
    expect(edited.status).toBe(200);
    expect((await edited.json()).data).toMatchObject({
      status: 'published',
      hasUnpublishedChanges: true,
    });
    expect(await getPublishedContent(db, 'about', 'en')).toMatchObject({
      body: 'First public text',
    });
    expect(revalidatePath).toHaveBeenCalledTimes(1);

    const preview = await send(previewRoute, 'GET', { ...entry, suffix: '/preview', cookie });
    expect(preview.status).toBe(200);
    expectNoStore(preview);
    expect((await preview.json()).data.body).toBe('Unreleased edit');

    const unpublished = await send(unpublishRoute, 'POST', {
      ...entry,
      suffix: '/unpublish',
      cookie,
    });
    expect(unpublished.status).toBe(200);
    expectNoStore(unpublished);
    expect((await unpublished.json()).data).toMatchObject({ status: 'draft' });
    expect(await getPublishedContent(db, 'about', 'en')).toBeNull();
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it('does not revalidate when publish or unpublish fails', async () => {
    const cookie = await cookieFor('content_editor');

    const missing = await send(publishRoute, 'POST', { ...entry, suffix: '/publish', cookie });
    expect(missing.status).toBe(404);

    await send(putRoute, 'PUT', { ...entry, cookie, body: { title: '', body: '' } });
    const empty = await send(publishRoute, 'POST', { ...entry, suffix: '/publish', cookie });
    expect(empty.status).toBe(422);
    expect((await empty.json()).error).toMatchObject({
      code: 'validation_failed',
      details: { fields: [{ path: 'body', code: 'empty_content' }] },
    });

    const notPublished = await send(unpublishRoute, 'POST', {
      ...entry,
      suffix: '/unpublish',
      cookie,
    });
    expect(notPublished.status).toBe(409);
    expect((await notPublished.json()).error.code).toBe('not_published');

    const unpublishMissing = await send(unpublishRoute, 'POST', {
      key: 'contact',
      locale: 'ur',
      suffix: '/unpublish',
      cookie,
    });
    expect(unpublishMissing.status).toBe(404);

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects cross-origin mutations and invalid bodies', async () => {
    const cookie = await cookieFor('content_editor');
    for (const response of [
      await send(putRoute, 'PUT', { ...entry, cookie, body: { title: 'x' }, origin: null }),
      await send(publishRoute, 'POST', { ...entry, suffix: '/publish', cookie, origin: null }),
      await send(unpublishRoute, 'POST', {
        ...entry,
        suffix: '/unpublish',
        cookie,
        origin: 'https://evil.example',
      }),
    ]) {
      expect(response.status).toBe(403);
      expectNoStore(response);
    }

    const unknownField = await send(putRoute, 'PUT', {
      ...entry,
      cookie,
      body: { title: 'x', status: 'published' },
    });
    expect(unknownField.status).toBe(422);
    expectNoStore(unknownField);
    const tooLong = await send(putRoute, 'PUT', {
      ...entry,
      cookie,
      body: { title: 'x'.repeat(201) },
    });
    expect(tooLong.status).toBe(422);
    expect((await tooLong.json()).error.details.fields).toEqual([
      expect.objectContaining({ path: 'title', message: 'too_long' }),
    ]);
    expect(await auditCount()).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('serves the draft preview to content editors and super admins only', async () => {
    const editor = await cookieFor('content_editor');
    const admin = await cookieFor('super_admin');
    await send(putRoute, 'PUT', {
      key: 'programs',
      locale: 'ur',
      cookie: editor,
      body: { title: 'پروگرام', body: 'مسودہ متن' },
    });
    for (const cookie of [editor, admin]) {
      const response = await send(previewRoute, 'GET', {
        key: 'programs',
        locale: 'ur',
        suffix: '/preview',
        cookie,
      });
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({
        title: 'پروگرام',
        body: 'مسودہ متن',
        status: 'draft',
        translationMissing: false,
      });
    }
    for (const role of ['hr_lead', 'finance_reviewer']) {
      const response = await send(previewRoute, 'GET', {
        key: 'programs',
        locale: 'ur',
        suffix: '/preview',
        cookie: await cookieFor(role),
      });
      expect(response.status).toBe(403);
    }
    expect(await getPublishedContent(db, 'programs', 'ur')).toBeNull();
  });
});
