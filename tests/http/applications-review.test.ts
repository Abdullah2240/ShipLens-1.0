import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as listApplications } from '@/app/api/v1/applications/route';
import { GET as getApplication } from '@/app/api/v1/applications/[id]/route';
import { POST as acceptApplication } from '@/app/api/v1/applications/[id]/accept/route';
import { POST as declineApplication } from '@/app/api/v1/applications/[id]/decline/route';
import { GET as listMembers } from '@/app/api/v1/members/route';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';

const db = testPool();
const base = 'http://localhost:3000/api/v1';
const ORIGIN = 'http://localhost:3000';
type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

function send(
  handler: Handler,
  path: string,
  opts: {
    method?: string;
    cookie?: string;
    body?: unknown;
    origin?: string | null;
    params?: Record<string, string>;
  } = {},
) {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = opts.cookie;
  if (method !== 'GET' && opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return handler(
    new Request(`${base}${path}`, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
}
const accept = (id: string, cookie?: string, origin?: string | null) =>
  send(acceptApplication, `/applications/${id}/accept`, {
    method: 'POST',
    params: { id },
    ...(cookie ? { cookie } : {}),
    ...(origin !== undefined ? { origin } : {}),
  });
const decline = (id: string, cookie: string, body: unknown) =>
  send(declineApplication, `/applications/${id}/decline`, {
    method: 'POST',
    params: { id },
    cookie,
    body,
  });
const detail = (id: string, cookie: string) =>
  send(getApplication, `/applications/${id}`, { params: { id }, cookie });

async function application(branchId: string, name: string, minutesAgo = 1): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO applications (branch_id, full_name, email, phone, message, created_at)
     VALUES ($1, $2, $3, '+923001234567', 'Hello', now() - ($4 * interval '1 minute')) RETURNING id`,
    [branchId, name, `${name.toLowerCase().replace(/ /g, '.')}@example.test`, minutesAgo],
  );
  return rows[0]!.id;
}
async function status(id: string): Promise<string> {
  return (await db.query<{ status: string }>('SELECT status FROM applications WHERE id = $1', [id]))
    .rows[0]!.status;
}
function withoutRequestId(body: { error: { requestId?: string } }) {
  delete body.error.requestId;
  return body;
}

async function fixture() {
  const a = await seedBranch(db);
  const b = await seedBranch(db);
  const cookie = async (role: string, branchId?: string) =>
    createSessionCookie(db, (await seedUser(db, { role, branchId: branchId ?? null })).id);
  return {
    a,
    b,
    hrA: await cookie('hr_lead', a.id),
    hrB: await cookie('hr_lead', b.id),
    leadA: await cookie('branch_lead', a.id),
    finance: await cookie('finance_reviewer'),
    editor: await cookie('content_editor'),
  };
}

beforeEach(() => resetDb(db));
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('GET /api/v1/applications', () => {
  it('requires a session and application.read, and scopes to the branch', async () => {
    const f = await fixture();
    const older = await application(f.a.id, 'Ali Khan', 30);
    const newer = await application(f.a.id, 'Bina Shah', 10);
    await application(f.b.id, 'Cora Lee', 20);
    await db.query("UPDATE applications SET status = 'declined' WHERE id = $1", [newer]);

    expect((await send(listApplications, '/applications')).status).toBe(401);
    for (const cookie of [f.leadA, f.finance, f.editor]) {
      expect((await send(listApplications, '/applications', { cookie })).status).toBe(403);
    }

    const own = await send(listApplications, '/applications', { cookie: f.hrA });
    expect(own.status).toBe(200);
    const body = await own.json();
    expect(body.data).toMatchObject({ total: 2, page: 1, pageSize: 25 });
    expect(body.data.items.map((x: { id: string }) => x.id)).toEqual([newer, older]);

    const filtered = await send(
      listApplications,
      '/applications?status=pending&page=1&pageSize=1',
      {
        cookie: f.hrA,
      },
    );
    const filteredBody = await filtered.json();
    expect(filteredBody.data).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(filteredBody.data.items.map((x: { id: string }) => x.id)).toEqual([older]);

    const fallback = await send(listApplications, '/applications?status=nope&page=x&pageSize=bad', {
      cookie: f.hrA,
    });
    expect(fallback.status).toBe(200);
    expect((await fallback.json()).data).toMatchObject({ total: 2, page: 1, pageSize: 25 });
  });
});

describe('GET /api/v1/applications/:id', () => {
  it('returns detail for own branch and the same 404 for other branches and missing ids', async () => {
    const f = await fixture();
    const own = await application(f.a.id, 'Ali Khan');
    const foreign = await application(f.b.id, 'Cora Lee');
    const ok = await detail(own, f.hrA);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ id: own, message: 'Hello', status: 'pending' });

    const hidden = await detail(foreign, f.hrA);
    const missing = await detail(randomUUID(), f.hrA);
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(withoutRequestId(await hidden.json())).toEqual(withoutRequestId(await missing.json()));
  });
});

describe('POST /api/v1/applications/:id/accept', () => {
  it('accepts once, then refuses with already_decided', async () => {
    const f = await fixture();
    const id = await application(f.a.id, 'Ali Khan');
    const first = await accept(id, f.hrA);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.data.memberCode).toMatch(/^M\d{5}$/);
    expect(body.data.memberId).toEqual(expect.any(String));

    const again = await accept(id, f.hrA);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('already_decided');
    expect(
      Number(
        (
          await db.query<{ n: string }>(
            'SELECT count(*) AS n FROM members WHERE application_id = $1',
            [id],
          )
        ).rows[0]!.n,
      ),
    ).toBe(1);
  });

  it('hides other branches, refuses other roles and requires the origin', async () => {
    const f = await fixture();
    const id = await application(f.a.id, 'Ali Khan');
    const foreign = await accept(id, f.hrB);
    const missing = await accept(randomUUID(), f.hrB);
    expect(foreign.status).toBe(404);
    expect(withoutRequestId(await foreign.json())).toEqual(withoutRequestId(await missing.json()));
    expect((await accept(id, f.leadA)).status).toBe(403);
    expect((await accept(id, f.hrA, null)).status).toBe(403);
    expect((await accept(id, f.hrA, 'https://elsewhere.test')).status).toBe(403);
    expect((await accept(id)).status).toBe(401);
    expect(await status(id)).toBe('pending');
    expect((await db.query('SELECT id FROM members')).rows).toHaveLength(0);
  });
});

describe('POST /api/v1/applications/:id/decline', () => {
  it('declines with a note, rejects unknown keys and blocks a later accept', async () => {
    const f = await fixture();
    const id = await application(f.a.id, 'Ali Khan');
    const bad = await decline(id, f.hrA, { note: 'x', reason: 'y' });
    expect(bad.status).toBe(422);
    expect(await status(id)).toBe('pending');

    const ok = await decline(id, f.hrA, { note: 'x' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ data: { ok: true } });
    expect(await status(id)).toBe('declined');

    const late = await accept(id, f.hrA);
    expect(late.status).toBe(409);
    expect((await late.json()).error.code).toBe('already_decided');
  });
});

describe('cross-module visibility', () => {
  it('makes the accepted member visible to the same branch only', async () => {
    const f = await fixture();
    const id = await application(f.a.id, 'Ayesha Malik');
    const accepted = await (await accept(id, f.hrA)).json();
    const search = (cookie: string) =>
      send(listMembers, `/members?q=${encodeURIComponent('Ayesha Malik')}`, { cookie });

    const own = await (await search(f.hrA)).json();
    expect(own.data.items).toHaveLength(1);
    expect(own.data.items[0]).toMatchObject({
      id: accepted.data.memberId,
      memberCode: accepted.data.memberCode,
      fullName: 'Ayesha Malik',
      branchId: f.a.id,
    });
    const other = await (await search(f.hrB)).json();
    expect(other.data.items).toHaveLength(0);
  });
});
