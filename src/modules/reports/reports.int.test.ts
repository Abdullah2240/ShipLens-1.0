import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { Forbidden, NotFound } from '@/platform/errors';
import { fixedClock, type Clock } from '@/platform/time';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
} from '../../../tests/support/db';
import { seedCollection, seedReport } from '../../../tests/support/finance-fixtures';
import {
  approveReport,
  ensureCurrentWeekDrafts,
  getReport,
  listReports,
  listReviewQueue,
  returnReport,
  submitReport,
} from './service';

const db = testPool();
type Role = Actor['role'];

const NOW = '2026-11-04T06:00:00Z';
const WEEK = '2026-11-02'; // current PKT week of NOW
const PREV = '2026-10-26';
const OLDER = '2026-10-19';

// One context per call: a context is never shared between concurrent commands.
const ctx = (actor: Actor, clock: Clock = fixedClock(NOW)): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock,
  pool: db,
});

interface Fixture {
  a: BranchRow;
  b: BranchRow;
  p: BranchRow;
  f: BranchRow;
  c: BranchRow;
  leadA: Actor;
  leadB: Actor;
  leadP: Actor;
  leadC: Actor;
  r1: Actor;
  r2: Actor;
  admin: Actor;
  hrA: Actor;
}

async function fixture(): Promise<Fixture> {
  const a = await seedBranch(db, { name: 'Alpha', status: 'active' });
  const b = await seedBranch(db, { name: 'Bravo', status: 'active' });
  const p = await seedBranch(db, { name: 'Papa', status: 'paused' });
  const f = await seedBranch(db, { name: 'Foxtrot', status: 'forming' });
  const c = await seedBranch(db, { name: 'Charlie', status: 'closed' });
  const make = async (role: Role, name: string, branchId: string | null = null): Promise<Actor> => {
    const user = await seedUser(db, { role, branchId, name });
    return { userId: user.id, role, branchId: user.branch_id };
  };
  return {
    a,
    b,
    p,
    f,
    c,
    leadA: await make('branch_lead', 'Lead Alpha', a.id),
    leadB: await make('branch_lead', 'Lead Bravo', b.id),
    leadP: await make('branch_lead', 'Lead Papa', p.id),
    leadC: await make('branch_lead', 'Lead Charlie', c.id),
    r1: await make('finance_reviewer', 'Reviewer One'),
    r2: await make('finance_reviewer', 'Reviewer Two'),
    admin: await make('super_admin', 'Admin'),
    hrA: await make('hr_lead', 'Hr Alpha', a.id),
  };
}

type AuditRow = {
  id: string;
  occurred_at: Date;
  action: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  report_id: string | null;
  actor_id: string | null;
  request_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  tx: string;
};
async function audits(where = 'TRUE', params: unknown[] = []): Promise<AuditRow[]> {
  return (
    await db.query<AuditRow>(
      `SELECT *, xmin::text AS tx FROM audit_events WHERE ${where} ORDER BY id`,
      params,
    )
  ).rows;
}
type EventRow = {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  actor_id: string | null;
  reason: string | null;
  occurred_at: Date;
  tx: string;
};
async function events(reportId: string): Promise<EventRow[]> {
  return (
    await db.query<EventRow>(
      `SELECT id::text, event_type, from_status, to_status, actor_id, reason, occurred_at, xmin::text AS tx
       FROM report_events WHERE report_id = $1 ORDER BY id`,
      [reportId],
    )
  ).rows;
}
type ReportRow = {
  status: string;
  total_amount: string | null;
  collection_count: number | null;
  submitted_at: Date | null;
  submitted_by: string | null;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  return_reason: string | null;
  version: number;
  tx: string;
};
async function reportRow(id: string): Promise<ReportRow> {
  return (
    await db.query<ReportRow>(
      `SELECT status, total_amount::text, collection_count, submitted_at, submitted_by, reviewed_at,
         reviewed_by, return_reason, version, xmin::text AS tx
       FROM weekly_reports WHERE id = $1`,
      [id],
    )
  ).rows[0]!;
}
async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);
}
const rowCounts = async () => ({
  reports: await count('SELECT count(*) AS n FROM weekly_reports'),
  events: await count('SELECT count(*) AS n FROM report_events'),
  audits: await count('SELECT count(*) AS n FROM audit_events'),
});

const fails = (status: number, code: string) => ({ status, code });

let fx: Fixture;
beforeEach(async () => {
  await resetDb(db);
  fx = await fixture();
});
afterAll(() => closeTestPool());

describe('ensureCurrentWeekDrafts', () => {
  it('creates drafts for active branches only, once, with one audit row each', async () => {
    expect(await ensureCurrentWeekDrafts(ctx(fx.r1))).toBe(2);
    const { rows } = await db.query<{ branch_id: string; week_start: string; status: string }>(
      'SELECT branch_id, week_start::text, status FROM weekly_reports ORDER BY branch_id',
    );
    expect(rows.map((r) => r.branch_id).sort()).toEqual([fx.a.id, fx.b.id].sort());
    expect(rows.every((r) => r.week_start === WEEK && r.status === 'draft')).toBe(true);

    const rowsAudit = await audits();
    expect(rowsAudit).toHaveLength(2);
    for (const audit of rowsAudit) {
      expect(audit.action).toBe('report.create_draft');
      expect(audit.entity_type).toBe('report');
      expect(audit.report_id).toBe(audit.entity_id);
      expect([fx.a.id, fx.b.id]).toContain(audit.branch_id);
      expect(audit.actor_id).toBe(fx.r1.userId);
      expect(audit.before).toBeNull();
      expect(audit.after).toEqual({ status: 'draft', week_start: WEEK });
    }

    const before = await rowCounts();
    expect(await ensureCurrentWeekDrafts(ctx(fx.r1))).toBe(0);
    expect(await ensureCurrentWeekDrafts(ctx(fx.admin))).toBe(0);
    expect(await rowCounts()).toEqual(before);
  });

  it('creates only the own branch draft for a branch lead and nothing for a paused branch', async () => {
    expect(await ensureCurrentWeekDrafts(ctx(fx.leadA))).toBe(1);
    expect(
      await count('SELECT count(*) AS n FROM weekly_reports WHERE branch_id = $1', [fx.a.id]),
    ).toBe(1);
    expect(await count('SELECT count(*) AS n FROM weekly_reports')).toBe(1);
    expect(await ensureCurrentWeekDrafts(ctx(fx.leadP))).toBe(0);
    expect(await count('SELECT count(*) AS n FROM weekly_reports')).toBe(1);
  });

  it('is safe under three concurrent calls', async () => {
    const results = await Promise.all([
      ensureCurrentWeekDrafts(ctx(fx.r1)),
      ensureCurrentWeekDrafts(ctx(fx.r2)),
      ensureCurrentWeekDrafts(ctx(fx.admin)),
    ]);
    expect(results.reduce((s, n) => s + n, 0)).toBe(2);
    expect(await count('SELECT count(*) AS n FROM weekly_reports')).toBe(2);
    expect(
      await count(`SELECT count(*) AS n FROM audit_events WHERE action = 'report.create_draft'`),
    ).toBe(2);
  });

  it('keeps an existing current-week report and refuses roles without report.read', async () => {
    await seedReport(db, { branchId: fx.a.id, weekStart: WEEK });
    expect(await ensureCurrentWeekDrafts(ctx(fx.r1))).toBe(1);
    await expect(ensureCurrentWeekDrafts(ctx(fx.hrA))).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('listReports', () => {
  async function seedMix() {
    const aPrev = await seedReport(db, {
      branchId: fx.a.id,
      weekStart: PREV,
      status: 'submitted',
      submittedBy: fx.leadA.userId,
      collections: [
        { amount: '100.00', createdBy: fx.leadA.userId },
        { amount: '50.50', createdBy: fx.leadA.userId, collectedOn: '2026-10-27' },
      ],
    });
    const aWeek = await seedReport(db, {
      branchId: fx.a.id,
      weekStart: WEEK,
      collections: [
        { amount: '10.00', createdBy: fx.leadA.userId },
        { amount: '99.00', createdBy: fx.leadA.userId, status: 'voided' },
      ],
    });
    const bWeek = await seedReport(db, { branchId: fx.b.id, weekStart: WEEK });
    const bOld = await seedReport(db, {
      branchId: fx.b.id,
      weekStart: OLDER,
      status: 'approved',
      submittedBy: fx.leadB.userId,
      reviewedBy: fx.r1.userId,
      collections: [{ amount: '7.25', createdBy: fx.leadB.userId }],
    });
    return { aPrev, aWeek, bWeek, bOld };
  }

  it('scopes a branch lead to own rows and shows live or frozen totals', async () => {
    const s = await seedMix();
    const page = await listReports(db, fx.leadA, { limit: 60 });
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.id)).toEqual([s.aWeek.reportId, s.aPrev.reportId]);
    const [draft, submitted] = page.items;
    expect(draft).toMatchObject({
      status: 'draft',
      amount: '10.00',
      count: 1,
      amountIsFrozen: false,
      weekStart: WEEK,
      weekEnd: '2026-11-08',
      branchName: 'Alpha',
      branchCode: fx.a.code,
      branchStatus: 'active',
      submittedAt: null,
      submittedByName: null,
      version: 0,
    });
    expect(submitted).toMatchObject({
      status: 'submitted',
      amount: '150.50',
      count: 2,
      amountIsFrozen: true,
      submittedByName: 'Lead Alpha',
      version: 1,
    });
  });

  it('shows everything to finance and super admin ordered by week desc, branch name, id', async () => {
    const s = await seedMix();
    for (const actor of [fx.r1, fx.admin]) {
      const page = await listReports(db, actor, { limit: 60 });
      expect(page.total).toBe(4);
      expect(page.items.map((i) => i.id)).toEqual([
        s.aWeek.reportId,
        s.bWeek.reportId,
        s.aPrev.reportId,
        s.bOld.reportId,
      ]);
    }
    const approved = (await listReports(db, fx.r1, { limit: 60 })).items[3]!;
    expect(approved).toMatchObject({ amount: '7.25', count: 1, reviewedByName: 'Reviewer One' });
    expect(approved.reviewedAt).not.toBeNull();
    const empty = (await listReports(db, fx.r1, { limit: 60 })).items[1]!;
    expect(empty).toMatchObject({ amount: '0.00', count: 0, amountIsFrozen: false });
  });

  it('filters by status, branch and week and applies the limit to items only', async () => {
    const s = await seedMix();
    expect(
      (await listReports(db, fx.r1, { status: 'draft', limit: 60 })).items.map((i) => i.id),
    ).toEqual([s.aWeek.reportId, s.bWeek.reportId]);
    expect((await listReports(db, fx.r1, { branchId: fx.b.id, limit: 60 })).total).toBe(2);
    expect(
      (await listReports(db, fx.r1, { weekStart: PREV, limit: 60 })).items.map((i) => i.id),
    ).toEqual([s.aPrev.reportId]);
    const limited = await listReports(db, fx.r1, { limit: 1 });
    expect(limited.items).toHaveLength(1);
    expect(limited.total).toBe(4);
    // a branch filter cannot widen a lead's scope
    expect((await listReports(db, fx.leadA, { branchId: fx.b.id, limit: 60 })).total).toBe(0);
  });

  it('refuses roles without report.read', async () => {
    await expect(listReports(db, fx.hrA, { limit: 60 })).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('getReport', () => {
  it('returns collections (voided with reason), events with actor names and per-actor actions', async () => {
    const draft = await seedReport(db, {
      branchId: fx.a.id,
      weekStart: WEEK,
      collections: [
        { amount: '20.00', createdBy: fx.leadA.userId, purpose: 'Food packs' },
        { amount: '5.00', createdBy: fx.leadA.userId, status: 'voided', collectedOn: '2026-11-03' },
      ],
    });
    const detail = await getReport(db, fx.leadA, draft.reportId);
    expect(detail).toMatchObject({
      status: 'draft',
      liveAmount: '20.00',
      liveCount: 1,
      frozenAmount: null,
      frozenCount: null,
      returnReason: null,
      allowedActions: ['submit'],
      events: [],
    });
    expect(detail.collections).toHaveLength(2);
    expect(detail.collections[0]).toMatchObject({
      amount: '20.00',
      purpose: 'Food packs',
      status: 'active',
      collectedOn: WEEK,
      createdByName: 'Lead Alpha',
      voidReason: null,
      routedAt: null,
    });
    expect(detail.collections[1]).toMatchObject({ status: 'voided', voidReason: 'Fixture void' });
    expect((await getReport(db, fx.admin, draft.reportId)).allowedActions).toEqual([]);
    expect((await getReport(db, fx.r1, draft.reportId)).allowedActions).toEqual([]);

    await submitReport(ctx(fx.leadA), draft.reportId, {});
    const submitted = await getReport(db, fx.r1, draft.reportId);
    expect(submitted.allowedActions).toEqual(['return', 'approve']);
    expect(submitted.frozenAmount).toBe('20.00');
    expect(submitted.frozenCount).toBe(1);
    expect(submitted.events).toEqual([
      expect.objectContaining({
        type: 'submitted',
        fromStatus: 'draft',
        toStatus: 'submitted',
        actorName: 'Lead Alpha',
        reason: null,
      }),
    ]);
    expect((await getReport(db, fx.leadA, draft.reportId)).allowedActions).toEqual([]);
    expect((await getReport(db, fx.admin, draft.reportId)).allowedActions).toEqual([]);
  });

  it('offers only return to a reviewer who submitted the report', async () => {
    const forged = await seedReport(db, {
      branchId: fx.a.id,
      weekStart: WEEK,
      status: 'submitted',
      submittedBy: fx.r1.userId,
      collections: [{ amount: '1.00', createdBy: fx.leadA.userId }],
    });
    expect((await getReport(db, fx.r1, forged.reportId)).allowedActions).toEqual(['return']);
    expect((await getReport(db, fx.r2, forged.reportId)).allowedActions).toEqual([
      'return',
      'approve',
    ]);
  });

  it('gives the same NotFound for another branch, a random id and a malformed id', async () => {
    const other = await seedReport(db, { branchId: fx.b.id, weekStart: WEEK });
    for (const id of [other.reportId, randomUUID(), 'bad-id']) {
      const error = await getReport(db, fx.leadA, id).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFound);
      expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Not found' });
    }
    await expect(getReport(db, fx.hrA, other.reportId)).rejects.toBeInstanceOf(Forbidden);
  });
});

describe('submitReport', () => {
  it('freezes the active total, writes one event then one audit row in one transaction', async () => {
    const draft = await seedReport(db, {
      branchId: fx.a.id,
      weekStart: WEEK,
      collections: [
        { amount: '100.10', createdBy: fx.leadA.userId },
        { amount: '0.90', createdBy: fx.leadA.userId, collectedOn: '2026-11-04' },
        { amount: '500.00', createdBy: fx.leadA.userId, status: 'voided' },
      ],
    });
    const c = ctx(fx.leadA);
    const detail = await submitReport(c, draft.reportId, {});
    expect(detail).toMatchObject({
      status: 'submitted',
      amount: '101.00',
      count: 2,
      amountIsFrozen: true,
      version: 1,
      submittedAt: '2026-11-04T06:00:00.000Z',
      submittedByName: 'Lead Alpha',
      allowedActions: [],
    });

    const row = await reportRow(draft.reportId);
    expect(row).toMatchObject({
      status: 'submitted',
      total_amount: '101.00',
      collection_count: 2,
      submitted_by: fx.leadA.userId,
      version: 1,
    });
    expect(row.submitted_at?.toISOString()).toBe('2026-11-04T06:00:00.000Z');

    const evs = await events(draft.reportId);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      event_type: 'submitted',
      from_status: 'draft',
      to_status: 'submitted',
      actor_id: fx.leadA.userId,
      reason: null,
    });
    const rowsAudit = await audits('report_id = $1', [draft.reportId]);
    expect(rowsAudit).toHaveLength(1);
    expect(rowsAudit[0]).toMatchObject({
      action: 'report.submit',
      entity_type: 'report',
      entity_id: draft.reportId,
      branch_id: fx.a.id,
      report_id: draft.reportId,
      actor_id: fx.leadA.userId,
      request_id: c.requestId,
      before: { status: 'draft', total_amount: null, collection_count: null, version: 0 },
      after: { status: 'submitted', total_amount: '101.00', collection_count: 2, version: 1 },
    });
    // the report update, its event and its audit row commit in the same transaction
    expect(new Set([row.tx, evs[0]!.tx, rowsAudit[0]!.tx]).size).toBe(1);
  });

  it('requires an explicit nil confirmation for a report with no active collections', async () => {
    const draft = await seedReport(db, {
      branchId: fx.a.id,
      weekStart: WEEK,
      collections: [{ amount: '9.00', createdBy: fx.leadA.userId, status: 'voided' }],
    });
    const before = await rowCounts();
    for (const input of [{}, { confirmNil: false }]) {
      await expect(submitReport(ctx(fx.leadA), draft.reportId, input)).rejects.toMatchObject({
        status: 422,
        details: {
          fields: [
            expect.objectContaining({ path: 'confirmNil', code: 'nil_confirmation_required' }),
          ],
        },
      });
    }
    expect(await rowCounts()).toEqual(before);
    expect((await reportRow(draft.reportId)).status).toBe('draft');

    const detail = await submitReport(ctx(fx.leadA), draft.reportId, { confirmNil: true });
    expect(detail).toMatchObject({ status: 'submitted', amount: '0.00', count: 0 });
    expect(await reportRow(draft.reportId)).toMatchObject({
      total_amount: '0.00',
      collection_count: 0,
    });
  });

  it('refuses other branches, head office roles and unknown input', async () => {
    const other = await seedReport(db, { branchId: fx.b.id, weekStart: WEEK });
    const before = await rowCounts();
    await expect(
      submitReport(ctx(fx.leadA), other.reportId, { confirmNil: true }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      submitReport(ctx(fx.leadA), randomUUID(), { confirmNil: true }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      submitReport(ctx(fx.r1), other.reportId, { confirmNil: true }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      submitReport(ctx(fx.admin), other.reportId, { confirmNil: true }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      submitReport(ctx(fx.leadB), other.reportId, { confirmNil: 'yes' } as never),
    ).rejects.toMatchObject({ status: 422 });
    expect(await rowCounts()).toEqual(before);
  });

  it('refuses a closed branch and allows a paused branch', async () => {
    const closed = await seedReport(db, { branchId: fx.c.id, weekStart: WEEK });
    const before = await rowCounts();
    await expect(
      submitReport(ctx(fx.leadC), closed.reportId, { confirmNil: true }),
    ).rejects.toMatchObject(fails(409, 'branch_closed'));
    expect(await rowCounts()).toEqual(before);

    const paused = await seedReport(db, {
      branchId: fx.p.id,
      weekStart: WEEK,
      collections: [{ amount: '12.00', createdBy: fx.leadP.userId }],
    });
    expect(await submitReport(ctx(fx.leadP), paused.reportId, {})).toMatchObject({
      status: 'submitted',
      amount: '12.00',
    });
  });
});

describe('returnReport and resubmission', () => {
  async function submitted() {
    const draft = await seedReport(db, {
      branchId: fx.a.id,
      weekStart: WEEK,
      collections: [{ amount: '40.00', createdBy: fx.leadA.userId }],
    });
    await submitReport(ctx(fx.leadA), draft.reportId, {});
    return draft.reportId;
  }

  it('needs a reason, then returns the report and reopens its collections', async () => {
    const id = await submitted();
    const before = await rowCounts();
    for (const input of [{}, { reason: '' }, { reason: '  x ' }, { reason: 'y'.repeat(501) }]) {
      await expect(returnReport(ctx(fx.r1), id, input as never)).rejects.toMatchObject({
        status: 422,
        details: { fields: [expect.objectContaining({ path: 'reason' })] },
      });
    }
    expect(await rowCounts()).toEqual(before);

    const c = ctx(fx.r1);
    const detail = await returnReport(c, id, { reason: '  Receipt missing for Tuesday  ' });
    expect(detail).toMatchObject({
      status: 'returned',
      returnReason: 'Receipt missing for Tuesday',
      reviewedByName: 'Reviewer One',
      reviewedAt: '2026-11-04T06:00:00.000Z',
      version: 2,
      amountIsFrozen: false,
      amount: '40.00',
      frozenAmount: '40.00',
    });
    expect(await reportRow(id)).toMatchObject({
      status: 'returned',
      return_reason: 'Receipt missing for Tuesday',
      reviewed_by: fx.r1.userId,
      version: 2,
    });
    const evs = await events(id);
    expect(evs.map((e) => e.event_type)).toEqual(['submitted', 'returned']);
    expect(evs[1]).toMatchObject({
      from_status: 'submitted',
      to_status: 'returned',
      actor_id: fx.r1.userId,
      reason: 'Receipt missing for Tuesday',
    });
    const rowsAudit = await audits('report_id = $1', [id]);
    expect(rowsAudit.map((r) => r.action)).toEqual(['report.submit', 'report.return']);
    expect(rowsAudit[1]).toMatchObject({
      actor_id: fx.r1.userId,
      branch_id: fx.a.id,
      request_id: c.requestId,
      before: { status: 'submitted', return_reason: null, version: 1 },
      after: { status: 'returned', return_reason: 'Receipt missing for Tuesday', version: 2 },
    });

    // collections reopen at the database level
    await expect(
      seedCollection(db, {
        branchId: fx.a.id,
        reportId: id,
        amount: '2.50',
        createdBy: fx.leadA.userId,
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it('resubmits with refrozen totals, a resubmitted event and a report.resubmit audit row', async () => {
    const id = await submitted();
    await returnReport(ctx(fx.r1), id, { reason: 'Add the Friday collection' });
    await seedCollection(db, {
      branchId: fx.a.id,
      reportId: id,
      amount: '2.50',
      collectedOn: '2026-11-06',
      createdBy: fx.leadA.userId,
    });
    const detail = await submitReport(ctx(fx.leadA), id, {});
    expect(detail).toMatchObject({ status: 'submitted', amount: '42.50', count: 2, version: 3 });
    expect(await reportRow(id)).toMatchObject({
      total_amount: '42.50',
      collection_count: 2,
      version: 3,
    });
    const evs = await events(id);
    expect(evs.map((e) => e.event_type)).toEqual(['submitted', 'returned', 'resubmitted']);
    expect(evs[2]).toMatchObject({ from_status: 'returned', to_status: 'submitted', reason: null });
    const last = (await audits('report_id = $1', [id])).at(-1)!;
    expect(last).toMatchObject({
      action: 'report.resubmit',
      before: { status: 'returned', total_amount: '40.00', collection_count: 1, version: 2 },
      after: { status: 'submitted', total_amount: '42.50', collection_count: 2, version: 3 },
    });
  });

  it('records only changed fields when a resubmission keeps the same totals', async () => {
    const id = await submitted();
    await returnReport(ctx(fx.r1), id, { reason: 'Check the purpose text' });
    await submitReport(ctx(fx.leadA), id, {});
    const last = (await audits('report_id = $1', [id])).at(-1)!;
    expect(last.action).toBe('report.resubmit');
    expect(last.before).toEqual({ status: 'returned', version: 2 });
    expect(last.after).toEqual({ status: 'submitted', version: 3 });
  });

  it('refuses return by leads and super admin and on a draft', async () => {
    const id = await submitted();
    const draft = await seedReport(db, { branchId: fx.b.id, weekStart: WEEK });
    const before = await rowCounts();
    await expect(returnReport(ctx(fx.leadA), id, { reason: 'Nope nope' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(returnReport(ctx(fx.admin), id, { reason: 'Nope nope' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(
      returnReport(ctx(fx.r1), draft.reportId, { reason: 'Too early' }),
    ).rejects.toMatchObject(fails(409, 'invalid_transition'));
    expect(await rowCounts()).toEqual(before);
  });
});

describe('approveReport', () => {
  async function submittedBy(submitter: Actor, branch = fx.a) {
    const r = await seedReport(db, {
      branchId: branch.id,
      weekStart: WEEK,
      status: 'submitted',
      submittedBy: submitter.userId,
      collections: [
        { amount: '30.00', createdBy: fx.leadA.userId },
        { amount: '1.00', createdBy: fx.leadA.userId, status: 'voided' },
      ],
    });
    return r.reportId;
  }

  it('approves, then locks the report forever for every action and role', async () => {
    const id = await submittedBy(fx.leadA);
    const c = ctx(fx.r1);
    const detail = await approveReport(c, id);
    expect(detail).toMatchObject({
      status: 'approved',
      reviewedByName: 'Reviewer One',
      reviewedAt: '2026-11-04T06:00:00.000Z',
      amount: '30.00',
      amountIsFrozen: true,
      version: 2,
      allowedActions: [],
    });
    const evs = await events(id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      event_type: 'approved',
      from_status: 'submitted',
      to_status: 'approved',
      actor_id: fx.r1.userId,
    });
    const rowsAudit = await audits('report_id = $1', [id]);
    expect(rowsAudit).toHaveLength(1);
    expect(rowsAudit[0]).toMatchObject({
      action: 'report.approve',
      request_id: c.requestId,
      before: { status: 'submitted', version: 1 },
      after: { status: 'approved', version: 2 },
    });
    expect(new Set([(await reportRow(id)).tx, evs[0]!.tx, rowsAudit[0]!.tx]).size).toBe(1);

    const before = await rowCounts();
    await expect(submitReport(ctx(fx.leadA), id, { confirmNil: true })).rejects.toMatchObject(
      fails(409, 'invalid_transition'),
    );
    await expect(returnReport(ctx(fx.r2), id, { reason: 'Second thoughts' })).rejects.toMatchObject(
      fails(409, 'invalid_transition'),
    );
    await expect(approveReport(ctx(fx.r2), id)).rejects.toMatchObject(
      fails(409, 'invalid_transition'),
    );
    // Super Admin has no override
    await expect(approveReport(ctx(fx.admin), id)).rejects.toBeInstanceOf(Forbidden);
    await expect(returnReport(ctx(fx.admin), id, { reason: 'Override' })).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(submitReport(ctx(fx.admin), id, {})).rejects.toBeInstanceOf(Forbidden);
    await expect(approveReport(ctx(fx.leadA), id)).rejects.toBeInstanceOf(Forbidden);
    expect(await rowCounts()).toEqual(before);
    expect((await reportRow(id)).status).toBe('approved');
  });

  it('refuses self-approval and lets another reviewer approve', async () => {
    const id = await submittedBy(fx.r1);
    const before = await rowCounts();
    await expect(approveReport(ctx(fx.r1), id)).rejects.toMatchObject(fails(409, 'self_approval'));
    expect(await rowCounts()).toEqual(before);
    expect((await reportRow(id)).status).toBe('submitted');
    expect(await approveReport(ctx(fx.r2), id)).toMatchObject({ status: 'approved' });
  });

  it('refuses to approve when the frozen total no longer matches the collections', async () => {
    const id = await submittedBy(fx.leadA);
    await db.query('UPDATE weekly_reports SET total_amount = total_amount + 1 WHERE id = $1', [id]);
    const before = await rowCounts();
    await expect(approveReport(ctx(fx.r1), id)).rejects.toMatchObject(
      fails(409, 'totals_mismatch'),
    );
    expect(await rowCounts()).toEqual(before);
    expect((await reportRow(id)).status).toBe('submitted');

    const other = await seedReport(db, {
      branchId: fx.b.id,
      weekStart: WEEK,
      status: 'submitted',
      submittedBy: fx.leadB.userId,
      collections: [{ amount: '3.00', createdBy: fx.leadB.userId }],
    });
    await db.query('UPDATE weekly_reports SET collection_count = 5 WHERE id = $1', [
      other.reportId,
    ]);
    await expect(approveReport(ctx(fx.r1), other.reportId)).rejects.toMatchObject(
      fails(409, 'totals_mismatch'),
    );
  });

  it('gives NotFound for a random or malformed id and Conflict on a draft', async () => {
    await expect(approveReport(ctx(fx.r1), randomUUID())).rejects.toBeInstanceOf(NotFound);
    await expect(approveReport(ctx(fx.r1), 'bad-id')).rejects.toBeInstanceOf(NotFound);
    const draft = await seedReport(db, { branchId: fx.a.id, weekStart: WEEK });
    await expect(approveReport(ctx(fx.r1), draft.reportId)).rejects.toMatchObject(
      fails(409, 'invalid_transition'),
    );
  });
});

describe('listReviewQueue', () => {
  it('lists submitted reports of every branch, oldest submission first, for finance only', async () => {
    const first = await seedReport(db, {
      branchId: fx.b.id,
      weekStart: PREV,
      status: 'submitted',
      submittedBy: fx.leadB.userId,
    });
    const second = await seedReport(db, {
      branchId: fx.a.id,
      weekStart: WEEK,
      status: 'submitted',
      submittedBy: fx.leadA.userId,
      collections: [{ amount: '8.00', createdBy: fx.leadA.userId }],
    });
    await db.query(
      `UPDATE weekly_reports SET submitted_at = '2026-11-01T00:00:00Z' WHERE id = $1`,
      [first.reportId],
    );
    await db.query(
      `UPDATE weekly_reports SET submitted_at = '2026-11-03T00:00:00Z' WHERE id = $1`,
      [second.reportId],
    );
    await seedReport(db, { branchId: fx.a.id, weekStart: PREV });
    await seedReport(db, {
      branchId: fx.a.id,
      weekStart: OLDER,
      status: 'approved',
      submittedBy: fx.leadA.userId,
      reviewedBy: fx.r1.userId,
    });

    const queue = await listReviewQueue(db, fx.r1);
    expect(queue.map((r) => r.id)).toEqual([first.reportId, second.reportId]);
    expect(queue[1]).toMatchObject({ status: 'submitted', amount: '8.00', amountIsFrozen: true });
    await expect(listReviewQueue(db, fx.admin)).rejects.toBeInstanceOf(Forbidden);
    await expect(listReviewQueue(db, fx.leadA)).rejects.toBeInstanceOf(Forbidden);
  });
});
