import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@/platform/authz';
import { Forbidden, NotFound, mapError } from '@/platform/errors';
import { closeTestPool, resetDb, testPool } from '../../../tests/support/db';
import {
  SCENARIO_EXPECTED,
  buildReportingScenario,
  type ReportingScenario,
} from '../../../tests/support/reporting-fixtures';
import { MONEY_FIGURES } from './figures';
import { getBranchReports, getFigureByBranch } from './service-trace';
import { getDashboardSummary } from './service-dashboard';
import type { FigureId, MoneyFigureId, ReportingFilters } from './types';

const db = testPool();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ALL_FIGURES: FigureId[] = [...MONEY_FIGURES, 'active_branches', 'reports_awaiting_review'];
const FILTER_SETS: ReportingFilters[] = [
  {},
  { from: '2026-08', to: '2026-08' },
  { from: '2026-09', to: '2026-09' },
  { from: '2026-09' },
  { to: '2026-08' },
  { from: '2026-10', to: '2026-10' },
];
let s: ReportingScenario;

beforeEach(async () => {
  await resetDb(db);
  s = await buildReportingScenario(db);
});

afterAll(async () => {
  await closeTestPool();
});

async function notFoundBody(promise: Promise<unknown>) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(NotFound);
  return mapError(err, 'req').body;
}

const NOT_FOUND_BODY = mapError(new NotFound(), 'req').body;

describe('getFigureByBranch (L1)', () => {
  it('lists the contributing branches per money figure, hand-computed', async () => {
    const level = await getFigureByBranch(db, s.actors.finance, 'collected', {});
    expect(level.figure).toBe('collected');
    expect(level.slug).toBe('collected');
    expect(level.measure).toBe('amount');
    expect(level.level).toBe('branches');
    expect(level.rows.map((r) => [r.branchCode, r.value, r.recordCount, r.reportCount])).toEqual([
      ['BR-A', '1600.75', 5, 4],
      ['BR-B', '500.00', 1, 1],
    ]);
    expect(level.rows[0]).toMatchObject({
      branchId: s.branches.a.id,
      branchName: 'Alpha',
      branchStatus: 'active',
      href: `/dashboard/kpi/collected/branches/${s.branches.a.id}`,
    });
    expect(level.total).toBe('2100.75');
    expect(level.parentValue).toBe('2100.75');
    expect(level.recordCount).toBe(2);
    expect(level.matchesParent).toBe(true);
    expect(level.truncated).toBeNull();

    const approved = await getFigureByBranch(db, s.actors.finance, 'approved', {});
    expect(approved.rows.map((r) => [r.branchCode, r.value, r.recordCount])).toEqual([
      ['BR-A', '1250.50', 2],
      ['BR-B', '500.00', 1],
    ]);
    const pending = await getFigureByBranch(db, s.actors.finance, 'pending_approval', {});
    expect(pending.rows.map((r) => [r.branchCode, r.value])).toEqual([['BR-A', '300.00']]);
    const inProgress = await getFigureByBranch(db, s.actors.finance, 'in_progress', {});
    expect(inProgress.rows.map((r) => [r.branchCode, r.value, r.reportCount])).toEqual([
      ['BR-A', '50.25', 2],
    ]);
    const unrouted = await getFigureByBranch(db, s.actors.finance, 'not_yet_routed', {});
    expect(unrouted.rows.map((r) => [r.branchCode, r.value])).toEqual([
      ['BR-A', '1000.00'],
      ['BR-B', '500.00'],
    ]);
    const routed = await getFigureByBranch(db, s.actors.finance, 'routed', {});
    expect(routed.rows.map((r) => [r.branchCode, r.value])).toEqual([['BR-A', '250.50']]);
  });

  it('total equals the dashboard figure for every figure and filter set', async () => {
    for (const f of FILTER_SETS) {
      const summary = await getDashboardSummary(db, s.actors.finance, f);
      for (const figure of ALL_FIGURES) {
        const level = await getFigureByBranch(db, s.actors.superAdmin, figure, f);
        const label = `${figure} ${JSON.stringify(f)}`;
        expect(level.parentValue, label).toBe(summary.figures[figure].value);
        expect(level.total, label).toBe(summary.figures[figure].value);
        expect(level.matchesParent, label).toBe(true);
        expect(level.explain).toEqual({
          figure,
          level: 'branches',
          filters: f,
          recordCount: level.rows.length,
          value: level.total,
          asOf: level.asOf,
        });
        expect(level.asOf).toMatch(ISO);
        expect(level.trail.map((t) => [t.kind, t.value])).toEqual([
          ['dashboard', summary.figures[figure].value],
          ['figure', summary.figures[figure].value],
        ]);
        for (const row of level.rows) {
          expect(row.value === '0.00' || row.value === '0', label).toBe(false);
        }
      }
    }
  });

  it('counts submitted reports per branch for reports awaiting review', async () => {
    const level = await getFigureByBranch(db, s.actors.finance, 'reports_awaiting_review', {});
    expect(level.measure).toBe('count');
    expect(level.rows).toEqual([
      {
        branchId: s.branches.a.id,
        branchCode: 'BR-A',
        branchName: 'Alpha',
        branchStatus: 'active',
        value: '1',
        recordCount: 1,
        reportCount: 1,
        href: `/dashboard/kpi/reports-awaiting-review/branches/${s.branches.a.id}`,
      },
    ]);
    expect(level.total).toBe(String(SCENARIO_EXPECTED.allTime.counts.reports_awaiting_review));
    expect(level.matchesParent).toBe(true);

    const august = await getFigureByBranch(db, s.actors.finance, 'reports_awaiting_review', {
      from: '2026-08',
      to: '2026-08',
    });
    expect(august.rows).toEqual([]);
    expect(august.total).toBe('0');
    expect(august.parentValue).toBe('0');
    expect(august.matchesParent).toBe(true);
  });

  it('lists active branches only, each linking to its approved branch level', async () => {
    const level = await getFigureByBranch(db, s.actors.finance, 'active_branches', {
      from: '2026-09',
    });
    expect(level.rows.map((r) => [r.branchCode, r.branchStatus, r.value, r.href])).toEqual([
      ['BR-A', 'active', '1', `/dashboard/kpi/approved/branches/${s.branches.a.id}?from=2026-09`],
      ['BR-B', 'active', '1', `/dashboard/kpi/approved/branches/${s.branches.b.id}?from=2026-09`],
    ]);
    // reportCount: approved reports contributing to the approved figure for the same filters.
    expect(level.rows.map((r) => r.reportCount)).toEqual([1, 0]);
    expect(level.total).toBe('2');
    expect(level.parentValue).toBe('2');
    expect(level.matchesParent).toBe(true);
  });

  it('applies the branch filter at L1', async () => {
    const level = await getFigureByBranch(db, s.actors.finance, 'collected', {
      branch: s.branches.b.id,
    });
    expect(level.rows.map((r) => r.branchCode)).toEqual(['BR-B']);
    expect(level.total).toBe(SCENARIO_EXPECTED.branchB.money.collected.value);
    expect(level.parentValue).toBe(SCENARIO_EXPECTED.branchB.money.collected.value);
    expect(level.matchesParent).toBe(true);
    expect(level.trail[0]!.href).toBe(`/dashboard?branch=${s.branches.b.id}`);
    expect(level.rows[0]!.href).toBe(`/dashboard/kpi/collected/branches/${s.branches.b.id}`);

    const active = await getFigureByBranch(db, s.actors.finance, 'active_branches', {
      branch: s.branches.c.id,
    });
    expect(active.rows).toEqual([]);
    expect(active.total).toBe('0');
    expect(active.matchesParent).toBe(true);
  });

  it('carries the month filter into totals, hrefs and the explanation', async () => {
    const level = await getFigureByBranch(db, s.actors.finance, 'collected', {
      from: '2026-09',
      to: '2026-09',
    });
    expect(level.rows.map((r) => [r.branchCode, r.value])).toEqual([['BR-A', '590.75']]);
    expect(level.total).toBe(SCENARIO_EXPECTED.september.money.collected.value);
    expect(level.rows[0]!.href).toBe(
      `/dashboard/kpi/collected/branches/${s.branches.a.id}?from=2026-09&to=2026-09`,
    );
    expect(level.explain.filters).toEqual({ from: '2026-09', to: '2026-09' });
  });

  it('drops invalid filters instead of failing', async () => {
    const level = await getFigureByBranch(db, s.actors.finance, 'collected', {
      from: 'nonsense',
      branch: 'not-a-uuid',
    });
    expect(level.explain.filters).toEqual({});
    expect(level.total).toBe(SCENARIO_EXPECTED.allTime.money.collected.value);
  });
});

describe('getBranchReports (L2)', () => {
  it('total equals the branch value from L1 for every figure, filter set and branch', async () => {
    for (const f of FILTER_SETS) {
      for (const figure of ALL_FIGURES.filter((id) => id !== 'active_branches')) {
        const l1 = await getFigureByBranch(db, s.actors.finance, figure, f);
        for (const row of l1.rows) {
          const l2 = await getBranchReports(db, s.actors.finance, figure, row.branchId, f);
          const label = `${figure} ${row.branchCode} ${JSON.stringify(f)}`;
          expect(l2.level, label).toBe('reports');
          expect(l2.parentValue, label).toBe(row.value);
          expect(l2.total, label).toBe(row.value);
          expect(l2.matchesParent, label).toBe(true);
          expect(l2.branch.branchId).toBe(row.branchId);
          expect(l2.explain).toEqual({
            figure,
            level: 'reports',
            filters: { from: f.from, to: f.to, branchId: row.branchId },
            recordCount: l2.rows.length,
            value: l2.total,
            asOf: l2.asOf,
          });
          expect(l2.trail.map((t) => [t.kind, t.value])).toEqual([
            ['dashboard', l1.parentValue],
            ['figure', l1.parentValue],
            ['branch', row.value],
          ]);
          if (figure !== 'reports_awaiting_review') {
            // Money: the collections behind the reports are the collections behind the branch.
            expect(
              l2.rows.reduce((n, r) => n + r.recordCount, 0),
              label,
            ).toBe(row.recordCount);
          }
        }
      }
    }
  });

  it('lists a branch reports newest week first with frozen totals, hand-computed', async () => {
    const level = await getBranchReports(db, s.actors.finance, 'collected', s.branches.a.id, {});
    expect(
      level.rows.map((r) => [r.weekStart, r.weekEnd, r.status, r.value, r.recordCount]),
    ).toEqual([
      ['2026-10-05', '2026-10-11', 'draft', '10.00', 1],
      ['2026-09-14', '2026-09-20', 'returned', '40.25', 1],
      ['2026-09-07', '2026-09-13', 'submitted', '300.00', 1],
      ['2026-08-31', '2026-09-06', 'approved', '1250.50', 2],
    ]);
    expect(level.rows[3]).toMatchObject({
      reportId: s.reports.aApproved,
      frozenAmount: '1250.50',
      frozenCount: 2,
      href: `/dashboard/kpi/collected/branches/${s.branches.a.id}/reports/${s.reports.aApproved}`,
    });
    expect(level.rows[3]!.submittedAt).toMatch(ISO);
    expect(level.rows[0]!.frozenAmount).toBeNull();
    expect(level.branch).toEqual({
      branchId: s.branches.a.id,
      branchCode: 'BR-A',
      branchName: 'Alpha',
      branchStatus: 'active',
      city: 'Lahore',
    });
    expect(level.total).toBe('1600.75');
  });

  it('follows the month filter consistently with the summary', async () => {
    const f = { from: '2026-09', to: '2026-09' };
    const level = await getBranchReports(db, s.actors.finance, 'approved', s.branches.a.id, f);
    expect(level.rows.map((r) => [r.reportId, r.value, r.recordCount])).toEqual([
      [s.reports.aApproved, '250.50', 1],
    ]);
    expect(level.total).toBe(SCENARIO_EXPECTED.september.money.approved.value);
    expect(level.rows[0]!.href).toBe(
      `/dashboard/kpi/approved/branches/${s.branches.a.id}/reports/${s.reports.aApproved}?from=2026-09&to=2026-09`,
    );
  });

  it('ignores the branch filter: the path branch wins', async () => {
    const level = await getBranchReports(db, s.actors.finance, 'approved', s.branches.a.id, {
      branch: s.branches.b.id,
    });
    expect(level.total).toBe(SCENARIO_EXPECTED.branchA.money.approved.value);
    expect(level.explain.filters).toEqual({ branchId: s.branches.a.id });
    expect(level.trail[0]!.href).toBe('/dashboard');
  });

  it('lists submitted reports with their amounts for reports awaiting review', async () => {
    const level = await getBranchReports(
      db,
      s.actors.finance,
      'reports_awaiting_review',
      s.branches.a.id,
      {},
    );
    expect(level.measure).toBe('count');
    expect(level.rows.map((r) => [r.reportId, r.status, r.value, r.recordCount])).toEqual([
      [s.reports.aSubmitted, 'submitted', '300.00', 1],
    ]);
    expect(level.total).toBe('1');
    expect(level.parentValue).toBe('1');
    expect(level.matchesParent).toBe(true);
    expect(level.rows[0]!.href).toBe(
      `/dashboard/kpi/reports-awaiting-review/branches/${s.branches.a.id}/reports/${s.reports.aSubmitted}`,
    );
  });

  it('has no branch level under active branches', async () => {
    expect(
      await notFoundBody(
        getBranchReports(db, s.actors.finance, 'active_branches', s.branches.a.id, {}),
      ),
    ).toEqual(NOT_FOUND_BODY);
  });

  it('gives identical NotFound for an unknown or malformed branch id', async () => {
    const unknown = await notFoundBody(
      getBranchReports(
        db,
        s.actors.finance,
        'approved',
        '0f0f0f0f-0000-4000-8000-000000000000',
        {},
      ),
    );
    const malformed = await notFoundBody(
      getBranchReports(db, s.actors.finance, 'approved', 'not-a-uuid', {}),
    );
    expect(unknown).toEqual(NOT_FOUND_BODY);
    expect(malformed).toEqual(unknown);
  });

  it('returns an empty level for an existing branch with no contribution', async () => {
    for (const figure of ['approved', 'collected', 'routed'] as MoneyFigureId[]) {
      const level = await getBranchReports(db, s.actors.finance, figure, s.branches.c.id, {});
      expect(level.rows).toEqual([]);
      expect(level.total).toBe('0.00');
      expect(level.parentValue).toBe('0.00');
      expect(level.matchesParent).toBe(true);
      expect(level.branch.branchStatus).toBe('paused');
    }
    const count = await getBranchReports(
      db,
      s.actors.finance,
      'reports_awaiting_review',
      s.branches.b.id,
      {},
    );
    expect(count.rows).toEqual([]);
    expect(count.total).toBe('0');
    expect(count.parentValue).toBe('0');
    expect(count.matchesParent).toBe(true);
  });
});

describe('trace access', () => {
  it('forbids branch lead, HR lead and content editor on L1 and L2', async () => {
    const denied: Actor[] = [s.actors.leadA, s.actors.hrA, s.actors.editor];
    for (const actor of denied) {
      await expect(getFigureByBranch(db, actor, 'approved', {})).rejects.toBeInstanceOf(Forbidden);
      await expect(
        getBranchReports(db, actor, 'approved', s.branches.a.id, {}),
      ).rejects.toBeInstanceOf(Forbidden);
      // Authorization runs before any lookup, so a bad id still gives 403, not 404.
      await expect(
        getBranchReports(db, actor, 'approved', 'not-a-uuid', {}),
      ).rejects.toBeInstanceOf(Forbidden);
    }
  });
});
