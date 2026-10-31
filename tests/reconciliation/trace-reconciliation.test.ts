// TRC-02 on the real demo data: walking every trace level for every figure, each level's
// footer equals the number clicked one level up, the top equals the dashboard and the
// oracle (db/seed/expected.json), and every approved collection is reachable exactly once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getDashboardSummary,
  type MoneyFigureId,
  type ReportingFilters,
} from '@/modules/reporting';
import {
  getBranchReports,
  getCollectionEvidence,
  getFigureByBranch,
  getReportCollections,
} from '@/modules/reporting/service-trace';
import type { Actor } from '@/platform/authz';
import { closeTestPool, testPool } from '../support/db';
import { MONEY_FIGURE_IDS, Reconciler, loadExpected, type FigureSet } from './expected';
import { demoActor, seedDemoDatabase } from './seed-demo';

const db = testPool();
const expected = loadExpected();
const WALKED: (MoneyFigureId | 'reports_awaiting_review')[] = [
  ...MONEY_FIGURE_IDS,
  'reports_awaiting_review',
];
const ZERO = { amount: '0.00', count: 0 };
const countSum = (rows: { recordCount: number }[]) =>
  rows.reduce((n, row) => n + row.recordCount, 0);

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

interface ApprovedLeaf {
  branchId: string;
  reportId: string;
  collectionId: string;
  amount: string;
}

interface Walk {
  r: Reconciler;
  /** Every approved collection reached at L3, with how often it was reached. */
  approvedSeen: Map<string, number>;
  /** The first L3 collection of every approved report (one L4 target per report). */
  approvedLeaves: ApprovedLeaf[];
}

/** Walks L1 to L3 for every figure under the filters, collecting footer comparisons. */
async function walk(f: ReportingFilters, label: string, oracle: FigureSet): Promise<Walk> {
  const r = new Reconciler();
  const approvedSeen = new Map<string, number>();
  const approvedLeaves: ApprovedLeaf[] = [];
  const summary = await getDashboardSummary(db, admin, f);

  for (const figure of WALKED) {
    const at = `${label} ${figure}`;
    const l1 = await getFigureByBranch(db, finance, figure, f);
    r.check(`${at} L1 matchesParent`, true, l1.matchesParent);
    r.check(`${at} L1 truncated`, 'none', l1.truncated ? `shown ${l1.truncated.shown}` : 'none');
    r.check(`${at} L1 parent = dashboard`, summary.figures[figure].value, l1.parentValue);
    r.check(`${at} L1 total = dashboard`, summary.figures[figure].value, l1.total);
    r.check(`${at} L1 recordCount = rows`, l1.rows.length, l1.recordCount);
    if (figure !== 'reports_awaiting_review') {
      const want = oracle[figure] ?? ZERO;
      r.check(`${at} L1 total = expected`, want.amount, l1.total);
      // L1 recordCount counts branches; the collections behind the figure sum over the rows
      r.check(`${at} L1 collections = expected`, want.count, countSum(l1.rows));
    } else if (label === 'all time') {
      r.check(`${at} L1 total = expected`, expected.kpis.reports_awaiting_review, l1.total);
    }

    for (const branch of l1.rows) {
      const bt = `${at} ${branch.branchCode}`;
      const l2 = await getBranchReports(db, finance, figure, branch.branchId, f);
      r.check(`${bt} L2 matchesParent`, true, l2.matchesParent);
      r.check(`${bt} L2 truncated`, 'none', l2.truncated ? `shown ${l2.truncated.shown}` : 'none');
      r.check(`${bt} L2 parent = L1 row`, branch.value, l2.parentValue);
      r.check(`${bt} L2 total = L1 row`, branch.value, l2.total);
      r.check(`${bt} L2 recordCount = rows`, l2.rows.length, l2.recordCount);
      if (figure !== 'reports_awaiting_review') {
        r.check(`${bt} L2 collections = L1 row`, branch.recordCount, countSum(l2.rows));
      }

      for (const report of l2.rows) {
        const rt = `${bt} ${report.weekStart}`;
        const l3 = await getReportCollections(
          db,
          finance,
          figure,
          branch.branchId,
          report.reportId,
          f,
        );
        r.check(`${rt} L3 matchesParent`, true, l3.matchesParent);
        r.check(
          `${rt} L3 truncated`,
          'none',
          l3.truncated ? `shown ${l3.truncated.shown}` : 'none',
        );
        r.check(`${rt} L3 parent = L2 row`, report.value, l3.parentValue);
        r.check(`${rt} L3 total = L2 row`, report.value, l3.total);
        r.check(`${rt} L3 records = L2 row`, report.recordCount, l3.recordCount);
        r.check(`${rt} L3 rows listed`, l3.recordCount, l3.rows.length);

        if (figure === 'approved') {
          for (const c of l3.rows) {
            approvedSeen.set(c.collectionId, (approvedSeen.get(c.collectionId) ?? 0) + 1);
          }
          const first = l3.rows[0];
          if (first) {
            approvedLeaves.push({
              branchId: branch.branchId,
              reportId: report.reportId,
              collectionId: first.collectionId,
              amount: first.amount,
            });
          }
        }
      }
    }
  }
  return { r, approvedSeen, approvedLeaves };
}

/** Active collections of approved reports, optionally only those collected in one month. */
async function approvedCollectionIds(month?: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT c.id FROM collections c JOIN weekly_reports r ON r.id = c.report_id
      WHERE c.status = 'active' AND r.status = 'approved'
        AND ($1::text IS NULL OR to_char(c.collected_on, 'YYYY-MM') = $1)
      ORDER BY c.id`,
    [month ?? null],
  );
  return rows.map((row) => row.id);
}

function expectReconciled(r: Reconciler): void {
  expect(r.rows.length).toBeGreaterThan(0);
  expect(r.mismatches(), r.report()).toEqual([]);
}

function checkReachable(
  r: Reconciler,
  label: string,
  seen: Map<string, number>,
  ids: string[],
): void {
  r.check(`${label} approved collections reached`, ids.length, seen.size);
  for (const id of ids) r.check(`${label} approved collection ${id} reached`, 1, seen.get(id) ?? 0);
}

const WALK_TIMEOUT = 600_000;

describe('trace walk, no filters', () => {
  let result: Walk;

  beforeAll(async () => {
    result = await walk({}, 'all time', expected.kpis);
  }, WALK_TIMEOUT);

  it('every level footer equals its parent for every figure, and the top equals the oracle', () => {
    expectReconciled(result.r);
  });

  it('every approved collection is reached exactly once under approved', async () => {
    const ids = await approvedCollectionIds();
    expect(ids).toHaveLength(expected.kpis.approved.count);
    const r = new Reconciler();
    checkReachable(r, 'all time', result.approvedSeen, ids);
    expectReconciled(r);
  });

  it(
    'one collection per approved report resolves at L4 with its audit timelines',
    async () => {
      const reportsWithMoney = expected.approvedReports.filter((e) => e.count > 0);
      expect(result.approvedLeaves).toHaveLength(reportsWithMoney.length);
      const r = new Reconciler();
      for (const leaf of result.approvedLeaves) {
        const at = `L4 ${leaf.collectionId}`;
        const l4 = await getCollectionEvidence(
          db,
          finance,
          'approved',
          leaf.branchId,
          leaf.reportId,
          leaf.collectionId,
          {},
        );
        r.check(`${at} collection`, leaf.collectionId, l4.collection.collectionId);
        r.check(`${at} amount`, leaf.amount, l4.collection.amount);
        r.check(`${at} report`, leaf.reportId, l4.report.reportId);
        r.check(`${at} report frozen = live`, true, l4.report.frozenMatchesLive);
        r.check(`${at} collection timeline not empty`, true, l4.collectionTimeline.length > 0);
        r.check(
          `${at} collection timeline has collection.create`,
          true,
          l4.collectionTimeline.some((e) => e.action === 'collection.create'),
        );
        r.check(
          `${at} report timeline has report.approve`,
          true,
          l4.reportTimeline.some((e) => e.action === 'report.approve'),
        );
      }
      expectReconciled(r);
    },
    WALK_TIMEOUT,
  );
});

describe('trace walk per month', () => {
  for (const month of expected.byMonth.keys()) {
    it(
      `${month}: every level reconciles and every approved collection of the month is reached once`,
      async () => {
        const oracle = expected.byMonth.get(month)!;
        const result = await walk({ from: month, to: month }, month, oracle);
        const ids = await approvedCollectionIds(month);
        expect(ids).toHaveLength((oracle.approved ?? ZERO).count);
        checkReachable(result.r, month, result.approvedSeen, ids);
        expectReconciled(result.r);
      },
      WALK_TIMEOUT,
    );
  }
});
