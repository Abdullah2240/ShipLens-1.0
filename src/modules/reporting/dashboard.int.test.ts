import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authorize, type Actor } from '@/platform/authz';
import { Forbidden } from '@/platform/errors';
import { sumMoney } from '@/platform/money';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, testPool } from '../../../tests/support/db';
import { seedReport } from '../../../tests/support/finance-fixtures';
import {
  SCENARIO_EXPECTED,
  SCENARIO_ROUTED_AT,
  buildReportingScenario,
  type ReportingScenario,
  type ScenarioFigures,
} from '../../../tests/support/reporting-fixtures';
import { MONEY_FIGURES } from './figures';
import {
  selectActiveBranches,
  selectFigureByBranch,
  selectFigureCollections,
  selectFigureReports,
  selectFigureTotals,
  selectReportFigure,
  selectSubmittedReportCounts,
} from './repo-kpi';
import {
  getDashboardSummary,
  getMonthlyTrend,
  listRecentlyRouted,
  listUnrouted,
} from './service-dashboard';
import type { DashboardSummary, ReportingFilters, TrendSeries } from './types';

const db = testPool();
const MONEY = /^\d+\.\d{2}$/;
const CLOCK = fixedClock('2026-10-31T12:00:00.000Z');
let s: ReportingScenario;

beforeEach(async () => {
  await resetDb(db);
  s = await buildReportingScenario(db);
});

afterAll(async () => {
  await closeTestPool();
});

type Expected = ScenarioFigures;

function expectFigures(summary: DashboardSummary, expected: Expected) {
  for (const id of MONEY_FIGURES) {
    expect(summary.figures[id], id).toEqual({
      figure: id,
      measure: 'amount',
      value: expected.money[id].value,
      recordCount: expected.money[id].recordCount,
    });
  }
  expect(summary.figures.active_branches).toEqual({
    figure: 'active_branches',
    measure: 'count',
    value: String(expected.counts.active_branches),
    recordCount: expected.counts.active_branches,
  });
  expect(summary.figures.reports_awaiting_review).toEqual({
    figure: 'reports_awaiting_review',
    measure: 'count',
    value: String(expected.counts.reports_awaiting_review),
    recordCount: expected.counts.reports_awaiting_review,
  });
  expect(summary.identities).toEqual({ collected: true, approved: true });
}

function collectAmounts(value: unknown, key = ''): string[] {
  const amountKeys =
    /^(value|amount|totalAmount|total|collected|approved|pendingApproval|inProgress|notYetRouted|routed)$/;
  if (Array.isArray(value)) return value.flatMap((v) => collectAmounts(v));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => collectAmounts(v, k));
  }
  return typeof value === 'string' && amountKeys.test(key) ? [value] : [];
}

describe('getDashboardSummary', () => {
  it('matches the hand-computed figures for finance reviewer and super admin', async () => {
    for (const actor of [s.actors.finance, s.actors.superAdmin]) {
      const summary = await getDashboardSummary(db, actor, {});
      expectFigures(summary, SCENARIO_EXPECTED.allTime);
      expect(summary.filters).toEqual({});
      expect(new Date(summary.asOf).toISOString()).toBe(summary.asOf);
    }
  });

  it('restricts money figures by collected_on month and report counts by week_start month', async () => {
    expectFigures(
      await getDashboardSummary(db, s.actors.finance, { from: '2026-08', to: '2026-08' }),
      SCENARIO_EXPECTED.august,
    );
    const september = await getDashboardSummary(db, s.actors.finance, {
      from: '2026-09',
      to: '2026-09',
    });
    expectFigures(september, SCENARIO_EXPECTED.september);
    expect(september.filters).toEqual({ from: '2026-09', to: '2026-09' });
  });

  it('narrows to one branch with the branch filter', async () => {
    expectFigures(
      await getDashboardSummary(db, s.actors.finance, { branch: s.branches.a.id }),
      SCENARIO_EXPECTED.branchA,
    );
    expectFigures(
      await getDashboardSummary(db, s.actors.finance, { branch: s.branches.b.id }),
      SCENARIO_EXPECTED.branchB,
    );
    expectFigures(
      await getDashboardSummary(db, s.actors.finance, { branch: s.branches.c.id }),
      SCENARIO_EXPECTED.branchC,
    );
  });

  it('drops invalid filters instead of failing', async () => {
    const summary = await getDashboardSummary(db, s.actors.finance, {
      from: 'garbage',
      to: '2026-13',
      branch: 'nope',
    });
    expect(summary.filters).toEqual({});
    expectFigures(summary, SCENARIO_EXPECTED.allTime);
  });

  it('never lets draft, submitted or returned amounts reach approved, routed or not yet routed', async () => {
    const lead = s.users.leadA.id;
    const finance = s.users.finance.id;
    const extra = (weekStart: string) => ({
      branchId: s.branches.a.id,
      weekStart,
      submittedBy: lead,
      reviewedBy: finance,
      collections: [{ amount: '77.77', purpose: 'Extra', createdBy: lead }],
    });
    await seedReport(db, { ...extra('2026-10-12'), status: 'draft' });
    await seedReport(db, { ...extra('2026-10-19'), status: 'submitted' });
    await seedReport(db, { ...extra('2026-10-26'), status: 'returned' });

    const after = await getDashboardSummary(db, s.actors.finance, {});
    expect(after.figures.collected).toMatchObject({ value: '2334.06', recordCount: 9 });
    expect(after.figures.pending_approval).toMatchObject({ value: '377.77', recordCount: 2 });
    expect(after.figures.in_progress).toMatchObject({ value: '205.79', recordCount: 4 });
    expect(after.figures.approved).toMatchObject({ value: '1750.50', recordCount: 3 });
    expect(after.figures.routed).toMatchObject({ value: '250.50', recordCount: 1 });
    expect(after.figures.not_yet_routed).toMatchObject({ value: '1500.00', recordCount: 2 });
    expect(after.figures.reports_awaiting_review.recordCount).toBe(2);
    expect(after.identities).toEqual({ collected: true, approved: true });

    await db.query(
      `UPDATE collections SET status = 'voided', void_reason = 'Mistake', voided_at = now(), voided_by = $2
        WHERE id = $1`,
      [s.collections.a10, lead],
    );
    const voided = await getDashboardSummary(db, s.actors.finance, {});
    expect(voided.figures.collected).toMatchObject({ value: '2324.06', recordCount: 8 });
    expect(voided.figures.in_progress).toMatchObject({ value: '195.79', recordCount: 3 });
    expect(voided.figures.approved).toMatchObject({ value: '1750.50', recordCount: 3 });
    expect(voided.identities).toEqual({ collected: true, approved: true });
  });

  it('returns every amount as a two-decimal string', async () => {
    const summary = await getDashboardSummary(db, s.actors.finance, {});
    for (const id of MONEY_FIGURES) expect(summary.figures[id].value).toMatch(MONEY);
  });
});

describe('getMonthlyTrend', () => {
  async function expectTotalsMatchSummary(filters: ReportingFilters, trend: TrendSeries) {
    const summary = await getDashboardSummary(db, s.actors.finance, filters);
    const pairs = [
      ['collected', 'collected'],
      ['approved', 'approved'],
      ['pendingApproval', 'pending_approval'],
      ['inProgress', 'in_progress'],
      ['notYetRouted', 'not_yet_routed'],
      ['routed', 'routed'],
    ] as const;
    for (const [key, id] of pairs) {
      expect(sumMoney(trend.months.map((m) => m[key])), key).toBe(summary.figures[id].value);
      expect(trend.totals[key]).toBe(summary.figures[id].value);
    }
  }

  it('buckets by PKT month of collected_on and gap-fills to the current PKT month', async () => {
    const trend = await getMonthlyTrend(db, s.actors.finance, {}, CLOCK);
    expect(trend.months).toEqual(SCENARIO_EXPECTED.trend);
    await expectTotalsMatchSummary({}, trend);

    const later = await getMonthlyTrend(
      db,
      s.actors.finance,
      {},
      fixedClock('2026-12-15T00:00:00Z'),
    );
    expect(later.months.map((m) => m.month)).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(later.months[4]).toEqual({
      month: '2026-12',
      collected: '0.00',
      approved: '0.00',
      pendingApproval: '0.00',
      inProgress: '0.00',
      notYetRouted: '0.00',
      routed: '0.00',
    });
    await expectTotalsMatchSummary({}, later);
  });

  it('uses the PKT month of the clock, not the UTC month', async () => {
    // 2026-10-31T19:30Z is 00:30 on 1 November in Karachi.
    const trend = await getMonthlyTrend(
      db,
      s.actors.finance,
      {},
      fixedClock('2026-10-31T19:30:00Z'),
    );
    expect(trend.months.at(-1)!.month).toBe('2026-11');
  });

  it('covers exactly from..to when both are given', async () => {
    const filters = { from: '2026-07', to: '2026-11' };
    const trend = await getMonthlyTrend(db, s.actors.finance, filters, CLOCK);
    expect(trend.months.map((m) => m.month)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    expect(trend.months[0]!.collected).toBe('0.00');
    await expectTotalsMatchSummary(filters, trend);

    const single = await getMonthlyTrend(
      db,
      s.actors.finance,
      { from: '2026-09', to: '2026-09' },
      CLOCK,
    );
    expect(single.months).toEqual([SCENARIO_EXPECTED.trend[1]]);
    await expectTotalsMatchSummary({ from: '2026-09', to: '2026-09' }, single);
  });

  it('gap-fills inside the data range and agrees with the summary for every filter', async () => {
    const branchB = await getMonthlyTrend(db, s.actors.finance, { branch: s.branches.b.id }, CLOCK);
    expect(branchB.months.map((m) => [m.month, m.collected])).toEqual([
      ['2026-08', '500.00'],
      ['2026-09', '0.00'],
      ['2026-10', '0.00'],
    ]);
    for (const filters of [
      { branch: s.branches.a.id },
      { branch: s.branches.b.id },
      { branch: s.branches.c.id },
      { from: '2026-09' },
      { to: '2026-08' },
    ]) {
      await expectTotalsMatchSummary(
        filters,
        await getMonthlyTrend(db, s.actors.finance, filters, CLOCK),
      );
    }
  });

  it('puts a 2026-09-01 collection in September even when created on 31 August UTC', async () => {
    const report = await seedReport(db, { branchId: s.branches.b.id, weekStart: '2026-08-31' });
    await db.query(
      `INSERT INTO collections (branch_id, report_id, amount, collected_on, purpose, created_by, created_at)
       VALUES ($1, $2, '1.11', '2026-09-01', 'Late night entry', $3, '2026-08-31T19:30:00Z')`,
      [s.branches.b.id, report.reportId, s.users.leadB.id],
    );
    const trend = await getMonthlyTrend(db, s.actors.finance, {}, CLOCK);
    const september = trend.months.find((m) => m.month === '2026-09')!;
    expect(september.collected).toBe('591.86');
    expect(september.inProgress).toBe('41.36');
    expect(trend.months.find((m) => m.month === '2026-08')!.collected).toBe('1500.00');
  });
});

describe('listUnrouted', () => {
  it('lists exactly the approved, active, unrouted collections, oldest approval first', async () => {
    const page = await listUnrouted(db, s.actors.finance, { page: 1, pageSize: 50 }, CLOCK);
    expect(page.items.map((r) => r.amount)).toEqual(SCENARIO_EXPECTED.unroutedAmounts);
    expect(page.items.map((r) => r.collectionId)).toEqual([
      s.collections.a1000,
      s.collections.b500,
    ]);
    expect(page.totalAmount).toBe(SCENARIO_EXPECTED.unroutedTotal);
    const summary = await getDashboardSummary(db, s.actors.finance, {});
    expect(page.totalAmount).toBe(summary.figures.not_yet_routed.value);
    expect(page.total).toBe(summary.figures.not_yet_routed.recordCount);
    expect(page).toMatchObject({ page: 1, pageSize: 50 });
    expect(page.items[0]).toMatchObject({
      branchId: s.branches.a.id,
      branchCode: 'BR-A',
      branchName: 'Alpha',
      reportId: s.reports.aApproved,
      weekStart: '2026-08-31',
      collectedOn: '2026-08-31',
      purpose: 'Food parcels',
    });
    expect(page.items[0]!.approvedAt <= page.items[1]!.approvedAt).toBe(true);
  });

  it('pages stably and keeps totals over every row', async () => {
    const first = await listUnrouted(db, s.actors.finance, { page: 1, pageSize: 1 }, CLOCK);
    const second = await listUnrouted(db, s.actors.finance, { page: 2, pageSize: 1 }, CLOCK);
    const third = await listUnrouted(db, s.actors.finance, { page: 3, pageSize: 1 }, CLOCK);
    expect(first.items.map((r) => r.collectionId)).toEqual([s.collections.a1000]);
    expect(second.items.map((r) => r.collectionId)).toEqual([s.collections.b500]);
    expect(third.items).toEqual([]);
    for (const p of [first, second, third]) {
      expect(p.total).toBe(2);
      expect(p.totalAmount).toBe('1500.00');
    }
  });

  it('applies the branch filter', async () => {
    const page = await listUnrouted(db, s.actors.finance, { branch: s.branches.b.id }, CLOCK);
    expect(page.items.map((r) => r.collectionId)).toEqual([s.collections.b500]);
    expect(page.totalAmount).toBe('500.00');
  });

  it('counts days waiting from the PKT approval date to the PKT date of the clock', async () => {
    const base = await listUnrouted(db, s.actors.finance, {}, CLOCK);
    const approvedAt = new Date(base.items[0]!.approvedAt).getTime();
    const page = await listUnrouted(
      db,
      s.actors.finance,
      {},
      fixedClock(new Date(approvedAt + 3 * 86_400_000)),
    );
    expect(page.items[0]!.daysWaiting).toBe(3);
  });
});

describe('listRecentlyRouted', () => {
  it('lists routed collections, newest routing first, with the router name', async () => {
    const one = await listRecentlyRouted(db, s.actors.finance, { page: 1, pageSize: 50 });
    expect(one.total).toBe(1);
    expect(one.items).toEqual([
      expect.objectContaining({
        collectionId: s.collections.a250,
        amount: '250.50',
        routedAt: SCENARIO_ROUTED_AT,
        routedByName: 'Faraz Finance',
        branchCode: 'BR-A',
        reportId: s.reports.aApproved,
      }),
    ]);

    const extra = await seedReport(db, {
      branchId: s.branches.b.id,
      weekStart: '2026-10-12',
      status: 'approved',
      submittedBy: s.users.leadB.id,
      reviewedBy: s.users.finance.id,
      collections: [
        { amount: '20.00', createdBy: s.users.leadB.id, routedAt: '2026-10-20T00:00:00.000Z' },
        { amount: '30.00', createdBy: s.users.leadB.id, routedAt: '2026-09-05T00:00:00.000Z' },
      ],
    });
    const all = await listRecentlyRouted(db, s.actors.finance, { page: 1, pageSize: 50 });
    expect(all.items.map((r) => r.collectionId)).toEqual([
      extra.collectionIds[0],
      s.collections.a250,
      extra.collectionIds[1],
    ]);
    const second = await listRecentlyRouted(db, s.actors.finance, { page: 2, pageSize: 1 });
    expect(second.items.map((r) => r.collectionId)).toEqual([s.collections.a250]);
    expect(second.total).toBe(3);
    const onlyB = await listRecentlyRouted(db, s.actors.finance, { branch: s.branches.b.id });
    expect(onlyB.total).toBe(2);
  });
});

describe('canonical figure queries', () => {
  it('sums consistently from branches to reports to collections for every money figure', async () => {
    const scope = authorize(s.actors.finance, 'dashboard.read');
    for (const filters of [{}, { from: '2026-09', to: '2026-09' }] as ReportingFilters[]) {
      const totals = await selectFigureTotals(db, scope, filters);
      for (const figure of MONEY_FIGURES) {
        const branches = await selectFigureByBranch(db, scope, figure, filters);
        expect(sumMoney(branches.map((b) => b.value)), figure).toBe(totals.money[figure].value);
        expect(branches.reduce((n, b) => n + b.recordCount, 0)).toBe(
          totals.money[figure].recordCount,
        );
        for (const branch of branches) {
          expect(branch.value).toMatch(MONEY);
          expect(branch.value).not.toBe('0.00');
          const reports = await selectFigureReports(db, scope, figure, {
            ...filters,
            branchId: branch.branchId,
          });
          expect(sumMoney(reports.map((r) => r.value))).toBe(branch.value);
          expect(reports.length).toBe(branch.reportCount);
          for (const report of reports) {
            const all = await selectFigureCollections(db, scope, figure, {
              ...filters,
              branchId: branch.branchId,
              reportId: report.reportId,
            });
            expect(sumMoney(all.rows.map((c) => c.amount))).toBe(report.value);
            expect(all.total).toBe(report.value);
            expect(all.recordCount).toBe(report.recordCount);
            const limited = await selectFigureCollections(
              db,
              scope,
              figure,
              { ...filters, branchId: branch.branchId, reportId: report.reportId },
              { limit: 1 },
            );
            expect(limited.rows).toHaveLength(1);
            expect(limited.total).toBe(report.value);
            expect(limited.recordCount).toBe(report.recordCount);
          }
        }
      }
    }
  });

  it('orders branches by value and reports by week, and exposes frozen totals', async () => {
    const scope = authorize(s.actors.finance, 'dashboard.read');
    const approved = await selectFigureByBranch(db, scope, 'approved', {});
    expect(approved.map((b) => [b.branchCode, b.value, b.recordCount, b.reportCount])).toEqual([
      ['BR-A', '1250.50', 2, 1],
      ['BR-B', '500.00', 1, 1],
    ]);
    const collected = await selectFigureReports(db, scope, 'collected', {
      branchId: s.branches.a.id,
    });
    expect(collected.map((r) => [r.weekStart, r.status, r.value])).toEqual([
      ['2026-10-05', 'draft', '10.00'],
      ['2026-09-14', 'returned', '40.25'],
      ['2026-09-07', 'submitted', '300.00'],
      ['2026-08-31', 'approved', '1250.50'],
    ]);
    const approvedReport = collected.at(-1)!;
    expect(approvedReport).toMatchObject({ frozenAmount: '1250.50', frozenCount: 2 });
    expect(approvedReport.reviewedAt).toEqual(expect.any(String));
    expect(collected[0]).toMatchObject({
      frozenAmount: null,
      frozenCount: null,
      submittedAt: null,
    });

    const september = await selectFigureCollections(db, scope, 'approved', {
      from: '2026-09',
      to: '2026-09',
    });
    expect(september.rows).toEqual([
      expect.objectContaining({
        collectionId: s.collections.a250,
        collectedOn: '2026-09-01',
        amount: '250.50',
        routedAt: SCENARIO_ROUTED_AT,
        reportStatus: 'approved',
        purpose: 'School fees',
      }),
    ]);
  });

  it('matches nothing for malformed ids instead of failing', async () => {
    const scope = authorize(s.actors.finance, 'dashboard.read');
    expect(await selectFigureReports(db, scope, 'collected', { branchId: 'nope' })).toEqual([]);
    const none = await selectFigureCollections(db, scope, 'collected', { reportId: 'nope' });
    expect(none).toEqual({ rows: [], total: '0.00', recordCount: 0 });
    expect(await selectReportFigure(db, scope, 'nope')).toBeNull();
  });

  it('serves active branches, submitted report counts and one report figure', async () => {
    const scope = authorize(s.actors.finance, 'dashboard.read');
    expect(await selectActiveBranches(db, scope, { from: '2030-01' })).toEqual([
      { branchId: s.branches.a.id, branchCode: 'BR-A', branchName: 'Alpha', city: 'Lahore' },
      { branchId: s.branches.b.id, branchCode: 'BR-B', branchName: 'Bravo', city: 'Karachi' },
    ]);
    expect(await selectSubmittedReportCounts(db, scope, {})).toEqual([
      {
        branchId: s.branches.a.id,
        branchCode: 'BR-A',
        branchName: 'Alpha',
        count: 1,
        value: '300.00',
      },
    ]);
    expect(await selectSubmittedReportCounts(db, scope, { from: '2026-10' })).toEqual([]);
    expect(await selectReportFigure(db, scope, s.reports.aApproved)).toMatchObject({
      reportId: s.reports.aApproved,
      branchCode: 'BR-A',
      weekStart: '2026-08-31',
      status: 'approved',
      liveAmount: '1250.50',
      liveCount: 2,
      frozenAmount: '1250.50',
      frozenCount: 2,
    });
    expect(await selectReportFigure(db, scope, s.reports.bNil)).toMatchObject({
      liveAmount: '0.00',
      liveCount: 0,
      frozenAmount: '0.00',
      frozenCount: 0,
    });
  });

  it('honours a branch scope', async () => {
    const branchScope = authorize(s.actors.leadA, 'report.read');
    const totals = await selectFigureTotals(db, branchScope, {});
    for (const id of MONEY_FIGURES) {
      expect(totals.money[id]).toEqual(SCENARIO_EXPECTED.branchA.money[id]);
    }
    expect(totals.counts).toEqual(SCENARIO_EXPECTED.branchA.counts);
    expect(await selectReportFigure(db, branchScope, s.reports.bApproved)).toBeNull();
    expect(
      await selectFigureByBranch(db, branchScope, 'collected', { branch: s.branches.b.id }),
    ).toEqual([]);
  });
});

describe('authorization and money shape', () => {
  it('forbids branch lead, HR lead and content editor on every dashboard service', async () => {
    const forbidden: Actor[] = [s.actors.leadA, s.actors.hrA, s.actors.editor];
    for (const actor of forbidden) {
      await expect(getDashboardSummary(db, actor, {})).rejects.toBeInstanceOf(Forbidden);
      await expect(getMonthlyTrend(db, actor, {}, CLOCK)).rejects.toBeInstanceOf(Forbidden);
      await expect(listUnrouted(db, actor, {}, CLOCK)).rejects.toBeInstanceOf(Forbidden);
      await expect(listRecentlyRouted(db, actor, {})).rejects.toBeInstanceOf(Forbidden);
    }
  });

  it('returns two-decimal strings for every amount in every service', async () => {
    const outputs = [
      await getDashboardSummary(db, s.actors.superAdmin, {}),
      await getMonthlyTrend(db, s.actors.superAdmin, {}, CLOCK),
      await listUnrouted(db, s.actors.superAdmin, {}, CLOCK),
      await listRecentlyRouted(db, s.actors.superAdmin, {}),
    ];
    const summary = outputs[0] as DashboardSummary;
    const amounts = collectAmounts({
      ...outputs.slice(1),
      figures: MONEY_FIGURES.map((id) => summary.figures[id]),
    });
    expect(amounts.length).toBeGreaterThan(20);
    for (const amount of amounts) expect(amount).toMatch(MONEY);
  });
});
