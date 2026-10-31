// Acceptance gate (TEST-05, DASH-05, DASH-02): the real seed loads the demo dataset into an
// empty lane database, and every dashboard figure equals db/seed/expected.json exactly.
// Expected values come only from that file; nothing here recomputes them with app code.
// No service that creates lazy drafts runs before the assertions.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getDashboardSummary,
  getMonthlyTrend,
  listUnrouted,
  type DashboardSummary,
  type MoneyFigureId,
  type TrendMonth,
} from '@/modules/reporting';
import { getBranchReports, getFigureByBranch } from '@/modules/reporting/service-trace';
import type { Actor } from '@/platform/authz';
import { fixedClock } from '@/platform/time';
import { closeTestPool, testPool } from '../support/db';
import {
  MONEY_FIGURE_IDS,
  Reconciler,
  loadExpected,
  type FigureExpect,
  type FigureSet,
} from './expected';
import { demoActor, seedDemoDatabase } from './seed-demo';

const db = testPool();
const expected = loadExpected();
// A day after the data ends, so the trend also has one month with no data.
const clock = fixedClock('2026-11-01T06:00:00.000Z');

const TREND_KEY: Record<MoneyFigureId, keyof Omit<TrendMonth, 'month'>> = {
  collected: 'collected',
  approved: 'approved',
  pending_approval: 'pendingApproval',
  in_progress: 'inProgress',
  not_yet_routed: 'notYetRouted',
  routed: 'routed',
};

let admin: Actor;
let finance: Actor;

beforeAll(async () => {
  await seedDemoDatabase();
  admin = await demoActor('admin@shiplens.test');
  finance = await demoActor('finance@shiplens.test');
}, 120_000);

afterAll(async () => {
  await closeTestPool();
});

function expectReconciled(r: Reconciler): void {
  expect(r.rows.length).toBeGreaterThan(0);
  expect(r.mismatches(), r.report()).toEqual([]);
}

function summaryFigure(s: DashboardSummary, id: MoneyFigureId) {
  return { amount: s.figures[id].value, count: s.figures[id].recordCount };
}

const ZERO: FigureExpect = { amount: '0.00', count: 0 };
const isZero = (v: FigureExpect) => v.amount === '0.00' && v.count === 0;

/** Non-zero entries only, keyed by name. */
function nonZero(entries: Iterable<[string, FigureExpect]>): Map<string, FigureExpect> {
  return new Map([...entries].filter(([, v]) => !isZero(v)));
}

function compareMaps(
  r: Reconciler,
  label: string,
  want: Map<string, FigureExpect>,
  got: Map<string, FigureExpect>,
): void {
  const keys = [...new Set([...want.keys(), ...got.keys()])].sort();
  for (const key of keys) r.figure(`${label} ${key}`, want.get(key) ?? ZERO, got.get(key) ?? ZERO);
}

describe('dashboard summary, no filters', () => {
  it('every money KPI equals the oracle in amount and record count', async () => {
    const s = await getDashboardSummary(db, admin, {});
    const r = new Reconciler();
    for (const id of MONEY_FIGURE_IDS) r.figure(id, expected.kpis[id], summaryFigure(s, id));
    r.check('active_branches', expected.kpis.active_branches, s.figures.active_branches.value);
    r.check(
      'active_branches count',
      expected.kpis.active_branches,
      s.figures.active_branches.recordCount,
    );
    r.check(
      'reports_awaiting_review',
      expected.kpis.reports_awaiting_review,
      s.figures.reports_awaiting_review.value,
    );
    r.check(
      'reports_awaiting_review count',
      expected.kpis.reports_awaiting_review,
      s.figures.reports_awaiting_review.recordCount,
    );
    expectReconciled(r);
  });

  it('both identities hold on the real data', async () => {
    const s = await getDashboardSummary(db, admin, {});
    expect(s.identities).toEqual({ collected: true, approved: true });
  });

  it('Finance sees the same figures as the super admin', async () => {
    const a = await getDashboardSummary(db, admin, {});
    const f = await getDashboardSummary(db, finance, {});
    expect(f.figures).toEqual(a.figures);
  });
});

describe('months', () => {
  it('the monthly trend equals expected.byMonth, and months without data are zero', async () => {
    const trend = await getMonthlyTrend(db, admin, {}, clock);
    const r = new Reconciler();
    const seen = new Set<string>();
    for (const m of trend.months) {
      seen.add(m.month);
      const want: FigureSet = expected.byMonth.get(m.month) ?? {};
      for (const id of MONEY_FIGURE_IDS) {
        r.check(`trend ${m.month} ${id}`, (want[id] ?? ZERO).amount, m[TREND_KEY[id]]);
      }
    }
    for (const month of expected.byMonth.keys())
      r.check(`trend has ${month}`, true, seen.has(month));
    // the gap-filled range runs to the clock's month, which has no data
    r.check('trend has 2026-11', true, seen.has('2026-11'));
    for (const id of MONEY_FIGURE_IDS) {
      r.check(`trend total ${id}`, expected.kpis[id].amount, trend.totals[TREND_KEY[id]]);
    }
    expectReconciled(r);
  });

  it('the summary filtered to each month equals that month in amount and count', async () => {
    const r = new Reconciler();
    for (const [month, want] of expected.byMonth) {
      const s = await getDashboardSummary(db, admin, { from: month, to: month });
      for (const id of MONEY_FIGURE_IDS) {
        r.figure(`${month} ${id}`, want[id] ?? ZERO, summaryFigure(s, id));
      }
      expect(s.identities, month).toEqual({ collected: true, approved: true });
    }
    expectReconciled(r);
  });
});

describe('branches', () => {
  it('every money figure split by branch equals expected.byBranch (zero entries dropped)', async () => {
    const r = new Reconciler();
    for (const id of MONEY_FIGURE_IDS) {
      const level = await getFigureByBranch(db, admin, id, {});
      const got = nonZero(
        level.rows.map((row) => [row.branchName, { amount: row.value, count: row.recordCount }]),
      );
      const want = nonZero(
        [...expected.byBranch].map(
          ([name, set]) => [name, set[id] ?? ZERO] as [string, FigureExpect],
        ),
      );
      // L1 lists contributing branches only, so it never shows a zero row
      r.check(`${id} L1 rows without value`, 0, level.rows.length - got.size);
      compareMaps(r, id, want, got);
    }
    expectReconciled(r);
  });

  it('every oracle branch exists in the database', async () => {
    const { rows } = await db.query<{ name: string }>('SELECT name FROM branches');
    const names = new Set(rows.map((b) => b.name));
    for (const name of expected.byBranch.keys()) expect(names.has(name), name).toBe(true);
  });
});

describe('approved reports', () => {
  it('the approved reports across every branch equal expected.approvedReports', async () => {
    const l1 = await getFigureByBranch(db, admin, 'approved', {});
    const got = new Map<
      string,
      { branch: string; weekStart: string; amount: string; count: number }
    >();
    for (const branch of l1.rows) {
      const l2 = await getBranchReports(db, admin, 'approved', branch.branchId, {});
      for (const row of l2.rows) {
        expect(got.has(row.reportId), `report ${row.reportId} listed twice`).toBe(false);
        expect(row.status, row.reportId).toBe('approved');
        got.set(row.reportId, {
          branch: branch.branchName,
          weekStart: row.weekStart,
          amount: row.value,
          count: row.recordCount,
        });
      }
    }

    const r = new Reconciler();
    const nil = expected.approvedReports.filter((e) => e.amount === '0.00');
    // nil reports carry 0.00 / 0 in the oracle and contribute no row at L2
    for (const e of nil) {
      r.check(`nil report ${e.reportId} count`, 0, e.count);
      r.check(`nil report ${e.reportId} absent from L2`, false, got.has(e.reportId));
    }
    const contributing = expected.approvedReports.filter((e) => e.amount !== '0.00');
    r.check('approved reports at L2', contributing.length, got.size);
    for (const e of contributing) {
      const row = got.get(e.reportId);
      r.check(`${e.reportId} branch`, e.branch, row?.branch);
      r.check(`${e.reportId} weekStart`, e.weekStart, row?.weekStart);
      r.check(`${e.reportId} amount`, e.amount, row?.amount);
      r.check(`${e.reportId} count`, e.count, row?.count);
    }
    expectReconciled(r);
  });

  it('every approved report in the oracle is approved in the database, nil ones included', async () => {
    const { rows } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM weekly_reports WHERE id = ANY($1::uuid[])`,
      [expected.approvedReports.map((e) => e.reportId)],
    );
    expect(rows).toHaveLength(expected.approvedReports.length);
    for (const row of rows) expect(row.status, row.id).toBe('approved');
  });
});

describe('unrouted list', () => {
  it('total and total amount equal kpis.not_yet_routed', async () => {
    const page = await listUnrouted(db, finance, { pageSize: 200 }, clock);
    const r = new Reconciler();
    r.check('unrouted total', expected.kpis.not_yet_routed.count, page.total);
    r.check('unrouted totalAmount', expected.kpis.not_yet_routed.amount, page.totalAmount);
    r.check('unrouted rows on one page', expected.kpis.not_yet_routed.count, page.items.length);
    expectReconciled(r);
  });
});

describe('integrity on the loaded rows (read-only SQL)', () => {
  it('frozen totals equal live totals for every submitted and approved report', async () => {
    const { rows } = await db.query<{
      id: string;
      status: string;
      total_amount: string | null;
      collection_count: number | null;
      live_amount: string;
      live_count: number;
    }>(
      `SELECT r.id, r.status, r.total_amount::text AS total_amount, r.collection_count,
              COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'active'), 0)::numeric(14,2)::text AS live_amount,
              (COUNT(c.id) FILTER (WHERE c.status = 'active'))::int AS live_count
         FROM weekly_reports r LEFT JOIN collections c ON c.report_id = r.id
        WHERE r.status IN ('submitted', 'approved')
        GROUP BY r.id ORDER BY r.id`,
    );
    const wantReports =
      (expected.reportsByStatus.submitted ?? 0) + (expected.reportsByStatus.approved ?? 0);
    expect(rows).toHaveLength(wantReports);
    const r = new Reconciler();
    for (const row of rows) {
      r.check(`${row.status} ${row.id} frozen amount`, row.live_amount, row.total_amount);
      r.check(`${row.status} ${row.id} frozen count`, row.live_count, row.collection_count);
    }
    expectReconciled(r);
  });

  it("every collection belongs to its report's branch", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM collections c JOIN weekly_reports r ON r.id = c.report_id
        WHERE c.branch_id <> r.branch_id`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('voided collections equal expected.voided', async () => {
    const { rows } = await db.query<{ amount: string; count: number }>(
      `SELECT COALESCE(SUM(amount), 0)::numeric(14,2)::text AS amount, count(*)::int AS count
         FROM collections WHERE status = 'voided'`,
    );
    const r = new Reconciler();
    r.figure('voided', expected.voided, rows[0]!);
    expectReconciled(r);
  });

  it('report counts per status equal expected.reportsByStatus (draft excluded)', async () => {
    const { rows } = await db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM weekly_reports GROUP BY status`,
    );
    const got = new Map(rows.map((row) => [row.status, row.n]));
    const r = new Reconciler();
    for (const [status, n] of Object.entries(expected.reportsByStatus)) {
      r.check(`reports ${status}`, n, got.get(status) ?? 0);
    }
    expectReconciled(r);
  });
});

describe('exclusion on the real data', () => {
  it('approved is exactly the active collections of approved reports', async () => {
    const s = await getDashboardSummary(db, admin, {});
    const { rows } = await db.query<{ amount: string; count: number }>(
      `SELECT COALESCE(SUM(c.amount), 0)::numeric(14,2)::text AS amount, count(*)::int AS count
         FROM collections c JOIN weekly_reports r ON r.id = c.report_id
        WHERE c.status = 'active' AND r.status = 'approved'`,
    );
    const r = new Reconciler();
    r.figure('approved vs SQL', rows[0]!, summaryFigure(s, 'approved'));
    r.figure('SQL vs oracle', expected.kpis.approved, rows[0]!);
    expectReconciled(r);
  });

  it('draft, submitted and returned money never reaches approved', async () => {
    const s = await getDashboardSummary(db, admin, {});
    const { rows } = await db.query<{ status: string; amount: string; count: number }>(
      `SELECT r.status, COALESCE(SUM(c.amount), 0)::numeric(14,2)::text AS amount, count(c.id)::int AS count
         FROM weekly_reports r JOIN collections c ON c.report_id = r.id AND c.status = 'active'
        WHERE r.status <> 'approved' GROUP BY r.status ORDER BY r.status`,
    );
    // each non-approved status really holds money on the demo data, so the check bites
    expect(rows.map((row) => row.status)).toEqual(['draft', 'returned', 'submitted']);
    for (const row of rows) expect(row.count, row.status).toBeGreaterThan(0);

    // collected = approved + money in non-approved reports, and that gap is exactly
    // pending_approval + in_progress (exact numeric arithmetic in Postgres)
    const { rows: sums } = await db.query<{ excluded: string; gap: string; parts: string }>(
      `SELECT ($1::numeric + $2::numeric + $3::numeric)::numeric(14,2)::text AS excluded,
              ($4::numeric - $5::numeric)::numeric(14,2)::text AS gap,
              ($6::numeric + $7::numeric)::numeric(14,2)::text AS parts`,
      [
        rows[0]!.amount,
        rows[1]!.amount,
        rows[2]!.amount,
        s.figures.collected.value,
        s.figures.approved.value,
        s.figures.pending_approval.value,
        s.figures.in_progress.value,
      ],
    );
    const excludedCount = rows.reduce((n, row) => n + row.count, 0);
    const r = new Reconciler();
    r.check('collected - approved = non-approved money', sums[0]!.excluded, sums[0]!.gap);
    r.check('collected - approved = pending + in progress', sums[0]!.parts, sums[0]!.gap);
    r.check(
      'collected count - approved count = non-approved collections',
      excludedCount,
      s.figures.collected.recordCount - s.figures.approved.recordCount,
    );
    r.check(
      'non-approved collections = pending + in progress counts',
      s.figures.pending_approval.recordCount + s.figures.in_progress.recordCount,
      excludedCount,
    );
    expectReconciled(r);
  });
});
