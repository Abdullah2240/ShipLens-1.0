import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { GET as listMembers } from '@/app/api/v1/members/route';
import { GET as getMember, PATCH as patchMember } from '@/app/api/v1/members/[id]/route';
import { POST as postTeam } from '@/app/api/v1/teams/route';
import { PATCH as patchTeam } from '@/app/api/v1/teams/[id]/route';
import { closePool } from '@/platform/db';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';

const db = testPool();
const base = 'http://localhost:3000/api/v1';
const send = (
  handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
  path: string,
  method: string,
  cookie?: string,
  body?: unknown,
  origin = 'http://localhost:3000',
) =>
  handler(
    new Request(`${base}${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json', origin } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id: path.split('/').at(-1)! }) },
  );
beforeEach(() => resetDb(db));
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

it('enforces session, branch scope, query parsing, and matching 404s', async () => {
  const a = await seedBranch(db);
  const b = await seedBranch(db);
  const hr = await seedUser(db, { role: 'hr_lead', branchId: a.id });
  const editor = await seedUser(db, { role: 'content_editor' });
  const own = (
    await db.query<{ id: string }>(
      'INSERT INTO members (branch_id,member_code,full_name,status) VALUES ($1,$2,$3,$4) RETURNING id',
      [a.id, 'M001', 'Ali', 'active'],
    )
  ).rows[0]!.id;
  const foreign = (
    await db.query<{ id: string }>(
      'INSERT INTO members (branch_id,member_code,full_name) VALUES ($1,$2,$3) RETURNING id',
      [b.id, 'M002', 'Bina'],
    )
  ).rows[0]!.id;
  const hrCookie = await createSessionCookie(db, hr.id);
  const editorCookie = await createSessionCookie(db, editor.id);
  expect((await send(listMembers, '/members', 'GET')).status).toBe(401);
  expect((await send(listMembers, '/members', 'GET', editorCookie)).status).toBe(403);
  const list = await send(
    listMembers,
    '/members?q=ali&status=active&page=1&pageSize=2',
    'GET',
    hrCookie,
  );
  expect((await list.json()).data.items.map((x: { id: string }) => x.id)).toEqual([own]);
  expect((await send(listMembers, '/members?page=bad&pageSize=bad', 'GET', hrCookie)).status).toBe(
    200,
  );
  const missingA = await send(getMember, `/members/${foreign}`, 'GET', hrCookie);
  const missingB = await send(getMember, `/members/${randomUUID()}`, 'GET', hrCookie);
  expect(missingA.status).toBe(404);
  const bodyA = await missingA.json();
  const bodyB = await missingB.json();
  delete bodyA.error.requestId;
  delete bodyB.error.requestId;
  expect(bodyA).toEqual(bodyB);
});

it('validates member patches and team mutations', async () => {
  const a = await seedBranch(db);
  const b = await seedBranch(db);
  const hr = await seedUser(db, { role: 'hr_lead', branchId: a.id });
  const lead = await seedUser(db, { role: 'branch_lead', branchId: a.id });
  const id = (
    await db.query<{ id: string }>(
      'INSERT INTO members (branch_id,member_code,full_name) VALUES ($1,$2,$3) RETURNING id',
      [a.id, 'M001', 'Ali'],
    )
  ).rows[0]!.id;
  const foreignTeam = (
    await db.query<{ id: string }>(
      'INSERT INTO teams (branch_id,name) VALUES ($1,$2) RETURNING id',
      [b.id, 'Foreign'],
    )
  ).rows[0]!.id;
  const cookie = await createSessionCookie(db, hr.id);
  const leadCookie = await createSessionCookie(db, lead.id);
  expect(
    (await send(patchMember, `/members/${id}`, 'PATCH', cookie, { status: 'inactive' })).status,
  ).toBe(200);
  expect(
    (await send(patchMember, `/members/${id}`, 'PATCH', cookie, { status: 'inactive' })).status,
  ).toBe(200);
  expect((await db.query('SELECT id FROM audit_events')).rows).toHaveLength(1);
  expect(
    (await send(patchMember, `/members/${id}`, 'PATCH', leadCookie, { status: 'left' })).status,
  ).toBe(403);
  expect((await send(patchMember, `/members/${id}`, 'PATCH', cookie, {})).status).toBe(422);
  expect(
    (await send(patchMember, `/members/${id}`, 'PATCH', cookie, { fullName: 'Other' })).status,
  ).toBe(422);
  const noOrigin = await patchMember(
    new Request(`${base}/members/${id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}',
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(noOrigin.status).toBe(403);
  const created = await send(postTeam, '/teams', 'POST', cookie, { name: 'Outreach' });
  expect(created.status).toBe(201);
  expect((await send(postTeam, '/teams', 'POST', cookie, { name: 'outreach' })).status).toBe(409);
  expect(
    (await send(patchTeam, `/teams/${foreignTeam}`, 'PATCH', cookie, { name: 'Renamed' })).status,
  ).toBe(404);
});
