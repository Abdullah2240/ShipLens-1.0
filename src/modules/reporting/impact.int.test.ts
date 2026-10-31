import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Queryable } from '@/platform/db';
import { sumMoney } from '@/platform/money';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, testPool } from '../../../tests/support/db';
import { seedReport } from '../../../tests/support/finance-fixtures';
import {
  SCENARIO_EXPECTED,
  buildReportingScenario,
  type ReportingScenario,
} from '../../../tests/support/reporting-fixtures';
import { REPORTING_LIMITS } from './figures';
import { getDashboardSummary } from './service-dashboard';
import { getPublicImpact, resetImpactCache, type PublicImpact } from './service-impact';

const db = testPool();
const START = '2026-10-31T12:00:00.000Z';
let s: ReportingScenario;

const PUBLIC_KEYS = [
  'activeBranchCount',
  'activeBranches',
  'approvedReportCount',
  'approvedTotal',
  'asOf',
  'cities',
  'monthly',
  'monthsCovered',
];

/** A Queryable that counts the reads of the shared view it forwards to the pool. */
function countingDb(): Queryable & { aggregateReads: () => number } {
  let reads = 0;
  const wrapper = {
    query: ((text: string, values?: unknown[]) => {
      if (/v_kpi_collections/.test(text)) reads += 1;
      return db.query(text, values);
    }) as Queryable['query'],
    aggregateReads: () => reads,
  };
  return wrapper;
}

async function approveSubmitted(reportId: string) {
  await db.query(
    `UPDATE weekly_reports
        SET status = 'approved', reviewed_at = now(), reviewed_by = $2,
            version = version + 1, updated_at = now()
      WHERE id = $1 AND status = 'submitted'`,
    [reportId, s.users.finance.id],
  );
}

beforeEach(async () => {
  resetImpactCache();
  await resetDb(db);
  s = await buildReportingScenario(db);
});

afterAll(async () => {
  resetImpactCache();
  await closeTestPool();
});

describe('getPublicImpact figures', () => {
  it('equals the approved dashboard figure and lists only approved aggregates', async () => {
    const impact = await getPublicImpact(db, fixedClock(START));
    const summary = await getDashboardSummary(db, s.actors.superAdmin, {});

    expect(impact.approvedTotal).toBe(summary.figures.approved.value);
    expect(impact.approvedTotal).toBe(SCENARIO_EXPECTED.allTime.money.approved.value);
    // A's approved report and B's approved report; B's nil report has no collections.
    expect(impact.approvedReportCount).toBe(2);
    expect(impact.monthsCovered).toBe(2);
    expect(impact.monthly).toEqual([
      { month: '2026-08', approved: '1500.00' },
      { month: '2026-09', approved: '250.50' },
    ]);
    expect(sumMoney(impact.monthly.map((m) => m.approved))).toBe(impact.approvedTotal);
    expect(impact.activeBranchCount).toBe(summary.figures.active_branches.recordCount);
    expect(impact.activeBranches).toEqual([
      { name: 'Bravo', city: 'Karachi' },
      { name: 'Alpha', city: 'Lahore' },
    ]);
    expect(impact.cities).toBe(2);
    expect(new Date(impact.asOf).toISOString()).toBe(impact.asOf);
    expect(Object.keys(impact).sort()).toEqual(PUBLIC_KEYS);
  });

  it('exposes no collection, report, user or branch identifiers, purposes or contact data', async () => {
    const json = JSON.stringify(await getPublicImpact(db, fixedClock(START)));
    const secrets = [
      ...Object.values(s.collections),
      ...Object.values(s.reports),
      ...Object.values(s.branches).flatMap((b) => [b.id, b.code]),
      ...Object.values(s.users).flatMap((u) => [u.id, u.name, u.email]),
      'Food parcels',
      'School fees',
      'Medicine',
      'Water',
      'Blankets',
      'Rations',
      'Charlie',
      'Delta',
      '300.00',
      '40.25',
      '10.00',
      '999.99',
    ];
    for (const secret of secrets) expect(json, secret).not.toContain(secret);
  });

  it('gap-fills the monthly series between the first and last approved month', async () => {
    await seedReport(db, {
      branchId: s.branches.b.id,
      weekStart: '2026-11-30',
      status: 'approved',
      submittedBy: s.users.leadB.id,
      reviewedBy: s.users.finance.id,
      collections: [{ amount: '20.00', collectedOn: '2026-12-01', createdBy: s.users.leadB.id }],
    });
    const impact = await getPublicImpact(db, fixedClock(START));
    expect(impact.monthly.map((m) => m.month)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(impact.monthly[2]).toEqual({ month: '2026-10', approved: '0.00' });
    expect(impact.monthsCovered).toBe(3);
    expect(impact.approvedTotal).toBe('1770.50');
    expect(sumMoney(impact.monthly.map((m) => m.approved))).toBe('1770.50');
  });

  it('returns zeros and empty lists on an empty database', async () => {
    await resetDb(db);
    const impact = await getPublicImpact(db, fixedClock(START));
    expect(impact).toMatchObject({
      approvedTotal: '0.00',
      approvedReportCount: 0,
      monthsCovered: 0,
      monthly: [],
      activeBranchCount: 0,
      activeBranches: [],
      cities: 0,
    });
  });
});

describe('getPublicImpact cache', () => {
  it('serves repeated calls within the window from one aggregate read', async () => {
    const counted = countingDb();
    const clock = fixedClock(START);
    const first = await getPublicImpact(counted, clock);
    const perCompute = counted.aggregateReads();
    expect(perCompute).toBeGreaterThan(0);
    clock.advance(30_000);
    const second = await getPublicImpact(counted, clock);
    expect(counted.aggregateReads()).toBe(perCompute);
    expect(second).toEqual(first);
  });

  it('recomputes immediately after a report is approved', async () => {
    const counted = countingDb();
    const clock = fixedClock(START);
    const before: PublicImpact = await getPublicImpact(counted, clock);
    const perCompute = counted.aggregateReads();
    expect(before.approvedTotal).toBe('1750.50');

    await approveSubmitted(s.reports.aSubmitted);
    clock.advance(1_000);
    const after = await getPublicImpact(counted, clock);
    expect(counted.aggregateReads()).toBe(2 * perCompute);
    expect(after.approvedTotal).toBe('2050.50');
    expect(after.approvedReportCount).toBe(3);
  });

  it('recomputes when an active branch changes', async () => {
    const counted = countingDb();
    const clock = fixedClock(START);
    await getPublicImpact(counted, clock);
    const perCompute = counted.aggregateReads();
    await db.query(
      `UPDATE branches SET status = 'active', updated_at = now() + interval '1 second' WHERE id = $1`,
      [s.branches.c.id],
    );
    const after = await getPublicImpact(counted, clock);
    expect(counted.aggregateReads()).toBe(2 * perCompute);
    expect(after.activeBranchCount).toBe(3);
    expect(after.activeBranches.map((b) => b.name)).toContain('Charlie');
  });

  it('recomputes once the window has passed even with no change', async () => {
    const counted = countingDb();
    const clock = fixedClock(START);
    await getPublicImpact(counted, clock);
    const perCompute = counted.aggregateReads();
    clock.advance(REPORTING_LIMITS.impactCacheSeconds * 1000 - 1);
    await getPublicImpact(counted, clock);
    expect(counted.aggregateReads()).toBe(perCompute);
    clock.advance(1);
    await getPublicImpact(counted, clock);
    expect(counted.aggregateReads()).toBe(2 * perCompute);
  });

  it('starts empty again after resetImpactCache', async () => {
    const counted = countingDb();
    const clock = fixedClock(START);
    await getPublicImpact(counted, clock);
    const perCompute = counted.aggregateReads();
    resetImpactCache();
    await getPublicImpact(counted, clock);
    expect(counted.aggregateReads()).toBe(2 * perCompute);
  });
});
