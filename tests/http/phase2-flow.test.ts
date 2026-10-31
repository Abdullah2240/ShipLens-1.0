import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

import { POST as acceptRoute } from '@/app/api/v1/applications/[id]/accept/route';
import { POST as declineRoute } from '@/app/api/v1/applications/[id]/decline/route';
import { GET as getApplicationRoute } from '@/app/api/v1/applications/[id]/route';
import { GET as listApplicationsRoute } from '@/app/api/v1/applications/route';
import { PUT as putEntryRoute } from '@/app/api/v1/content/entries/[key]/[locale]/route';
import { GET as previewRoute } from '@/app/api/v1/content/entries/[key]/[locale]/preview/route';
import { POST as publishEntryRoute } from '@/app/api/v1/content/entries/[key]/[locale]/publish/route';
import { POST as unpublishEntryRoute } from '@/app/api/v1/content/entries/[key]/[locale]/unpublish/route';
import { POST as publishEventRoute } from '@/app/api/v1/content/events/[id]/publish/route';
import { POST as unpublishEventRoute } from '@/app/api/v1/content/events/[id]/unpublish/route';
import { POST as createEventRoute } from '@/app/api/v1/content/events/route';
import { PATCH as patchMemberRoute } from '@/app/api/v1/members/[id]/route';
import { GET as listMembersRoute } from '@/app/api/v1/members/route';
import { POST as submitRoute } from '@/app/api/v1/public/applications/route';
import { POST as createTeamRoute } from '@/app/api/v1/teams/route';
import { applicationRateLimiter } from '@/modules/applications';
import { getPublishedContent, listUpcomingEvents } from '@/modules/public-site';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';

// The Saniya-track flow end to end through the real route handlers: a visitor applies,
// the HR Lead of that branch accepts, the new member is searchable and placed in a team;
// the Content Editor drafts, previews, publishes and unpublishes a page and an event,
// and the public reads follow each step. The steps share state and run in order.

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const ORIGIN = 'http://localhost:3000';

let address = 0;
function call(
  handler: Handler,
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<Response> {
  address += 1;
  return handler(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'x-forwarded-for': `203.0.113.${address}`,
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const APPLICANT = {
  fullName: 'Zarmeen Qureshi',
  email: 'zarmeen.flow@example.test',
  phone: '03001234567',
  message: 'Weekends are free.',
};
const PHONE_NORMALISED = '+923001234567';

const world = {
  branchA: '',
  branchB: '',
  hrA: '',
  hrB: '',
  editor: '',
  admin: '',
  applicationId: '',
  memberId: '',
  teamId: '',
  startedAt: new Date(),
};

beforeAll(async () => {
  await resetDb(db);
  world.startedAt = new Date(Date.now() - 1000);
  const a = await seedBranch(db, { name: 'Flow Branch A', city: 'Lahore' });
  const b = await seedBranch(db, { name: 'Flow Branch B', city: 'Karachi' });
  world.branchA = a.id;
  world.branchB = b.id;
  const hrA = await seedUser(db, { role: 'hr_lead', branchId: a.id });
  const hrB = await seedUser(db, { role: 'hr_lead', branchId: b.id });
  const editor = await seedUser(db, { role: 'content_editor' });
  const admin = await seedUser(db, { role: 'super_admin' });
  world.hrA = await createSessionCookie(db, hrA.id);
  world.hrB = await createSessionCookie(db, hrB.id);
  world.editor = await createSessionCookie(db, editor.id);
  world.admin = await createSessionCookie(db, admin.id);
});

beforeEach(() => {
  applicationRateLimiter.reset();
});

afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('application to member', () => {
  it('a visitor applies once per branch', async () => {
    const body = { ...APPLICANT, branchId: world.branchA, website: '' };
    const first = await call(submitRoute, 'POST', '/public/applications', { body });
    expect(first.status).toBe(201);
    const again = await call(submitRoute, 'POST', '/public/applications', { body });
    expect(again.status).toBe(409);
  });

  it('only the HR Lead of that branch sees the application', async () => {
    type List = { data: { items: { id: string; status: string; email: string }[] } };
    const other = await call(listApplicationsRoute, 'GET', '/applications', { cookie: world.hrB });
    expect(other.status).toBe(200);
    expect((await json<List>(other)).data.items).toEqual([]);

    const own = await call(listApplicationsRoute, 'GET', '/applications', { cookie: world.hrA });
    const items = (await json<List>(own)).data.items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ status: 'pending', email: APPLICANT.email });
    world.applicationId = items[0]!.id;

    const foreign = await call(getApplicationRoute, 'GET', `/applications/${world.applicationId}`, {
      cookie: world.hrB,
      params: { id: world.applicationId },
    });
    expect(foreign.status).toBe(404);
  });

  it('accepting creates one member and a second decision is refused', async () => {
    const id = world.applicationId;
    const accepted = await call(acceptRoute, 'POST', `/applications/${id}/accept`, {
      cookie: world.hrA,
      params: { id },
    });
    expect(accepted.status).toBe(200);
    const { data } = await json<{ data: { memberId: string; memberCode: string } }>(accepted);
    expect(data.memberCode).toMatch(/^M\d{5}$/);
    world.memberId = data.memberId;

    const again = await call(acceptRoute, 'POST', `/applications/${id}/accept`, {
      cookie: world.hrA,
      params: { id },
    });
    expect(again.status).toBe(409);
    const decline = await call(declineRoute, 'POST', `/applications/${id}/decline`, {
      cookie: world.hrA,
      params: { id },
      body: {},
    });
    expect(decline.status).toBe(409);
    const { rows } = await db.query('SELECT id FROM members WHERE application_id = $1', [id]);
    expect(rows).toHaveLength(1);
  });

  it('the member is searchable in its own branch only and can join a team', async () => {
    type Page = { data: { items: { id: string; teamId: string | null }[] } };
    const search = '/members?q=zarmeen';
    const own = await call(listMembersRoute, 'GET', search, { cookie: world.hrA });
    expect((await json<Page>(own)).data.items.map((m) => m.id)).toEqual([world.memberId]);
    const other = await call(listMembersRoute, 'GET', search, { cookie: world.hrB });
    expect((await json<Page>(other)).data.items).toEqual([]);
    const all = await call(listMembersRoute, 'GET', search, { cookie: world.admin });
    expect((await json<Page>(all)).data.items.map((m) => m.id)).toEqual([world.memberId]);

    const team = await call(createTeamRoute, 'POST', '/teams', {
      cookie: world.hrA,
      body: { name: 'Flow Weekend Team' },
    });
    expect(team.status).toBe(201);
    world.teamId = (await json<{ data: { id: string } }>(team)).data.id;

    const patched = await call(patchMemberRoute, 'PATCH', `/members/${world.memberId}`, {
      cookie: world.hrA,
      params: { id: world.memberId },
      body: { teamId: world.teamId },
    });
    expect(patched.status).toBe(200);

    const filtered = await call(
      listMembersRoute,
      'GET',
      `/members?teamId=${world.teamId}&status=active`,
      { cookie: world.hrA },
    );
    const items = (await json<Page>(filtered)).data.items;
    expect(items.map((m) => m.id)).toEqual([world.memberId]);
    expect(items[0]!.teamId).toBe(world.teamId);
  });
});

describe('content draft to publish to unpublish', () => {
  const params = { key: 'about', locale: 'en' };
  const entryPath = '/content/entries/about/en';
  const publicRead = () => getPublishedContent(db, 'about', 'en');

  it('a saved draft stays private until published', async () => {
    const saved = await call(putEntryRoute, 'PUT', entryPath, {
      cookie: world.editor,
      params,
      body: { title: 'Flow About', body: 'Neighbours helping neighbours.' },
    });
    expect(saved.status).toBe(200);
    expect(await publicRead()).toBeNull();

    const preview = await call(previewRoute, 'GET', `${entryPath}/preview`, {
      cookie: world.editor,
      params,
    });
    expect(preview.status).toBe(200);
    expect((await json<{ data: { title: string } }>(preview)).data.title).toBe('Flow About');
  });

  it('publishing makes the copy public and a newer draft does not change it', async () => {
    const published = await call(publishEntryRoute, 'POST', `${entryPath}/publish`, {
      cookie: world.editor,
      params,
    });
    expect(published.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(await publicRead()).toMatchObject({ title: 'Flow About', locale: 'en' });

    const newer = await call(putEntryRoute, 'PUT', entryPath, {
      cookie: world.editor,
      params,
      body: { title: 'Flow About (newer draft)', body: 'Not yet public.' },
    });
    expect(newer.status).toBe(200);
    expect((await publicRead())?.title).toBe('Flow About');
  });

  it('unpublishing removes the page copy at once', async () => {
    const unpublished = await call(unpublishEntryRoute, 'POST', `${entryPath}/unpublish`, {
      cookie: world.editor,
      params,
    });
    expect(unpublished.status).toBe(200);
    expect(await publicRead()).toBeNull();
  });

  it('an event follows publish and unpublish on the public list', async () => {
    const startsAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    startsAt.setUTCSeconds(0, 0);
    const created = await call(createEventRoute, 'POST', '/content/events', {
      cookie: world.editor,
      body: {
        titleEn: 'Flow Health Camp',
        location: 'Community hall',
        startsAt: startsAt.toISOString(),
        branchId: world.branchA,
      },
    });
    expect(created.status).toBe(201);
    const id = (await json<{ data: { id: string } }>(created)).data.id;
    const titles = async () => (await listUpcomingEvents(db, 'en')).map((e) => e.title);
    expect(await titles()).not.toContain('Flow Health Camp');

    const published = await call(publishEventRoute, 'POST', `/content/events/${id}/publish`, {
      cookie: world.editor,
      params: { id },
    });
    expect(published.status).toBe(200);
    const listed = (await listUpcomingEvents(db, 'en')).find((e) => e.title === 'Flow Health Camp');
    expect(listed).toMatchObject({ branchName: 'Flow Branch A', location: 'Community hall' });

    const unpublished = await call(unpublishEventRoute, 'POST', `/content/events/${id}/unpublish`, {
      cookie: world.editor,
      params: { id },
    });
    expect(unpublished.status).toBe(200);
    expect(await titles()).not.toContain('Flow Health Camp');
  });
});

describe('audit trail of the flow', () => {
  it('records every step without the applicant contact details', async () => {
    const { rows } = await db.query<{ action: string; row: unknown }>(
      `SELECT action, to_jsonb(a) AS row FROM audit_events a
       WHERE occurred_at >= $1 ORDER BY id`,
      [world.startedAt],
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const action of [
      'application.submit',
      'application.accept',
      'member.create',
      'member.update',
      'team.create',
      'content.save_draft',
      'content.publish',
      'content.unpublish',
      'event.create',
      'event.publish',
      'event.unpublish',
    ]) {
      expect(actions, action).toContain(action);
    }
    const serialised = JSON.stringify(rows).toLowerCase();
    for (const secret of [APPLICANT.email, APPLICANT.phone, PHONE_NORMALISED]) {
      expect(serialised).not.toContain(secret.toLowerCase());
    }
  });
});
