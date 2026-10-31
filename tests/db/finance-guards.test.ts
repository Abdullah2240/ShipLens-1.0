import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';

type PgError = { code?: string; message?: string };

const WEEK = '2026-10-19';
const NEXT_WEEK = '2026-10-26';

/** Assert that a statement was rejected by one of the finance guard triggers. */
async function expectGuard(promise: Promise<unknown>): Promise<PgError> {
  let caught: PgError | undefined;
  try {
    await promise;
  } catch (err) {
    caught = err as PgError;
  }
  expect(caught, 'expected the statement to be rejected').toBeDefined();
  expect(caught?.code).toBe('P0001');
  expect(caught?.message).toMatch(/^finance_guard:/);
  return caught!;
}

function q(sql: string, params: unknown[] = []) {
  return testPool().query(sql, params);
}

let branchA: string;
let branchB: string;
let leadA: string;
let leadB: string;
let finance: string;

beforeEach(async () => {
  await resetDb();
  branchA = (await seedBranch(testPool())).id;
  branchB = (await seedBranch(testPool())).id;
  leadA = (await seedUser(testPool(), { role: 'branch_lead', branchId: branchA })).id;
  leadB = (await seedUser(testPool(), { role: 'branch_lead', branchId: branchB })).id;
  finance = (await seedUser(testPool(), { role: 'finance_reviewer' })).id;
});

afterAll(async () => {
  await closeTestPool();
});

async function insertReport(branchId = branchA, weekStart = WEEK): Promise<string> {
  const { rows } = await q('INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, $2) RETURNING id', [
    branchId,
    weekStart,
  ]);
  return rows[0].id as string;
}

function setStatus(reportId: string, status: string) {
  return q('UPDATE weekly_reports SET status = $2, updated_at = now() WHERE id = $1', [reportId, status]);
}

async function moveTo(reportId: string, path: string[]): Promise<void> {
  for (const status of path) await setStatus(reportId, status);
}

function insertCollection(
  reportId: string,
  opts: { branchId?: string; collectedOn?: string; amount?: string; routedAt?: string | null; createdBy?: string } = {},
) {
  return q(
    `INSERT INTO collections (branch_id, report_id, amount, collected_on, purpose, created_by, routed_at)
     VALUES ($1, $2, $3, $4, 'Guard purpose', $5, $6) RETURNING id`,
    [
      opts.branchId ?? branchA,
      reportId,
      opts.amount ?? '100.00',
      opts.collectedOn ?? WEEK,
      opts.createdBy ?? leadA,
      opts.routedAt ?? null,
    ],
  ).then((r) => r.rows[0].id as string);
}

function voidCollection(id: string) {
  return q(
    "UPDATE collections SET status = 'voided', void_reason = 'Mistake', voided_at = now(), voided_by = $2 WHERE id = $1",
    [id, leadA],
  );
}

describe('weekly_reports transitions', () => {
  it('allows draft->submitted, submitted->returned, returned->submitted, submitted->approved', async () => {
    const id = await insertReport();
    await expect(moveTo(id, ['submitted', 'returned', 'submitted', 'approved'])).resolves.toBeUndefined();
    const { rows } = await q('SELECT status FROM weekly_reports WHERE id = $1', [id]);
    expect(rows[0].status).toBe('approved');
  });

  it('rejects draft->approved and draft->returned', async () => {
    const id = await insertReport();
    const err = await expectGuard(setStatus(id, 'approved'));
    expect(err.message).toContain('invalid report transition');
    await expectGuard(setStatus(id, 'returned'));
  });

  it('rejects returned->approved', async () => {
    const id = await insertReport();
    await moveTo(id, ['submitted', 'returned']);
    await expectGuard(setStatus(id, 'approved'));
  });

  it('rejects submitted->draft', async () => {
    const id = await insertReport();
    await setStatus(id, 'submitted');
    await expectGuard(setStatus(id, 'draft'));
  });

  it('rejects returned->draft', async () => {
    const id = await insertReport();
    await moveTo(id, ['submitted', 'returned']);
    await expectGuard(setStatus(id, 'draft'));
  });

  it('rejects every move out of approved', async () => {
    const id = await insertReport();
    await moveTo(id, ['submitted', 'approved']);
    for (const status of ['draft', 'submitted', 'returned']) {
      const err = await expectGuard(setStatus(id, status));
      expect(err.message).toContain('approved report is locked');
    }
  });

  it('rejects any update of an approved report, even updated_at or total_amount alone', async () => {
    const id = await insertReport();
    await moveTo(id, ['submitted', 'approved']);
    await expectGuard(q('UPDATE weekly_reports SET updated_at = now() WHERE id = $1', [id]));
    await expectGuard(q("UPDATE weekly_reports SET total_amount = '1.00' WHERE id = $1", [id]));
    await expectGuard(q("UPDATE weekly_reports SET status = 'approved' WHERE id = $1", [id]));
  });

  it('allows other column updates on non-approved reports', async () => {
    const id = await insertReport();
    await q(
      "UPDATE weekly_reports SET status = 'submitted', total_amount = '0.00', collection_count = 0, submitted_at = now(), submitted_by = $2, version = version + 1 WHERE id = $1",
      [id, leadA],
    );
    await expect(
      q("UPDATE weekly_reports SET return_reason = 'x', reviewed_by = $2, reviewed_at = now(), status = 'returned' WHERE id = $1", [
        id,
        finance,
      ]),
    ).resolves.toBeDefined();
  });

  it('rejects changing branch_id or week_start', async () => {
    const id = await insertReport();
    await expectGuard(q('UPDATE weekly_reports SET branch_id = $2 WHERE id = $1', [id, branchB]));
    await expectGuard(q('UPDATE weekly_reports SET week_start = $2 WHERE id = $1', [id, NEXT_WEEK]));
  });

  it('rejects DELETE of a report in every status', async () => {
    const draft = await insertReport(branchA, WEEK);
    const submitted = await insertReport(branchA, NEXT_WEEK);
    await setStatus(submitted, 'submitted');
    const returned = await insertReport(branchB, WEEK);
    await moveTo(returned, ['submitted', 'returned']);
    const approved = await insertReport(branchB, NEXT_WEEK);
    await moveTo(approved, ['submitted', 'approved']);
    for (const id of [draft, submitted, returned, approved]) {
      const err = await expectGuard(q('DELETE FROM weekly_reports WHERE id = $1', [id]));
      expect(err.message).toContain('never deleted');
    }
  });
});

describe('collections insert guard', () => {
  it('accepts an insert into a draft report of the same branch and week', async () => {
    const id = await insertReport();
    await expect(insertCollection(id, { collectedOn: '2026-10-21' })).resolves.toBeTruthy();
  });

  it('accepts an insert into a returned report', async () => {
    const id = await insertReport();
    await moveTo(id, ['submitted', 'returned']);
    await expect(insertCollection(id)).resolves.toBeTruthy();
  });

  it('rejects an insert into a submitted or approved report', async () => {
    const submitted = await insertReport(branchA, WEEK);
    await setStatus(submitted, 'submitted');
    await expectGuard(insertCollection(submitted));

    const approved = await insertReport(branchA, NEXT_WEEK);
    await moveTo(approved, ['submitted', 'approved']);
    await expectGuard(insertCollection(approved, { collectedOn: NEXT_WEEK }));
  });

  it("rejects a branch_id different from the report's", async () => {
    const id = await insertReport(branchA);
    await expectGuard(insertCollection(id, { branchId: branchB, createdBy: leadB }));
  });

  it('enforces the week boundary: Sunday is inside, the next Monday is outside', async () => {
    const id = await insertReport();
    await expect(insertCollection(id, { collectedOn: '2026-10-25' })).resolves.toBeTruthy();
    await expectGuard(insertCollection(id, { collectedOn: NEXT_WEEK }));
    await expectGuard(insertCollection(id, { collectedOn: '2026-10-18' }));
  });

  it('rejects a non-null routed_at on insert', async () => {
    const id = await insertReport();
    await expectGuard(insertCollection(id, { routedAt: '2026-10-20T10:00:00Z' }));
  });
});

describe('collections update guard', () => {
  it('allows amount, purpose, note and collected_on (same week) changes in a draft report', async () => {
    const report = await insertReport();
    const id = await insertCollection(report);
    await expect(
      q(
        "UPDATE collections SET amount = '250.50', purpose = 'Changed', note = 'n', collected_on = '2026-10-25', updated_at = now() WHERE id = $1",
        [id],
      ),
    ).resolves.toBeDefined();
  });

  it('rejects moving collected_on into the next week', async () => {
    const report = await insertReport();
    const id = await insertCollection(report);
    await expectGuard(q('UPDATE collections SET collected_on = $2 WHERE id = $1', [id, NEXT_WEEK]));
  });

  it('rejects voided -> active', async () => {
    const report = await insertReport();
    const id = await insertCollection(report);
    await voidCollection(id);
    await expectGuard(q("UPDATE collections SET status = 'active' WHERE id = $1", [id]));
  });

  it('rejects changes to report_id, branch_id and created_by', async () => {
    const report = await insertReport(branchA, WEEK);
    const other = await insertReport(branchA, NEXT_WEEK);
    const otherBranchReport = await insertReport(branchB, WEEK);
    const id = await insertCollection(report);
    await expectGuard(q('UPDATE collections SET report_id = $2 WHERE id = $1', [id, other]));
    await expectGuard(
      q('UPDATE collections SET branch_id = $2, report_id = $3 WHERE id = $1', [id, branchB, otherBranchReport]),
    );
    await expectGuard(q('UPDATE collections SET created_by = $2 WHERE id = $1', [id, leadB]));
    await expectGuard(q("UPDATE collections SET created_at = now() - interval '1 day' WHERE id = $1", [id]));
  });

  it('in a submitted report rejects amount, purpose, note and status changes but allows updated_at', async () => {
    const report = await insertReport();
    const id = await insertCollection(report);
    await setStatus(report, 'submitted');
    await expectGuard(q("UPDATE collections SET amount = '1.00' WHERE id = $1", [id]));
    await expectGuard(q("UPDATE collections SET purpose = 'x' WHERE id = $1", [id]));
    await expectGuard(q("UPDATE collections SET note = 'x' WHERE id = $1", [id]));
    await expectGuard(voidCollection(id));
    await expect(q('UPDATE collections SET updated_at = now() WHERE id = $1', [id])).resolves.toBeDefined();
  });

  it('in an approved report allows routed marking on active collections only', async () => {
    const report = await insertReport();
    const active = await insertCollection(report);
    const voided = await insertCollection(report, { amount: '5.00' });
    await voidCollection(voided);
    await moveTo(report, ['submitted', 'approved']);

    await expect(
      q('UPDATE collections SET routed_at = now(), routed_by = $2, updated_at = now() WHERE id = $1', [active, finance]),
    ).resolves.toBeDefined();
    await expect(
      q('UPDATE collections SET routed_at = NULL, routed_by = NULL, updated_at = now() WHERE id = $1', [active]),
    ).resolves.toBeDefined();

    await expectGuard(q('UPDATE collections SET routed_at = now(), routed_by = $2 WHERE id = $1', [voided, finance]));
    await expectGuard(q("UPDATE collections SET amount = '9.00' WHERE id = $1", [active]));
  });

  it('rejects routed_at while the report is draft', async () => {
    const report = await insertReport();
    const id = await insertCollection(report);
    const err = await expectGuard(
      q('UPDATE collections SET routed_at = now(), routed_by = $2 WHERE id = $1', [id, finance]),
    );
    expect(err.message).toContain('routed');
  });

  it('rejects DELETE of a collection in every report state', async () => {
    const report = await insertReport();
    const id = await insertCollection(report);
    await expectGuard(q('DELETE FROM collections WHERE id = $1', [id]));
    await setStatus(report, 'submitted');
    await expectGuard(q('DELETE FROM collections WHERE id = $1', [id]));
    await setStatus(report, 'returned');
    await expectGuard(q('DELETE FROM collections WHERE id = $1', [id]));
    await setStatus(report, 'submitted');
    await setStatus(report, 'approved');
    await expectGuard(q('DELETE FROM collections WHERE id = $1', [id]));
  });
});

describe('harness and indexes', () => {
  it('resetDb still empties weekly_reports and collections', async () => {
    const report = await insertReport();
    await insertCollection(report);
    await moveTo(report, ['submitted', 'approved']);
    await resetDb();
    const { rows } = await q(
      'SELECT (SELECT count(*) FROM weekly_reports)::int AS reports, (SELECT count(*) FROM collections)::int AS collections',
    );
    expect(rows[0]).toEqual({ reports: 0, collections: 0 });
  });

  it('has the status and report indexes', async () => {
    const { rows } = await q(
      "SELECT indexname FROM pg_indexes WHERE indexname IN ('weekly_reports_status_submitted_idx', 'collections_report_status_idx') ORDER BY indexname",
    );
    expect(rows.map((r) => r.indexname)).toEqual(['collections_report_status_idx', 'weekly_reports_status_submitted_idx']);
  });
});
