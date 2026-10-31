import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as postApprove } from '@/app/api/v1/reports/[id]/approve/route';
import { POST as postReturn } from '@/app/api/v1/reports/[id]/return/route';
import * as reportRoute from '@/app/api/v1/reports/[id]/route';
import { POST as postSubmit } from '@/app/api/v1/reports/[id]/submit/route';
import { GET as getQueue } from '@/app/api/v1/reports/review-queue/route';
import { GET as listReports } from '@/app/api/v1/reports/route';
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
const getReport = reportRoute.GET;

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

// The list route runs ensureCurrentWeekDrafts with the system clock.
const currentWeek = () => pktWeekStart(pktDate(new Date()));
const PAST = (weeks: number) => addDays(currentWeek(), -7 * weeks);

let a: BranchRow;
let b: BranchRow;
let leadA: UserRow;
let leadB: UserRow;
let cookies: {
  leadA: string;
  leadB: string;
  finance1: string;
  finance2: string;
  admin: string;
  hr: string;
};

beforeEach(async () => {
  await resetDb(db);
  a = await seedBranch(db, { name: 'Alpha Branch' });
  b = await seedBranch(db, { name: 'Bravo Branch' });
  leadA = await seedUser(db, { role: 'branch_lead', branchId: a.id, name: 'Lead Alpha' });
  leadB = await seedUser(db, { role: 'branch_lead', branchId: b.id });
  const finance1 = await seedUser(db, { role: 'finance_reviewer' });
  const finance2 = await seedUser(db, { role: 'finance_reviewer' });
  const admin = await seedUser(db, { role: 'super_admin' });
  const hr = await seedUser(db, { role: 'hr_lead', branchId: a.id });
  cookies = {
    leadA: await createSessionCookie(db, leadA.id),
    leadB: await createSessionCookie(db, leadB.id),
    finance1: await createSessionCookie(db, finance1.id),
    finance2: await createSessionCookie(db, finance2.id),
    admin: await createSessionCookie(db, admin.id),
    hr: await createSessionCookie(db, hr.id),
  };
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

const reportStatus = async (id: string) =>
  (await db.query<{ status: string }>('SELECT status FROM weekly_reports WHERE id = $1', [id]))
    .rows[0]!.status;
const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);

function draftWith(branch: BranchRow, lead: UserRow, weeksAgo: number, amounts: string[] = []) {
  const weekStart = PAST(weeksAgo);
  return seedReport(db, {
    branchId: branch.id,
    weekStart,
    collections: amounts.map((amount) => ({ amount, createdBy: lead.id })),
  });
}

function submittedReport(weeksAgo: number) {
  return seedReport(db, {
    branchId: a.id,
    weekStart: PAST(weeksAgo),
    status: 'submitted',
    submittedBy: leadA.id,
    collections: [{ amount: '30.00', createdBy: leadA.id }],
  });
}

const submit = (
  id: string,
  cookie: string,
  body: unknown = {},
  opts: { origin?: string | null } = {},
) => send(postSubmit, `/reports/${id}/submit`, { cookie, body, params: { id }, ...opts });
const returnIt = (id: string, cookie: string, body: unknown) =>
  send(postReturn, `/reports/${id}/return`, { cookie, body, params: { id } });
const approve = (id: string, cookie: string) =>
  send(postApprove, `/reports/${id}/approve`, { cookie, method: 'POST', params: { id } });

describe('GET /api/v1/reports', () => {
  it('creates the current-week draft once for a lead and lists only own-branch reports', async () => {
    await draftWith(b, leadB, 1, ['5.00']);
    const first = await send(listReports, '/reports', { cookie: cookies.leadA });
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.data.total).toBe(1);
    expect(body.data.items[0]).toMatchObject({
      branchId: a.id,
      weekStart: currentWeek(),
      status: 'draft',
      amount: '0.00',
      amountIsFrozen: false,
    });
    await send(listReports, '/reports', { cookie: cookies.leadA });
    expect(
      await count(
        `SELECT count(*) AS n FROM weekly_reports WHERE branch_id = $1 AND week_start = $2::date`,
        [a.id, currentWeek()],
      ),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) AS n FROM audit_events WHERE action = 'report.create_draft'`),
    ).toBe(1);
  });

  it('lists every branch for finance, filters by query and refuses hr and anonymous callers', async () => {
    await draftWith(b, leadB, 1, ['5.00']);
    const res = await send(listReports, '/reports', { cookie: cookies.finance1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.total).toBe(3);
    expect(new Set(body.data.items.map((i: { branchId: string }) => i.branchId))).toEqual(
      new Set([a.id, b.id]),
    );
    const filtered = await send(listReports, `/reports?branchId=${b.id}&status=bogus&limit=1`, {
      cookie: cookies.finance1,
    });
    const filteredBody = await filtered.json();
    expect(filteredBody.data.total).toBe(2);
    expect(filteredBody.data.items).toHaveLength(1);

    expect((await send(listReports, '/reports', { cookie: cookies.hr })).status).toBe(403);
    expect((await send(listReports, '/reports')).status).toBe(401);
  });
});

describe('GET /api/v1/reports/review-queue', () => {
  it('shows submitted reports to finance and refuses super admin', async () => {
    const submitted = await submittedReport(1);
    await draftWith(a, leadA, 2, ['1.00']);
    const res = await send(getQueue, '/reports/review-queue', { cookie: cookies.finance1 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([submitted.reportId]);
    expect((await send(getQueue, '/reports/review-queue', { cookie: cookies.admin })).status).toBe(
      403,
    );
  });
});

describe('POST /api/v1/reports/:id/submit', () => {
  it('submits a draft with collections and returns the frozen amount', async () => {
    const draft = await draftWith(a, leadA, 1, ['12.50', '7.50']);
    const res = await submit(draft.reportId, cookies.leadA);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      id: draft.reportId,
      status: 'submitted',
      amount: '20.00',
      count: 2,
      amountIsFrozen: true,
      frozenAmount: '20.00',
      version: 1,
    });
  });

  it('needs nil confirmation for an empty draft', async () => {
    const draft = await draftWith(a, leadA, 1);
    const refused = await submit(draft.reportId, cookies.leadA, {});
    expect(refused.status).toBe(422);
    const refusedBody = await refused.json();
    expect(refusedBody.error.code).toBe('validation_failed');
    expect(refusedBody.error.details.fields).toEqual([
      expect.objectContaining({ path: 'confirmNil', code: 'nil_confirmation_required' }),
    ]);
    expect(await reportStatus(draft.reportId)).toBe('draft');

    const ok = await submit(draft.reportId, cookies.leadA, { confirmNil: true });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ status: 'submitted', amount: '0.00', count: 0 });
  });

  it('refuses a missing Origin, a missing body and the finance role', async () => {
    const draft = await draftWith(a, leadA, 1, ['3.00']);
    const noOrigin = await submit(draft.reportId, cookies.leadA, {}, { origin: null });
    expect(noOrigin.status).toBe(403);
    const noBody = await send(postSubmit, `/reports/${draft.reportId}/submit`, {
      cookie: cookies.leadA,
      method: 'POST',
      params: { id: draft.reportId },
    });
    expect(noBody.status).toBe(422);
    expect((await submit(draft.reportId, cookies.finance1)).status).toBe(403);
    expect(await reportStatus(draft.reportId)).toBe('draft');
    expect(await count('SELECT count(*) AS n FROM report_events')).toBe(0);
  });
});

describe('return and approve', () => {
  it('needs a reason to return, then refuses to approve a returned report', async () => {
    const { reportId } = await submittedReport(1);
    const noReason = await returnIt(reportId, cookies.finance1, {});
    expect(noReason.status).toBe(422);
    expect((await returnIt(reportId, cookies.finance1, { reason: 'ab' })).status).toBe(422);

    const returned = await returnIt(reportId, cookies.finance1, { reason: 'Receipt missing' });
    expect(returned.status).toBe(200);
    expect((await returned.json()).data).toMatchObject({
      status: 'returned',
      returnReason: 'Receipt missing',
    });

    const approveAfter = await approve(reportId, cookies.finance2);
    expect(approveAfter.status).toBe(409);
    expect((await approveAfter.json()).error.code).toBe('invalid_transition');
  });

  it('lets exactly one of two concurrent finance approvals win', async () => {
    const { reportId } = await submittedReport(1);
    const [one, two] = await Promise.all([
      approve(reportId, cookies.finance1),
      approve(reportId, cookies.finance2),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const loser = one.status === 409 ? one : two;
    expect((await loser.json()).error.code).toBe('invalid_transition');
    expect(
      await count(`SELECT count(*) AS n FROM report_events WHERE event_type = 'approved'`),
    ).toBe(1);
    expect(
      await count(`SELECT count(*) AS n FROM audit_events WHERE action = 'report.approve'`),
    ).toBe(1);
  });

  it('locks an approved report for every action and exposes no PATCH or DELETE', async () => {
    const { reportId } = await submittedReport(1);
    expect((await approve(reportId, cookies.finance1)).status).toBe(200);
    for (const res of [
      await submit(reportId, cookies.leadA, { confirmNil: true }),
      await returnIt(reportId, cookies.finance2, { reason: 'Second thoughts' }),
      await approve(reportId, cookies.finance2),
    ]) {
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('invalid_transition');
    }
    expect(await reportStatus(reportId)).toBe('approved');
    expect(Object.keys(reportRoute).sort()).toEqual(['GET', 'dynamic']);
  });

  it('refuses self-approval over HTTP', async () => {
    const reviewer = await seedUser(db, { role: 'finance_reviewer' });
    const cookie = await createSessionCookie(db, reviewer.id);
    const { reportId } = await seedReport(db, {
      branchId: a.id,
      weekStart: PAST(1),
      status: 'submitted',
      submittedBy: reviewer.id,
      collections: [{ amount: '1.00', createdBy: leadA.id }],
    });
    const res = await approve(reportId, cookie);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('self_approval');
  });
});

describe('cross-branch isolation', () => {
  it('answers another branch report exactly like a missing one', async () => {
    const other = await draftWith(b, leadB, 1, ['4.00']);
    const strip = async (res: Response) => {
      const body = await res.json();
      delete body.error.requestId;
      return { status: res.status, body };
    };
    const random = randomUUID();
    const getOther = await strip(
      await send(getReport, `/reports/${other.reportId}`, {
        cookie: cookies.leadA,
        params: { id: other.reportId },
      }),
    );
    const getRandom = await strip(
      await send(getReport, `/reports/${random}`, {
        cookie: cookies.leadA,
        params: { id: random },
      }),
    );
    expect(getOther.status).toBe(404);
    expect(getOther).toEqual(getRandom);

    const submitOther = await strip(
      await submit(other.reportId, cookies.leadA, { confirmNil: true }),
    );
    const submitRandom = await strip(await submit(random, cookies.leadA, { confirmNil: true }));
    expect(submitOther.status).toBe(404);
    expect(submitOther).toEqual(submitRandom);
    expect(await reportStatus(other.reportId)).toBe('draft');
  });

  it('returns the report detail for the own branch', async () => {
    const own = await draftWith(a, leadA, 1, ['4.00']);
    const res = await send(getReport, `/reports/${own.reportId}`, {
      cookie: cookies.leadA,
      params: { id: own.reportId },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      id: own.reportId,
      allowedActions: ['submit'],
      liveAmount: '4.00',
    });
  });
});
