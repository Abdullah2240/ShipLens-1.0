import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as itemRoute from '@/app/api/v1/collections/[id]/route';
import { POST as postVoid } from '@/app/api/v1/collections/[id]/void/route';
import { GET as getCurrentWeek } from '@/app/api/v1/collections/current-week/route';
import * as listRoute from '@/app/api/v1/collections/route';
import { getEnv } from '@/platform/config/env';
import { closePool } from '@/platform/db';
import { addDays, pktDate, pktWeekStart } from '@/platform/time';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
  type UserRow,
} from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import { createSessionCookie } from '../support/session';

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const db = testPool();
const base = 'http://localhost:3000/api/v1';
const origin = () => getEnv().APP_ORIGIN;
// Routes run on the system clock, so dates are derived from the real PKT today.
const today = () => pktDate(new Date());

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
let leadA: UserRow;
let leadB: UserRow;
let cookies: { admin: string; finance: string; leadA: string; leadB: string };

const valid = () => ({ amount: '1500.50', collectedOn: today(), purpose: 'Ration packs' });
const collectionCount = async (branchId?: string) =>
  (
    await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM collections WHERE $1::uuid IS NULL OR branch_id = $1',
      [branchId ?? null],
    )
  ).rows[0]!.n;
const create = async (cookie: string) => {
  const res = await send(listRoute.POST, '/collections', { cookie, body: valid() });
  expect(res.status).toBe(201);
  return (await res.json()).data as { id: string; reportId: string };
};
const withoutRequestId = (body: { error: Record<string, unknown> }) => ({
  ...body.error,
  requestId: undefined,
});

beforeEach(async () => {
  await resetDb(db);
  a = await seedBranch(db, { name: 'Alpha Branch', status: 'active' });
  b = await seedBranch(db, { name: 'Bravo Branch', status: 'active' });
  const admin = await seedUser(db, { role: 'super_admin' });
  const finance = await seedUser(db, { role: 'finance_reviewer' });
  leadA = await seedUser(db, { role: 'branch_lead', branchId: a.id });
  leadB = await seedUser(db, { role: 'branch_lead', branchId: b.id });
  cookies = {
    admin: await createSessionCookie(db, admin.id),
    finance: await createSessionCookie(db, finance.id),
    leadA: await createSessionCookie(db, leadA.id),
    leadB: await createSessionCookie(db, leadB.id),
  };
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

describe('POST /api/v1/collections', () => {
  it('logs a collection for the lead branch with a full lock countdown', async () => {
    const res = await send(listRoute.POST, '/collections', {
      cookie: cookies.leadA,
      body: valid(),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({
      branchId: a.id,
      amount: '1500.50',
      collectedOn: today(),
      weekStart: pktWeekStart(today()),
      reportStatus: 'draft',
      editability: 'editable',
      lock: { lastEditableOn: addDays(today(), 7), locked: false, daysLeft: 7 },
    });
  });

  it('never takes the branch from the body', async () => {
    const res = await send(listRoute.POST, '/collections', {
      cookie: cookies.leadA,
      body: { ...valid(), branchId: b.id },
    });
    expect(res.status).toBe(422);
    expect(await collectionCount()).toBe(0);
  });

  it('refuses a missing Origin, read-only roles and a bad amount', async () => {
    const noOrigin = await send(listRoute.POST, '/collections', {
      cookie: cookies.leadA,
      body: valid(),
      origin: null,
    });
    expect(noOrigin.status).toBe(403);
    for (const cookie of [cookies.finance, cookies.admin]) {
      expect((await send(listRoute.POST, '/collections', { cookie, body: valid() })).status).toBe(
        403,
      );
    }
    expect((await send(listRoute.POST, '/collections', { body: valid() })).status).toBe(401);
    const badAmount = await send(listRoute.POST, '/collections', {
      cookie: cookies.leadA,
      body: { ...valid(), amount: '12.345' },
    });
    expect(badAmount.status).toBe(422);
    const body = await badAmount.json();
    expect(body.error.details.fields).toEqual([
      expect.objectContaining({ path: 'amount', message: 'invalid_money' }),
    ]);
    expect(await collectionCount()).toBe(0);
  });

  it('refuses a future date', async () => {
    const res = await send(listRoute.POST, '/collections', {
      cookie: cookies.leadA,
      body: { ...valid(), collectedOn: addDays(today(), 1) },
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error.details.fields[0]).toMatchObject({
      path: 'collectedOn',
      code: 'future_date',
    });
  });
});

describe('PATCH /api/v1/collections/:id', () => {
  it('refuses a locked collection even through a direct API call', async () => {
    const tenDaysAgo = addDays(today(), -10);
    const seeded = await seedReport(db, {
      branchId: a.id,
      weekStart: pktWeekStart(tenDaysAgo),
      collections: [{ amount: '100', collectedOn: tenDaysAgo, createdBy: leadA.id }],
    });
    const id = seeded.collectionIds[0]!;
    const res = await send(itemRoute.PATCH, `/collections/${id}`, {
      method: 'PATCH',
      cookie: cookies.leadA,
      body: { amount: '200' },
      params: { id },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('collection_locked');
    const row = await db.query('SELECT amount FROM collections WHERE id = $1', [id]);
    expect(row.rows[0]).toEqual({ amount: '100.00' });
  });

  it('amends an editable collection', async () => {
    const own = await create(cookies.leadA);
    const res = await send(itemRoute.PATCH, `/collections/${own.id}`, {
      method: 'PATCH',
      cookie: cookies.leadA,
      body: { purpose: 'School fees' },
      params: { id: own.id },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.purpose).toBe('School fees');
  });

  it("answers another branch's collection exactly like a missing one", async () => {
    const foreign = await create(cookies.leadB);
    const missing = randomUUID();
    const patch = (id: string) =>
      send(itemRoute.PATCH, `/collections/${id}`, {
        method: 'PATCH',
        cookie: cookies.leadA,
        body: { purpose: 'Taken over' },
        params: { id },
      });
    const foreignRes = await patch(foreign.id);
    const missingRes = await patch(missing);
    expect(foreignRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    expect(withoutRequestId(await foreignRes.json())).toEqual(
      withoutRequestId(await missingRes.json()),
    );
    const getForeign = await send(itemRoute.GET, `/collections/${foreign.id}`, {
      cookie: cookies.leadA,
      params: { id: foreign.id },
    });
    expect(getForeign.status).toBe(404);
  });
});

describe('GET /api/v1/collections/:id', () => {
  it('returns the collection to its lead and to Finance', async () => {
    const own = await create(cookies.leadA);
    for (const cookie of [cookies.leadA, cookies.finance]) {
      const res = await send(itemRoute.GET, `/collections/${own.id}`, {
        cookie,
        params: { id: own.id },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).data.id).toBe(own.id);
    }
  });

  it('has no DELETE handler', () => {
    expect('DELETE' in itemRoute).toBe(false);
    expect('DELETE' in listRoute).toBe(false);
  });
});

describe('POST /api/v1/collections/:id/void', () => {
  it('needs a reason, voids once and refuses a second void', async () => {
    const own = await create(cookies.leadA);
    const voidIt = (body: unknown) =>
      send(postVoid, `/collections/${own.id}/void`, {
        cookie: cookies.leadA,
        body,
        params: { id: own.id },
      });
    expect((await voidIt({})).status).toBe(422);
    const ok = await voidIt({ reason: 'Duplicate entry' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({
      status: 'voided',
      voidReason: 'Duplicate entry',
    });
    const again = await voidIt({ reason: 'Duplicate entry' });
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe('collection_voided');
  });
});

describe('GET /api/v1/collections', () => {
  it('lists only the lead branch and honours the limit with the full total', async () => {
    const one = await create(cookies.leadA);
    const two = await create(cookies.leadA);
    await create(cookies.leadB);
    const res = await send(listRoute.GET, '/collections', { cookie: cookies.leadA });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.items.map((i: { id: string }) => i.id).sort()).toEqual([one.id, two.id].sort());
    expect(data.total).toBe(2);
    expect(data.totalActiveAmount).toBe('3001.00');

    const limited = (
      await (await send(listRoute.GET, '/collections?limit=1', { cookie: cookies.leadA })).json()
    ).data;
    expect(limited.items).toHaveLength(1);
    expect(limited.total).toBe(2);

    const all = (
      await (await send(listRoute.GET, '/collections', { cookie: cookies.finance })).json()
    ).data;
    expect(all.total).toBe(3);
  });
});

describe('GET /api/v1/collections/current-week', () => {
  it('serves the lead and refuses Finance', async () => {
    const res = await send(getCurrentWeek, '/collections/current-week', { cookie: cookies.leadA });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      weekStart: pktWeekStart(today()),
      today: today(),
      reportId: null,
      activeTotal: '0.00',
      branchStatus: 'active',
    });
    expect(
      (await send(getCurrentWeek, '/collections/current-week', { cookie: cookies.finance })).status,
    ).toBe(403);
  });
});
