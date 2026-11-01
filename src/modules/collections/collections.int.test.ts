import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { fixedClock, type Clock } from '@/platform/time';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
} from '../../../tests/support/db';
import { seedReport } from '../../../tests/support/finance-fixtures';
import * as collections from './index';
import {
  amendCollection,
  createCollection,
  getCollection,
  getCurrentWeek,
  listCollections,
  voidCollection,
} from './service';

const db = testPool();
const NOW = '2026-11-04T06:00:00Z'; // PKT Wednesday 2026-11-04, 11:00

type Fixture = {
  a: BranchRow;
  b: BranchRow;
  p: BranchRow;
  c: BranchRow;
  f: BranchRow;
  leadA: Actor;
  leadB: Actor;
  leadP: Actor;
  leadC: Actor;
  leadF: Actor;
  admin: Actor;
  finance: Actor;
  hrA: Actor;
};
let f: Fixture;

const clock = (): Clock => fixedClock(NOW);
const ctx = (actor: Actor, c: Clock = clock()): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: c,
  pool: db,
});
const actorOf = (u: { id: string; role: string; branch_id: string | null }): Actor => ({
  userId: u.id,
  role: u.role as Actor['role'],
  branchId: u.branch_id,
});
const input = (over: Partial<{ amount: string; collectedOn: string; purpose: string }> = {}) => ({
  amount: '1250',
  collectedOn: '2026-11-03',
  purpose: 'Ration packs',
  ...over,
});

type AuditRow = {
  action: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  report_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
const audits = async () =>
  (
    await db.query<AuditRow>(
      `SELECT action, entity_type, entity_id, branch_id, report_id, before, after
       FROM audit_events ORDER BY id`,
    )
  ).rows;
const count = async (table: 'collections' | 'weekly_reports') =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

const conflict = (code: string) => ({ status: 409, code });
const invalid = (path: string, code: string) => ({
  status: 422,
  details: { fields: [expect.objectContaining({ path, code })] },
});

beforeEach(async () => {
  await resetDb(db);
  const a = await seedBranch(db, { name: 'Alpha', status: 'active' });
  const b = await seedBranch(db, { name: 'Bravo', status: 'active' });
  const p = await seedBranch(db, { name: 'Paused', status: 'paused' });
  const c = await seedBranch(db, { name: 'Closed', status: 'closed' });
  const fm = await seedBranch(db, { name: 'Forming', status: 'forming' });
  const lead = async (branch: BranchRow) =>
    actorOf(await seedUser(db, { role: 'branch_lead', branchId: branch.id }));
  f = {
    a,
    b,
    p,
    c,
    f: fm,
    leadA: await lead(a),
    leadB: await lead(b),
    leadP: await lead(p),
    leadC: await lead(c),
    leadF: await lead(fm),
    admin: actorOf(await seedUser(db, { role: 'super_admin' })),
    finance: actorOf(await seedUser(db, { role: 'finance_reviewer' })),
    hrA: actorOf(await seedUser(db, { role: 'hr_lead', branchId: a.id })),
  };
});
afterAll(() => closeTestPool());

describe('createCollection', () => {
  it('lazily creates the week draft, attaches the collection and audits both', async () => {
    const item = await createCollection(ctx(f.leadA), input());
    expect(item).toMatchObject({
      branchId: f.a.id,
      branchStatus: 'active',
      weekStart: '2026-11-02',
      reportStatus: 'draft',
      amount: '1250.00',
      collectedOn: '2026-11-03',
      purpose: 'Ration packs',
      note: null,
      status: 'active',
      voidReason: null,
      editability: 'editable',
      lock: { lastEditableOn: '2026-11-10', locked: false, daysLeft: 6 },
    });
    expect(item.createdByName).toEqual(expect.any(String));
    const reports = await db.query(
      'SELECT id FROM weekly_reports WHERE branch_id = $1 AND week_start = $2',
      [f.a.id, '2026-11-02'],
    );
    expect(reports.rows).toEqual([{ id: item.reportId }]);

    const rows = await audits();
    expect(rows.map((r) => r.action)).toEqual(['report.create_draft', 'collection.create']);
    expect(rows[0]).toMatchObject({
      entity_type: 'report',
      entity_id: item.reportId,
      branch_id: f.a.id,
      report_id: item.reportId,
      before: null,
      after: { status: 'draft', week_start: '2026-11-02' },
    });
    expect(rows[1]).toMatchObject({
      entity_type: 'collection',
      entity_id: item.id,
      branch_id: f.a.id,
      report_id: item.reportId,
      before: null,
    });
    expect(rows[1]!.after).toEqual({
      amount: '1250.00',
      collected_on: '2026-11-03',
      purpose: 'Ration packs',
      status: 'active',
      report_id: item.reportId,
    });
  });

  it('reuses the existing draft for the same week without a second create_draft', async () => {
    const first = await createCollection(ctx(f.leadA), input());
    const second = await createCollection(ctx(f.leadA), input({ collectedOn: '2026-11-04' }));
    expect(second.reportId).toBe(first.reportId);
    expect(await count('weekly_reports')).toBe(1);
    expect((await audits()).map((r) => r.action)).toEqual([
      'report.create_draft',
      'collection.create',
      'collection.create',
    ]);
  });

  it('lets a forming branch log and refuses paused and closed branches', async () => {
    const forming = await createCollection(ctx(f.leadF), input());
    expect(forming.branchStatus).toBe('forming');
    expect(await count('collections')).toBe(1);
    await expect(createCollection(ctx(f.leadP), input())).rejects.toMatchObject(
      conflict('branch_not_accepting'),
    );
    await expect(createCollection(ctx(f.leadC), input())).rejects.toMatchObject(
      conflict('branch_not_accepting'),
    );
    expect(await count('collections')).toBe(1);
    expect(await count('weekly_reports')).toBe(1);
  });

  it('refuses future dates and dates past the lock window', async () => {
    await expect(
      createCollection(ctx(f.leadA), input({ collectedOn: '2026-11-05' })),
    ).rejects.toMatchObject(invalid('collectedOn', 'future_date'));
    await expect(
      createCollection(ctx(f.leadA), input({ collectedOn: '2026-10-27' })),
    ).rejects.toMatchObject(invalid('collectedOn', 'outside_lock_window'));
    expect(await count('collections')).toBe(0);
    const day7 = await createCollection(ctx(f.leadA), input({ collectedOn: '2026-10-28' }));
    expect(day7.weekStart).toBe('2026-10-26');
    expect(day7.lock).toEqual({ lastEditableOn: '2026-11-04', locked: false, daysLeft: 0 });
  });

  it('validates the input itself', async () => {
    await expect(createCollection(ctx(f.leadA), input({ amount: '1.234' }))).rejects.toMatchObject(
      invalid('amount', 'invalid_money'),
    );
    await expect(
      createCollection(ctx(f.leadA), input({ collectedOn: '2026-02-30' })),
    ).rejects.toMatchObject(invalid('collectedOn', 'invalid_date'));
  });

  it('creates exactly one draft under concurrent creates for a new week', async () => {
    const results = await Promise.all(
      ['100', '200', '300'].map((amount) => createCollection(ctx(f.leadA), input({ amount }))),
    );
    expect(new Set(results.map((r) => r.reportId)).size).toBe(1);
    expect(await count('collections')).toBe(3);
    expect(await count('weekly_reports')).toBe(1);
    const actions = (await audits()).map((r) => r.action);
    expect(actions.filter((a) => a === 'report.create_draft')).toHaveLength(1);
    expect(actions.filter((a) => a === 'collection.create')).toHaveLength(3);
  });

  it('refuses a submitted week and accepts a returned one', async () => {
    await seedReport(db, {
      branchId: f.a.id,
      weekStart: '2026-11-02',
      status: 'submitted',
      submittedBy: f.leadA.userId,
    });
    await expect(createCollection(ctx(f.leadA), input())).rejects.toMatchObject(
      conflict('report_not_open'),
    );
    expect(await count('collections')).toBe(0);
    expect(await audits()).toEqual([]);

    const returned = await seedReport(db, {
      branchId: f.b.id,
      weekStart: '2026-11-02',
      status: 'returned',
      submittedBy: f.leadB.userId,
      reviewedBy: f.finance.userId,
    });
    const item = await createCollection(ctx(f.leadB), input());
    expect(item).toMatchObject({ reportId: returned.reportId, reportStatus: 'returned' });
    expect((await audits()).map((r) => r.action)).toEqual(['collection.create']);
  });
});

describe('scope and permissions', () => {
  it('keeps Super Admin and Finance Reviewer read only and HR Lead out', async () => {
    const own = await createCollection(ctx(f.leadA), input());
    for (const actor of [f.admin, f.finance]) {
      await expect(createCollection(ctx(actor), input())).rejects.toMatchObject({ status: 403 });
      await expect(amendCollection(ctx(actor), own.id, { purpose: 'Other' })).rejects.toMatchObject(
        { status: 403 },
      );
      await expect(voidCollection(ctx(actor), own.id, { reason: 'Nope' })).rejects.toMatchObject({
        status: 403,
      });
      expect((await getCollection(db, actor, clock(), own.id)).id).toBe(own.id);
    }
    await expect(listCollections(db, f.hrA, clock(), { limit: 100 })).rejects.toMatchObject({
      status: 403,
    });
    await expect(getCollection(db, f.hrA, clock(), own.id)).rejects.toMatchObject({
      status: 403,
    });
    await expect(getCurrentWeek(db, f.finance, clock())).rejects.toMatchObject({ status: 403 });
  });

  it('answers another branch, a random id and a malformed id with the same NotFound', async () => {
    const foreign = await createCollection(ctx(f.leadB), input());
    for (const id of [foreign.id, randomUUID(), 'bad-id']) {
      const errors = await Promise.all([
        amendCollection(ctx(f.leadA), id, { purpose: 'Taken over' }).catch((e: unknown) => e),
        voidCollection(ctx(f.leadA), id, { reason: 'Taken over' }).catch((e: unknown) => e),
        getCollection(db, f.leadA, clock(), id).catch((e: unknown) => e),
      ]);
      for (const error of errors)
        expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Not found' });
    }
    const row = await db.query('SELECT purpose, status FROM collections WHERE id = $1', [
      foreign.id,
    ]);
    expect(row.rows[0]).toEqual({ purpose: 'Ration packs', status: 'active' });
  });

  it('lists in scope, filters, orders and sums active amounts only', async () => {
    const a1 = await createCollection(
      ctx(f.leadA),
      input({ amount: '100', collectedOn: '2026-11-03' }),
    );
    const a2 = await createCollection(
      ctx(f.leadA),
      input({ amount: '200', collectedOn: '2026-11-04' }),
    );
    const a3 = await createCollection(
      ctx(f.leadA),
      input({ amount: '300.50', collectedOn: '2026-11-03' }),
    );
    const old = await createCollection(
      ctx(f.leadA),
      input({ amount: '5', collectedOn: '2026-10-30' }),
    );
    const b1 = await createCollection(ctx(f.leadB), input({ amount: '999' }));
    await voidCollection(ctx(f.leadA), a1.id, { reason: 'Duplicate entry' });

    const mine = await listCollections(db, f.leadA, clock(), { limit: 100 });
    expect(mine.items.map((i) => i.id)).toEqual([a2.id, a3.id, a1.id, old.id]);
    expect(mine.total).toBe(4);
    expect(mine.totalActiveAmount).toBe('505.50');
    const voided = mine.items.find((i) => i.id === a1.id)!;
    expect(voided).toMatchObject({
      status: 'voided',
      voidReason: 'Duplicate entry',
      editability: 'voided',
    });

    // A lead's branch filter cannot widen the scope.
    expect(
      (await listCollections(db, f.leadA, clock(), { branchId: f.b.id, limit: 100 })).items,
    ).toEqual([]);

    const all = await listCollections(db, f.finance, clock(), { limit: 100 });
    expect(all.total).toBe(5);
    expect(all.totalActiveAmount).toBe('1504.50');
    expect(
      (await listCollections(db, f.finance, clock(), { branchId: f.b.id, limit: 100 })).items.map(
        (i) => i.id,
      ),
    ).toEqual([b1.id]);
    expect(
      (
        await listCollections(db, f.finance, clock(), { reportId: old.reportId, limit: 100 })
      ).items.map((i) => i.id),
    ).toEqual([old.id]);
    expect(
      (
        await listCollections(db, f.finance, clock(), { weekStart: '2026-10-26', limit: 100 })
      ).items.map((i) => i.id),
    ).toEqual([old.id]);
    const onlyVoided = await listCollections(db, f.admin, clock(), {
      status: 'voided',
      limit: 100,
    });
    expect(onlyVoided.items.map((i) => i.id)).toEqual([a1.id]);
    expect(onlyVoided.totalActiveAmount).toBe('0.00');

    const limited = await listCollections(db, f.finance, clock(), { limit: 2 });
    expect(limited.items).toHaveLength(2);
    expect(limited.total).toBe(5);
    expect(limited.totalActiveAmount).toBe('1504.50');
  });
});

describe('amendCollection', () => {
  it('audits before and after of exactly the changed fields', async () => {
    const item = await createCollection(ctx(f.leadA), input());
    const amended = await amendCollection(ctx(f.leadA), item.id, {
      amount: '1300',
      purpose: 'Zakat',
      collectedOn: '2026-11-03',
    });
    expect(amended).toMatchObject({
      amount: '1300.00',
      purpose: 'Zakat',
      collectedOn: '2026-11-03',
    });
    const last = (await audits()).at(-1)!;
    expect(last).toMatchObject({
      action: 'collection.amend',
      entity_id: item.id,
      branch_id: f.a.id,
      report_id: item.reportId,
    });
    expect(last.before).toEqual({ amount: '1250.00', purpose: 'Ration packs' });
    expect(last.after).toEqual({ amount: '1300.00', purpose: 'Zakat' });
  });

  it('records a note-only change with no field values and skips a no-op patch', async () => {
    const item = await createCollection(ctx(f.leadA), input());
    const noted = await amendCollection(ctx(f.leadA), item.id, { note: 'Cash in envelope' });
    expect(noted.note).toBe('Cash in envelope');
    const last = (await audits()).at(-1)!;
    expect(last).toMatchObject({ action: 'collection.amend', before: {}, after: {} });

    const auditCount = (await audits()).length;
    const same = await amendCollection(ctx(f.leadA), item.id, {
      amount: '1250.00',
      purpose: 'Ration packs',
      note: 'Cash in envelope',
    });
    expect(same.amount).toBe('1250.00');
    expect((await audits()).length).toBe(auditCount);

    const cleared = await amendCollection(ctx(f.leadA), item.id, { note: null });
    expect(cleared.note).toBeNull();
  });

  it('moves the date within the week only', async () => {
    const item = await createCollection(ctx(f.leadA), input());
    const moved = await amendCollection(ctx(f.leadA), item.id, { collectedOn: '2026-11-02' });
    expect(moved.collectedOn).toBe('2026-11-02');
    expect((await audits()).at(-1)!.after).toEqual({ collected_on: '2026-11-02' });
    await expect(
      amendCollection(ctx(f.leadA), item.id, { collectedOn: '2026-10-31' }),
    ).rejects.toMatchObject(invalid('collectedOn', 'week_change_not_allowed'));
    await expect(
      amendCollection(ctx(f.leadA), item.id, { collectedOn: '2026-11-06' }),
    ).rejects.toMatchObject(invalid('collectedOn', 'future_date'));
  });

  it('refuses voided collections, reports under review or approved, and closed branches', async () => {
    const item = await createCollection(ctx(f.leadA), input());
    await voidCollection(ctx(f.leadA), item.id, { reason: 'Wrong branch' });
    await expect(
      amendCollection(ctx(f.leadA), item.id, { purpose: 'Changed' }),
    ).rejects.toMatchObject(conflict('collection_voided'));

    const submitted = await seedReport(db, {
      branchId: f.a.id,
      weekStart: '2026-10-26',
      status: 'submitted',
      submittedBy: f.leadA.userId,
      collections: [{ amount: '50', collectedOn: '2026-10-30', createdBy: f.leadA.userId }],
    });
    const approved = await seedReport(db, {
      branchId: f.a.id,
      weekStart: '2026-10-19',
      status: 'approved',
      submittedBy: f.leadA.userId,
      reviewedBy: f.finance.userId,
      collections: [{ amount: '60', createdBy: f.leadA.userId }],
    });
    for (const id of [submitted.collectionIds[0]!, approved.collectionIds[0]!]) {
      await expect(amendCollection(ctx(f.leadA), id, { purpose: 'Changed' })).rejects.toMatchObject(
        conflict('report_not_open'),
      );
      await expect(voidCollection(ctx(f.leadA), id, { reason: 'Changed' })).rejects.toMatchObject(
        conflict('report_not_open'),
      );
    }
    expect(
      (await getCollection(db, f.leadA, clock(), submitted.collectionIds[0]!)).editability,
    ).toBe('report_submitted');

    const closed = await seedReport(db, {
      branchId: f.c.id,
      weekStart: '2026-11-02',
      collections: [{ amount: '70', collectedOn: '2026-11-03', createdBy: f.leadC.userId }],
    });
    await expect(
      amendCollection(ctx(f.leadC), closed.collectionIds[0]!, { purpose: 'Changed' }),
    ).rejects.toMatchObject(conflict('branch_closed'));
    await expect(
      voidCollection(ctx(f.leadC), closed.collectionIds[0]!, { reason: 'Changed' }),
    ).rejects.toMatchObject(conflict('branch_closed'));
  });

  it('lets a paused branch amend a draft collection inside the window', async () => {
    const paused = await seedReport(db, {
      branchId: f.p.id,
      weekStart: '2026-11-02',
      collections: [{ amount: '80', collectedOn: '2026-11-03', createdBy: f.leadP.userId }],
    });
    const amended = await amendCollection(ctx(f.leadP), paused.collectionIds[0]!, {
      amount: '85',
    });
    expect(amended).toMatchObject({
      amount: '85.00',
      branchStatus: 'paused',
      editability: 'editable',
    });
  });
});

describe('voidCollection', () => {
  it('needs a reason, keeps the row visible and records who and when', async () => {
    const item = await createCollection(ctx(f.leadA), input());
    await expect(voidCollection(ctx(f.leadA), item.id, { reason: '  ' })).rejects.toMatchObject(
      invalid('reason', 'too_short'),
    );
    const voided = await voidCollection(ctx(f.leadA), item.id, { reason: '  Duplicate  ' });
    expect(voided).toMatchObject({
      status: 'voided',
      voidReason: 'Duplicate',
      voidedAt: '2026-11-04T06:00:00.000Z',
      editability: 'voided',
    });
    const row = await db.query<{ voided_by: string; status: string }>(
      'SELECT voided_by, status FROM collections WHERE id = $1',
      [item.id],
    );
    expect(row.rows[0]).toEqual({ voided_by: f.leadA.userId, status: 'voided' });
    const last = (await audits()).at(-1)!;
    expect(last).toMatchObject({
      action: 'collection.void',
      entity_id: item.id,
      branch_id: f.a.id,
      report_id: item.reportId,
      before: { status: 'active' },
      after: { status: 'voided', void_reason: 'Duplicate' },
    });
    const listed = await listCollections(db, f.leadA, clock(), { limit: 100 });
    expect(listed.items.map((i) => [i.id, i.voidReason])).toEqual([[item.id, 'Duplicate']]);
    await expect(voidCollection(ctx(f.leadA), item.id, { reason: 'Again' })).rejects.toMatchObject(
      conflict('collection_voided'),
    );
  });

  it('offers no delete', () => {
    expect(Object.keys(collections).filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});

describe('getCurrentWeek', () => {
  it('reports the current PKT week for the lead and creates nothing', async () => {
    const empty = await getCurrentWeek(db, f.leadA, clock());
    expect(empty).toEqual({
      weekStart: '2026-11-02',
      weekEnd: '2026-11-08',
      today: '2026-11-04',
      reportId: null,
      reportStatus: null,
      activeTotal: '0.00',
      activeCount: 0,
      branchStatus: 'active',
    });
    expect(await count('weekly_reports')).toBe(0);

    const one = await createCollection(ctx(f.leadA), input({ amount: '100.25' }));
    const two = await createCollection(ctx(f.leadA), input({ amount: '50' }));
    await createCollection(ctx(f.leadA), input({ amount: '7', collectedOn: '2026-10-30' }));
    await voidCollection(ctx(f.leadA), two.id, { reason: 'Mistake' });
    expect(await getCurrentWeek(db, f.leadA, clock())).toMatchObject({
      reportId: one.reportId,
      reportStatus: 'draft',
      activeTotal: '100.25',
      activeCount: 1,
    });
  });
});
