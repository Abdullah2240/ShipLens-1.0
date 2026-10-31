import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { seedCollection, seedReport } from '../support/finance-fixtures';

const WEEK = '2026-10-19';

let branchId: string;
let lead: string;
let finance: string;

beforeEach(async () => {
  await resetDb();
  branchId = (await seedBranch(testPool())).id;
  lead = (await seedUser(testPool(), { role: 'branch_lead', branchId })).id;
  finance = (await seedUser(testPool(), { role: 'finance_reviewer' })).id;
});

afterAll(async () => {
  await closeTestPool();
});

function threeCollections() {
  return [
    { amount: '100.10', createdBy: lead },
    { amount: '0.20', collectedOn: '2026-10-25', purpose: 'Food', createdBy: lead },
    { amount: '50.00', status: 'voided' as const, createdBy: lead },
  ];
}

async function reportRow(id: string) {
  const { rows } = await testPool().query(
    `SELECT status, total_amount, collection_count, submitted_at, submitted_by, reviewed_at, reviewed_by,
            return_reason, version
       FROM weekly_reports WHERE id = $1`,
    [id],
  );
  return rows[0];
}

async function collectionRows(reportId: string) {
  const { rows } = await testPool().query(
    `SELECT id, amount, collected_on, purpose, status, void_reason, voided_at, voided_by, routed_at, routed_by
       FROM collections WHERE report_id = $1 ORDER BY created_at, id`,
    [reportId],
  );
  return rows;
}

async function countSideEffects() {
  const { rows } = await testPool().query(
    'SELECT (SELECT count(*) FROM audit_events)::int AS audit, (SELECT count(*) FROM report_events)::int AS events',
  );
  return rows[0];
}

describe('seedReport', () => {
  it('builds a draft with active and voided collections and returns the live totals', async () => {
    const result = await seedReport(testPool(), {
      branchId,
      weekStart: WEEK,
      collections: threeCollections(),
    });
    expect(result.collectionIds).toHaveLength(3);
    expect(result.total).toBe('100.30');
    expect(result.count).toBe(2);

    const report = await reportRow(result.reportId);
    expect(report).toMatchObject({
      status: 'draft',
      total_amount: null,
      collection_count: null,
      version: 0,
    });

    const rows = await collectionRows(result.reportId);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(result.collectionIds[0])).toMatchObject({
      amount: '100.10',
      collected_on: WEEK,
      purpose: 'Fixture purpose',
      status: 'active',
    });
    expect(byId.get(result.collectionIds[1])).toMatchObject({
      collected_on: '2026-10-25',
      purpose: 'Food',
    });
    const voided = byId.get(result.collectionIds[2]);
    expect(voided).toMatchObject({
      status: 'voided',
      void_reason: 'Fixture void',
      voided_by: lead,
    });
    expect(voided.voided_at).toBeInstanceOf(Date);
  });

  it('builds an empty draft by default', async () => {
    const result = await seedReport(testPool(), { branchId, weekStart: WEEK });
    expect(result).toMatchObject({ collectionIds: [], total: '0.00', count: 0 });
    expect((await reportRow(result.reportId)).status).toBe('draft');
  });

  it('builds a submitted report with frozen totals', async () => {
    const result = await seedReport(testPool(), {
      branchId,
      weekStart: WEEK,
      status: 'submitted',
      submittedBy: lead,
      collections: threeCollections(),
    });
    const report = await reportRow(result.reportId);
    expect(report).toMatchObject({
      status: 'submitted',
      total_amount: '100.30',
      collection_count: 2,
      submitted_by: lead,
      reviewed_by: null,
      version: 1,
    });
    expect(report.submitted_at).toBeInstanceOf(Date);
  });

  it('builds a returned report with a default return reason', async () => {
    const result = await seedReport(testPool(), {
      branchId,
      weekStart: WEEK,
      status: 'returned',
      submittedBy: lead,
      reviewedBy: finance,
      collections: threeCollections(),
    });
    const report = await reportRow(result.reportId);
    expect(report).toMatchObject({
      status: 'returned',
      return_reason: 'Fixture return',
      reviewed_by: finance,
      submitted_by: lead,
      total_amount: '100.30',
    });
    expect(report.reviewed_at).toBeInstanceOf(Date);

    const custom = await seedReport(testPool(), {
      branchId,
      weekStart: '2026-10-26',
      status: 'returned',
      submittedBy: lead,
      reviewedBy: finance,
      returnReason: 'Missing receipt',
    });
    expect((await reportRow(custom.reportId)).return_reason).toBe('Missing receipt');
  });

  it('builds an approved report with routed collections marked after approval', async () => {
    const routedAt = '2026-10-27T05:00:00.000Z';
    const result = await seedReport(testPool(), {
      branchId,
      weekStart: WEEK,
      status: 'approved',
      submittedBy: lead,
      reviewedBy: finance,
      collections: [
        { amount: '10.00', createdBy: lead, routedAt },
        { amount: '20.00', createdBy: lead },
        { amount: '5.00', createdBy: lead, status: 'voided' },
      ],
    });
    expect(result).toMatchObject({ total: '30.00', count: 2 });
    const report = await reportRow(result.reportId);
    expect(report).toMatchObject({
      status: 'approved',
      reviewed_by: finance,
      total_amount: '30.00',
      collection_count: 2,
      version: 2,
    });

    const rows = new Map((await collectionRows(result.reportId)).map((r) => [r.id, r]));
    const routed = rows.get(result.collectionIds[0]);
    expect(routed.routed_at.toISOString()).toBe(routedAt);
    expect(routed.routed_by).toBe(finance);
    expect(rows.get(result.collectionIds[1]).routed_at).toBeNull();
  });

  it('refuses routedAt on a report that will not be approved, before touching the database', async () => {
    await expect(
      seedReport(testPool(), {
        branchId,
        weekStart: WEEK,
        status: 'submitted',
        submittedBy: lead,
        collections: [{ amount: '1.00', createdBy: lead, routedAt: '2026-10-27T05:00:00Z' }],
      }),
    ).rejects.toThrow(/routedAt/);
    const { rows } = await testPool().query('SELECT count(*)::int AS n FROM weekly_reports');
    expect(rows[0].n).toBe(0);
  });

  it('requires submittedBy for non-draft and reviewedBy for returned or approved', async () => {
    await expect(
      seedReport(testPool(), { branchId, weekStart: WEEK, status: 'submitted' }),
    ).rejects.toThrow(/submittedBy/);
    await expect(
      seedReport(testPool(), { branchId, weekStart: WEEK, status: 'returned', submittedBy: lead }),
    ).rejects.toThrow(/reviewedBy/);
    await expect(
      seedReport(testPool(), { branchId, weekStart: WEEK, status: 'approved', submittedBy: lead }),
    ).rejects.toThrow(/reviewedBy/);
    const { rows } = await testPool().query('SELECT count(*)::int AS n FROM weekly_reports');
    expect(rows[0].n).toBe(0);
  });

  it('rolls back the whole report when a step fails', async () => {
    await expect(
      seedReport(testPool(), {
        branchId,
        weekStart: WEEK,
        collections: [{ amount: '1.00', collectedOn: '2026-10-26', createdBy: lead }],
      }),
    ).rejects.toMatchObject({ code: 'P0001' });
    const { rows } = await testPool().query('SELECT count(*)::int AS n FROM weekly_reports');
    expect(rows[0].n).toBe(0);
  });

  it('writes no audit_events and no report_events', async () => {
    await seedReport(testPool(), {
      branchId,
      weekStart: WEEK,
      status: 'approved',
      submittedBy: lead,
      reviewedBy: finance,
      collections: threeCollections(),
    });
    const draft = await seedReport(testPool(), { branchId, weekStart: '2026-10-26' });
    await seedCollection(testPool(), {
      branchId,
      reportId: draft.reportId,
      amount: '3.00',
      createdBy: lead,
    });
    expect(await countSideEffects()).toEqual({ audit: 0, events: 0 });
  });
});

describe('seedCollection', () => {
  it("inserts into a draft report, defaulting collectedOn to the report's week_start", async () => {
    const { reportId } = await seedReport(testPool(), { branchId, weekStart: WEEK });
    const id = await seedCollection(testPool(), {
      branchId,
      reportId,
      amount: '12.34',
      createdBy: lead,
    });
    const { rows } = await testPool().query(
      'SELECT amount, collected_on, purpose, status FROM collections WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({
      amount: '12.34',
      collected_on: WEEK,
      purpose: 'Fixture purpose',
      status: 'active',
    });
  });

  it('inserts into a returned report and supports voided collections', async () => {
    const { reportId } = await seedReport(testPool(), {
      branchId,
      weekStart: WEEK,
      status: 'returned',
      submittedBy: lead,
      reviewedBy: finance,
    });
    const id = await seedCollection(testPool(), {
      branchId,
      reportId,
      amount: '7.00',
      collectedOn: '2026-10-22',
      status: 'voided',
      createdBy: lead,
    });
    const { rows } = await testPool().query(
      'SELECT status, void_reason, voided_by FROM collections WHERE id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ status: 'voided', void_reason: 'Fixture void', voided_by: lead });
  });

  it('rejects with the guard error for a submitted report', async () => {
    const { reportId } = await seedReport(testPool(), {
      branchId,
      weekStart: WEEK,
      status: 'submitted',
      submittedBy: lead,
    });
    await expect(
      seedCollection(testPool(), { branchId, reportId, amount: '1.00', createdBy: lead }),
    ).rejects.toMatchObject({
      code: 'P0001',
      message: expect.stringMatching(/^finance_guard:/),
    });
  });
});
