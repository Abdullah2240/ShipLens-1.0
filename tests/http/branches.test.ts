import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as getBranch, PATCH as patchBranch } from '@/app/api/v1/branches/[id]/route';
import { POST as postLead } from '@/app/api/v1/branches/[id]/leads/route';
import { POST as postStatus } from '@/app/api/v1/branches/[id]/status/route';
import { GET as getCandidates } from '@/app/api/v1/branches/lead-candidates/route';
import { GET as listBranches, POST as postBranch } from '@/app/api/v1/branches/route';
import { getEnv } from '@/platform/config/env';
import { closePool } from '@/platform/db';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
  type UserRow,
} from '../support/db';
import { createSessionCookie } from '../support/session';

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const base = 'http://localhost:3000/api/v1';
const origin = () => getEnv().APP_ORIGIN;

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
): Promise<Response> {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const sendOrigin = opts.origin === undefined ? origin() : opts.origin;
  return handler(
    new Request(`${base}${path}`, {
      method,
      headers: {
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' && sendOrigin ? { origin: sendOrigin } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
}

let a: BranchRow;
let b: BranchRow;
let lead: UserRow;
let hrB: UserRow;
let cookies: { admin: string; finance: string; editor: string; lead: string };

beforeEach(async () => {
  await resetDb(db);
  a = await seedBranch(db, { name: 'Alpha Branch' });
  b = await seedBranch(db, { name: 'Bravo Branch' });
  const admin = await seedUser(db, { role: 'super_admin' });
  const finance = await seedUser(db, { role: 'finance_reviewer' });
  const editor = await seedUser(db, { role: 'content_editor' });
  lead = await seedUser(db, { role: 'branch_lead', branchId: a.id });
  hrB = await seedUser(db, { role: 'hr_lead', branchId: b.id });
  cookies = {
    admin: await createSessionCookie(db, admin.id),
    finance: await createSessionCookie(db, finance.id),
    editor: await createSessionCookie(db, editor.id),
    lead: await createSessionCookie(db, lead.id),
  };
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

const branchCount = async () =>
  (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM branches')).rows[0]!.n;

describe('POST /api/v1/branches', () => {
  it('creates a branch with a generated code', async () => {
    const res = await send(postBranch, '/branches', {
      cookie: cookies.admin,
      body: { name: 'Karachi East', city: 'Karachi' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.code).toMatch(/^BR\d{3,}$/);
    expect(body.data.status).toBe('forming');
  });

  it('refuses a missing Origin, a client code, other roles and anonymous calls', async () => {
    const noOrigin = await send(postBranch, '/branches', {
      cookie: cookies.admin,
      body: { name: 'No Origin' },
      origin: null,
    });
    expect(noOrigin.status).toBe(403);
    expect(await branchCount()).toBe(2);
    const withCode = await send(postBranch, '/branches', {
      cookie: cookies.admin,
      body: { name: 'Coded', code: 'BR999' },
    });
    expect(withCode.status).toBe(422);
    expect(
      (await send(postBranch, '/branches', { cookie: cookies.finance, body: { name: 'Nope' } }))
        .status,
    ).toBe(403);
    expect((await send(postBranch, '/branches', { body: { name: 'Nope' } })).status).toBe(401);
    expect(await branchCount()).toBe(2);
  });
});

describe('GET /api/v1/branches', () => {
  it('scopes the list and filters by status leniently', async () => {
    const ids = async (res: Response) =>
      ((await res.json()).data as { id: string }[]).map((x) => x.id).sort();
    expect(await ids(await send(listBranches, '/branches', { cookie: cookies.lead }))).toEqual([
      a.id,
    ]);
    expect(await ids(await send(listBranches, '/branches', { cookie: cookies.finance }))).toEqual(
      [a.id, b.id].sort(),
    );
    expect((await send(listBranches, '/branches', { cookie: cookies.editor })).status).toBe(403);
    await db.query("UPDATE branches SET status = 'forming' WHERE id = $1", [b.id]);
    expect(
      await ids(await send(listBranches, '/branches?status=forming', { cookie: cookies.admin })),
    ).toEqual([b.id]);
    const invalid = await send(listBranches, '/branches?status=archived', {
      cookie: cookies.admin,
    });
    expect(invalid.status).toBe(200);
    expect(await ids(invalid)).toEqual([a.id, b.id].sort());
  });
});

describe('GET and PATCH /api/v1/branches/:id', () => {
  it('returns identical 404 bodies for out-of-scope and missing ids', async () => {
    const foreign = await send(getBranch, `/branches/${b.id}`, {
      cookie: cookies.lead,
      params: { id: b.id },
    });
    const missingId = randomUUID();
    const missing = await send(getBranch, `/branches/${missingId}`, {
      cookie: cookies.lead,
      params: { id: missingId },
    });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    const foreignBody = await foreign.json();
    const missingBody = await missing.json();
    delete foreignBody.error.requestId;
    delete missingBody.error.requestId;
    expect(foreignBody).toEqual(missingBody);
    const own = await send(getBranch, `/branches/${a.id}`, {
      cookie: cookies.lead,
      params: { id: a.id },
    });
    expect(own.status).toBe(200);
    expect((await own.json()).data.leads.map((x: { userId: string }) => x.userId)).toEqual([
      lead.id,
    ]);
  });

  it('patches the name and rejects an empty patch', async () => {
    const res = await send(patchBranch, `/branches/${a.id}`, {
      method: 'PATCH',
      cookie: cookies.admin,
      body: { name: 'Alpha Renamed' },
      params: { id: a.id },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.name).toBe('Alpha Renamed');
    const empty = await send(patchBranch, `/branches/${a.id}`, {
      method: 'PATCH',
      cookie: cookies.admin,
      body: {},
      params: { id: a.id },
    });
    expect(empty.status).toBe(422);
    const body = await empty.json();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details.fields[0].message).toBe('empty_patch');
  });
});

describe('POST /api/v1/branches/:id/status', () => {
  it('moves forming to active once and rejects unknown statuses', async () => {
    const created = await (
      await send(postBranch, '/branches', { cookie: cookies.admin, body: { name: 'Mover' } })
    ).json();
    const id = created.data.id as string;
    const move = () =>
      send(postStatus, `/branches/${id}/status`, {
        cookie: cookies.admin,
        body: { to: 'active' },
        params: { id },
      });
    const first = await move();
    expect(first.status).toBe(200);
    expect((await first.json()).data.status).toBe('active');
    const again = await move();
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('invalid_transition');
    const unknown = await send(postStatus, `/branches/${id}/status`, {
      cookie: cookies.admin,
      body: { to: 'archived' },
      params: { id },
    });
    expect(unknown.status).toBe(422);
  });

  it('refuses to close a branch with an open report', async () => {
    await db.query(
      "INSERT INTO weekly_reports (branch_id, week_start, status) VALUES ($1, '2026-10-19', 'draft')",
      [a.id],
    );
    await db.query(
      "UPDATE weekly_reports SET status = 'submitted' WHERE branch_id = $1 AND week_start = '2026-10-19'",
      [a.id],
    );
    const res = await send(postStatus, `/branches/${a.id}/status`, {
      cookie: cookies.admin,
      body: { to: 'closed' },
      params: { id: a.id },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('branch_has_open_reports');
  });
});

describe('POST /api/v1/branches/:id/leads', () => {
  it('assigns a lead for super admins only', async () => {
    const res = await send(postLead, `/branches/${a.id}/leads`, {
      cookie: cookies.admin,
      body: { userId: hrB.id },
      params: { id: a.id },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.leads.map((x: { userId: string }) => x.userId).sort()).toEqual(
      [lead.id, hrB.id].sort(),
    );
    const denied = await send(postLead, `/branches/${a.id}/leads`, {
      cookie: cookies.lead,
      body: { userId: hrB.id },
      params: { id: a.id },
    });
    expect(denied.status).toBe(403);
    const invalid = await send(postLead, `/branches/${a.id}/leads`, {
      cookie: cookies.admin,
      body: { userId: randomUUID() },
      params: { id: a.id },
    });
    expect(invalid.status).toBe(422);
    expect((await invalid.json()).error.details.fields[0]).toMatchObject({
      path: 'userId',
      code: 'invalid_user',
    });
  });
});

describe('GET /api/v1/branches/lead-candidates', () => {
  it('lists candidates for super admins and refuses finance reviewers', async () => {
    const res = await send(getCandidates, '/branches/lead-candidates', { cookie: cookies.admin });
    expect(res.status).toBe(200);
    expect(((await res.json()).data as { userId: string }[]).map((x) => x.userId).sort()).toEqual(
      [lead.id, hrB.id].sort(),
    );
    expect(
      (await send(getCandidates, '/branches/lead-candidates', { cookie: cookies.finance })).status,
    ).toBe(403);
  });

  it('lives in its own static segment, not under the [id] handler', async () => {
    // Next resolves a static segment before a dynamic one; the [id] handler treats the
    // word as an id and answers 404, so candidates are only reachable from their own route.
    const asId = await send(getBranch, '/branches/lead-candidates', {
      cookie: cookies.admin,
      params: { id: 'lead-candidates' },
    });
    expect(asId.status).toBe(404);
  });
});
