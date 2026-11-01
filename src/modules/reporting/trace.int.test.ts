import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getCollectionTimeline, getReportTimeline } from '@/modules/timeline';
import type { Actor } from '@/platform/authz';
import { Forbidden, NotFound, mapError } from '@/platform/errors';
import { closeTestPool, resetDb, testPool } from '../../../tests/support/db';
import {
  SCENARIO_EXPECTED,
  SCENARIO_ROUTED_AT,
  buildReportingScenario,
  type ReportingScenario,
} from '../../../tests/support/reporting-fixtures';
import { MONEY_FIGURES } from './figures';
import {
  getBranchReports,
  getCollectionEvidence,
  getFigureByBranch,
  getReportCollections,
} from './service-trace';
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
  }, 120_000);

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
  }, 120_000);

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

const RANDOM_UUID = '0f0f0f0f-0000-4000-8000-000000000000';

/** Report events written the way the report service writes them, at fixed instants. */
async function seedReportEvents(reportId: string) {
  await db.query(
    `INSERT INTO report_events (report_id, event_type, from_status, to_status, actor_id, reason, occurred_at)
     VALUES ($1, 'submitted', 'draft', 'submitted', $2, NULL, '2026-09-07T05:00:00Z'),
            ($1, 'approved', 'submitted', 'approved', $3, NULL, '2026-09-08T05:00:00Z')`,
    [reportId, s.users.leadA.id, s.users.finance.id],
  );
}

type AuditSeed = {
  at: string;
  actor: { id: string; role: string };
  action: string;
  entityType: 'collection' | 'report';
  entityId: string;
  reportId: string;
  after?: Record<string, unknown>;
};

async function seedAudit(rows: AuditSeed[]) {
  for (const r of rows) {
    await db.query(
      `INSERT INTO audit_events
         (occurred_at, request_id, actor_id, actor_role, action, entity_type, entity_id, branch_id, report_id, before, after)
       VALUES ($1, 'req-test', $2, $3, $4, $5, $6, $7, $8, NULL, $9)`,
      [
        r.at,
        r.actor.id,
        r.actor.role,
        r.action,
        r.entityType,
        r.entityId,
        s.branches.a.id,
        r.reportId,
        JSON.stringify(r.after ?? {}),
      ],
    );
  }
}

/** An approved report of branch B with `n` collections of 2.50 each, bulk inserted. */
async function seedLargeApprovedReport(n: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, '2026-10-12') RETURNING id`,
    [s.branches.b.id],
  );
  const reportId = rows[0]!.id;
  await db.query(
    `INSERT INTO collections (branch_id, report_id, amount, collected_on, purpose, created_by)
     SELECT $1, $2, 2.50, DATE '2026-10-12' + (i % 7), 'Bulk ' || i, $3
       FROM generate_series(1, $4::int) AS i`,
    [s.branches.b.id, reportId, s.users.leadB.id, n],
  );
  await db.query(
    `UPDATE weekly_reports
        SET status = 'submitted', submitted_at = now(), submitted_by = $2,
            total_amount = (SELECT SUM(amount) FROM collections WHERE report_id = $1),
            collection_count = $3, version = version + 1, updated_at = now()
      WHERE id = $1`,
    [reportId, s.users.leadB.id, n],
  );
  await db.query(
    `UPDATE weekly_reports
        SET status = 'approved', reviewed_at = now(), reviewed_by = $2, version = version + 1, updated_at = now()
      WHERE id = $1`,
    [reportId, s.users.finance.id],
  );
  return reportId;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (e: unknown) => e,
  );
}

describe('getReportCollections (L3)', () => {
  it('lists the active collections of an approved report, not the voided one', async () => {
    await seedReportEvents(s.reports.aApproved);
    const level = await getReportCollections(
      db,
      s.actors.finance,
      'approved',
      s.branches.a.id,
      s.reports.aApproved,
      {},
    );
    expect(level.level).toBe('collections');
    expect(level.measure).toBe('amount');
    const base = `/dashboard/kpi/approved/branches/${s.branches.a.id}/reports/${s.reports.aApproved}`;
    expect(level.rows).toEqual([
      {
        collectionId: s.collections.a1000,
        collectedOn: '2026-08-31',
        purpose: 'Food parcels',
        amount: '1000.00',
        routedAt: null,
        href: `${base}/collections/${s.collections.a1000}`,
      },
      {
        collectionId: s.collections.a250,
        collectedOn: '2026-09-01',
        purpose: 'School fees',
        amount: '250.50',
        routedAt: SCENARIO_ROUTED_AT,
        href: `${base}/collections/${s.collections.a250}`,
      },
    ]);
    expect(level.total).toBe('1250.50');
    expect(level.parentValue).toBe('1250.50');
    expect(level.recordCount).toBe(2);
    expect(level.matchesParent).toBe(true);
    expect(level.truncated).toBeNull();
    expect(level.report).toEqual({
      reportId: s.reports.aApproved,
      weekStart: '2026-08-31',
      weekEnd: '2026-09-06',
      status: 'approved',
      liveAmount: '1250.50',
      liveCount: 2,
      frozenAmount: '1250.50',
      frozenCount: 2,
      frozenMatchesLive: true,
      submittedAt: expect.stringMatching(ISO),
      submittedByName: 'Lead Alpha',
      reviewedAt: expect.stringMatching(ISO),
      reviewedByName: 'Faraz Finance',
      returnReason: null,
    });
    expect(level.reportEvents).toEqual([
      {
        id: expect.any(String),
        type: 'submitted',
        fromStatus: 'draft',
        toStatus: 'submitted',
        actorName: 'Lead Alpha',
        reason: null,
        occurredAt: '2026-09-07T05:00:00.000Z',
      },
      {
        id: expect.any(String),
        type: 'approved',
        fromStatus: 'submitted',
        toStatus: 'approved',
        actorName: 'Faraz Finance',
        reason: null,
        occurredAt: '2026-09-08T05:00:00.000Z',
      },
    ]);
    expect(level.branch.branchCode).toBe('BR-A');
    expect(level.explain).toEqual({
      figure: 'approved',
      level: 'collections',
      filters: { branchId: s.branches.a.id, reportId: s.reports.aApproved },
      recordCount: 2,
      value: '1250.50',
      asOf: level.asOf,
    });
    expect(level.asOf).toMatch(ISO);
    expect(level.trail.map((t) => [t.kind, t.value])).toEqual([
      ['dashboard', '1750.50'],
      ['figure', '1750.50'],
      ['branch', '1250.50'],
      ['report', '1250.50'],
    ]);
  });

  it('applies the month filter to the collections and still matches the report row', async () => {
    const f = { from: '2026-09', to: '2026-09' };
    const level = await getReportCollections(
      db,
      s.actors.finance,
      'approved',
      s.branches.a.id,
      s.reports.aApproved,
      f,
    );
    expect(level.rows.map((r) => r.collectionId)).toEqual([s.collections.a250]);
    expect(level.total).toBe('250.50');
    expect(level.parentValue).toBe('250.50');
    expect(level.matchesParent).toBe(true);
    // The header always describes the whole report.
    expect(level.report.liveAmount).toBe('1250.50');
    expect(level.rows[0]!.href).toMatch(/\?from=2026-09&to=2026-09$/);
  });

  it('shows frozenMatchesLive only for submitted and approved reports', async () => {
    const returned = await getReportCollections(
      db,
      s.actors.finance,
      'in_progress',
      s.branches.a.id,
      s.reports.aReturned,
      {},
    );
    expect(returned.rows.map((r) => r.amount)).toEqual(['40.25']);
    expect(returned.report.status).toBe('returned');
    expect(returned.report.frozenMatchesLive).toBeNull();
    expect(returned.report.returnReason).toBe('Fixture return');
    const draft = await getReportCollections(
      db,
      s.actors.finance,
      'collected',
      s.branches.a.id,
      s.reports.aDraft,
      {},
    );
    expect(draft.report.frozenAmount).toBeNull();
    expect(draft.report.frozenMatchesLive).toBeNull();
    expect(draft.report.submittedByName).toBeNull();
  });

  it('lists the collections of a submitted report under reports awaiting review', async () => {
    const level = await getReportCollections(
      db,
      s.actors.finance,
      'reports_awaiting_review',
      s.branches.a.id,
      s.reports.aSubmitted,
      {},
    );
    expect(level.figure).toBe('reports_awaiting_review');
    expect(level.slug).toBe('reports-awaiting-review');
    expect(level.measure).toBe('amount');
    expect(level.rows.map((r) => [r.collectionId, r.amount])).toEqual([
      [s.collections.a300, '300.00'],
    ]);
    expect(level.total).toBe('300.00');
    expect(level.parentValue).toBe('300.00');
    expect(level.matchesParent).toBe(true);
    expect(level.report.frozenMatchesLive).toBe(true);
    expect(level.trail.map((t) => [t.kind, t.measure, t.value])).toEqual([
      ['dashboard', 'count', '1'],
      ['figure', 'count', '1'],
      ['branch', 'count', '1'],
      ['report', 'amount', '300.00'],
    ]);
  });

  it('truncates at 500 rows while total and recordCount cover every row', async () => {
    const reportId = await seedLargeApprovedReport(501);
    const level = await getReportCollections(
      db,
      s.actors.finance,
      'approved',
      s.branches.b.id,
      reportId,
      {},
    );
    expect(level.rows).toHaveLength(500);
    expect(level.truncated).toEqual({ shown: 500 });
    // 501 x 2.50, computed by hand.
    expect(level.total).toBe('1252.50');
    expect(level.recordCount).toBe(501);
    expect(level.parentValue).toBe('1252.50');
    expect(level.matchesParent).toBe(true);
    expect(level.explain.recordCount).toBe(501);
    expect(level.explain.value).toBe('1252.50');
    expect(level.report.frozenMatchesLive).toBe(true);
    // The 501st collection is still reachable at L4.
    const all = await db.query<{ id: string }>(
      'SELECT id FROM collections WHERE report_id = $1 ORDER BY collected_on DESC, id DESC LIMIT 1',
      [reportId],
    );
    const last = all.rows[0]!.id;
    expect(level.rows.some((r) => r.collectionId === last)).toBe(false);
    const evidence = await getCollectionEvidence(
      db,
      s.actors.finance,
      'approved',
      s.branches.b.id,
      reportId,
      last,
      {},
    );
    expect(evidence.collection.amount).toBe('2.50');
  });
});

describe('proof chain', () => {
  it('refuses every broken path with the identical NotFound', async () => {
    const fin = s.actors.finance;
    const a = s.branches.a.id;
    const b = s.branches.b.id;
    const r = s.reports;
    const c = s.collections;
    const l3 = (figure: FigureId, branchId: string, reportId: string, f: ReportingFilters = {}) =>
      getReportCollections(db, fin, figure, branchId, reportId, f);
    const l4 = (
      figure: FigureId,
      branchId: string,
      reportId: string,
      collectionId: string,
      f: ReportingFilters = {},
    ) => getCollectionEvidence(db, fin, figure, branchId, reportId, collectionId, f);
    const attempts: [string, () => Promise<unknown>][] = [
      ['draft report under approved', () => l3('approved', a, r.aDraft)],
      ['B approved report under branch A', () => l3('approved', a, r.bApproved)],
      ['A approved report under branch B', () => l3('approved', b, r.aApproved)],
      ['unknown report', () => l3('approved', a, RANDOM_UUID)],
      ['malformed report', () => l3('approved', a, 'not-a-uuid')],
      ['unknown branch', () => l3('approved', RANDOM_UUID, r.aApproved)],
      ['malformed branch', () => l3('approved', 'nope', r.aApproved)],
      [
        'report outside the month filter',
        () => l3('approved', a, r.aApproved, { from: '2026-10' }),
      ],
      [
        'approved report under awaiting review',
        () => l3('reports_awaiting_review', a, r.aApproved),
      ],
      [
        'submitted report outside the week filter',
        () => l3('reports_awaiting_review', a, r.aSubmitted, { from: '2026-10' }),
      ],
      ['nil report under approved', () => l3('approved', b, r.bNil)],
      ['L3 under active branches', () => l3('active_branches', a, r.aApproved)],
      ['unknown figure', () => l3('bogus' as FigureId, a, r.aApproved)],
      ['another report collection', () => l4('approved', a, r.aApproved, c.a300)],
      ['voided collection under collected', () => l4('collected', a, r.aApproved, c.aVoid999)],
      [
        'collection outside the month filter',
        () => l4('approved', a, r.aApproved, c.a1000, { from: '2026-09' }),
      ],
      [
        'routed collection under not yet routed',
        () => l4('not_yet_routed', a, r.aApproved, c.a250),
      ],
      ['unrouted collection under routed', () => l4('routed', a, r.aApproved, c.a1000)],
      ['B collection under A path', () => l4('approved', a, r.aApproved, c.b500)],
      ['unknown collection', () => l4('approved', a, r.aApproved, RANDOM_UUID)],
      ['malformed collection', () => l4('approved', a, r.aApproved, 'x')],
      ['collection under a draft report path', () => l4('approved', a, r.aDraft, c.a10)],
      ['L4 under active branches', () => l4('active_branches', a, r.aApproved, c.a1000)],
    ];
    for (const [label, attempt] of attempts) {
      const err = await caught(attempt());
      expect(err, label).toBeInstanceOf(NotFound);
      expect(mapError(err, 'req').body, label).toEqual(NOT_FOUND_BODY);
    }
  });

  // Thousands of snapshot reads: well over the default per-test timeout on a shared machine.
  it('L4 opens exactly the collections L3 lists, for every figure, filter set and report', async () => {
    const everyCollection = Object.values(s.collections);
    let opened = 0;
    for (const f of FILTER_SETS) {
      for (const figure of ALL_FIGURES.filter((id) => id !== 'active_branches')) {
        const l1 = await getFigureByBranch(db, s.actors.finance, figure, f);
        for (const branchRow of l1.rows) {
          const l2 = await getBranchReports(db, s.actors.finance, figure, branchRow.branchId, f);
          for (const reportRow of l2.rows) {
            const label = `${figure} ${reportRow.weekStart} ${JSON.stringify(f)}`;
            const l3 = await getReportCollections(
              db,
              s.actors.finance,
              figure,
              branchRow.branchId,
              reportRow.reportId,
              f,
            );
            expect(l3.parentValue, label).toBe(reportRow.value);
            expect(l3.total, label).toBe(reportRow.value);
            expect(l3.recordCount, label).toBe(reportRow.recordCount);
            expect(l3.matchesParent, label).toBe(true);
            expect(
              l3.trail.map((t) => t.value),
              label,
            ).toEqual([l1.parentValue, l1.parentValue, branchRow.value, reportRow.value]);
            expect(l3.trail[3]!.href, label).toBe(reportRow.href);
            const listed = new Map(l3.rows.map((row) => [row.collectionId, row]));
            for (const collectionId of everyCollection) {
              const attempt = getCollectionEvidence(
                db,
                s.actors.finance,
                figure,
                branchRow.branchId,
                reportRow.reportId,
                collectionId,
                f,
              );
              const row = listed.get(collectionId);
              if (row) {
                const evidence = await attempt;
                expect(evidence.collection.amount, label).toBe(row.amount);
                expect(evidence.explain.value, label).toBe(row.amount);
                expect(
                  evidence.trail.map((t) => t.value),
                  label,
                ).toEqual([
                  l1.parentValue,
                  l1.parentValue,
                  branchRow.value,
                  reportRow.value,
                  row.amount,
                ]);
                expect(evidence.trail[4]!.href, label).toBe(row.href);
                opened += 1;
              } else {
                expect(await caught(attempt), `${label} ${collectionId}`).toBeInstanceOf(NotFound);
              }
            }
          }
        }
      }
    }
    expect(opened).toBeGreaterThan(20);
  }, 300_000);
});

describe('getCollectionEvidence (L4)', () => {
  it('returns the collection, report header, events and both audit timelines', async () => {
    await seedReportEvents(s.reports.aApproved);
    const lead = { id: s.users.leadA.id, role: 'branch_lead' };
    const finance = { id: s.users.finance.id, role: 'finance_reviewer' };
    await seedAudit([
      {
        at: '2026-09-01T04:00:00Z',
        actor: lead,
        action: 'collection.create',
        entityType: 'collection',
        entityId: s.collections.a1000,
        reportId: s.reports.aApproved,
        after: { amount: '1000.00' },
      },
      {
        at: '2026-09-01T05:00:00Z',
        actor: lead,
        action: 'collection.create',
        entityType: 'collection',
        entityId: s.collections.a250,
        reportId: s.reports.aApproved,
        after: { amount: '250.50' },
      },
      {
        at: '2026-09-07T05:00:00Z',
        actor: lead,
        action: 'report.submit',
        entityType: 'report',
        entityId: s.reports.aApproved,
        reportId: s.reports.aApproved,
        after: { status: 'submitted' },
      },
      {
        at: '2026-09-10T06:00:00Z',
        actor: finance,
        action: 'collection.mark_routed',
        entityType: 'collection',
        entityId: s.collections.a250,
        reportId: s.reports.aApproved,
        after: { routed_at: SCENARIO_ROUTED_AT },
      },
      {
        at: '2026-09-08T05:00:00Z',
        actor: finance,
        action: 'report.approve',
        entityType: 'report',
        entityId: s.reports.aApproved,
        reportId: s.reports.aApproved,
        after: { status: 'approved' },
      },
      {
        at: '2026-09-08T06:00:00Z',
        actor: lead,
        action: 'report.submit',
        entityType: 'report',
        entityId: s.reports.aSubmitted,
        reportId: s.reports.aSubmitted,
        after: { status: 'submitted' },
      },
    ]);

    const evidence = await getCollectionEvidence(
      db,
      s.actors.finance,
      'approved',
      s.branches.a.id,
      s.reports.aApproved,
      s.collections.a250,
      {},
    );
    expect(evidence.figure).toBe('approved');
    expect(evidence.slug).toBe('approved');
    expect(evidence.collection).toEqual({
      collectionId: s.collections.a250,
      amount: '250.50',
      collectedOn: '2026-09-01',
      purpose: 'School fees',
      status: 'active',
      voidReason: null,
      routedAt: SCENARIO_ROUTED_AT,
      routedByName: 'Faraz Finance',
      createdAt: expect.stringMatching(ISO),
      createdByName: 'Lead Alpha',
    });
    expect(evidence.branch).toEqual({
      branchId: s.branches.a.id,
      branchCode: 'BR-A',
      branchName: 'Alpha',
      branchStatus: 'active',
      city: 'Lahore',
    });
    expect(evidence.report.reportId).toBe(s.reports.aApproved);
    expect(evidence.report.frozenMatchesLive).toBe(true);
    expect(evidence.reportEvents.map((e) => [e.type, e.actorName])).toEqual([
      ['submitted', 'Lead Alpha'],
      ['approved', 'Faraz Finance'],
    ]);

    expect(
      evidence.collectionTimeline.map((e) => [e.action, e.entityId, e.actorName, e.occurredAt]),
    ).toEqual([
      ['collection.create', s.collections.a250, 'Lead Alpha', '2026-09-01T05:00:00.000Z'],
      ['collection.mark_routed', s.collections.a250, 'Faraz Finance', '2026-09-10T06:00:00.000Z'],
    ]);
    expect(evidence.reportTimeline.map((e) => [e.action, e.actorName, e.occurredAt])).toEqual([
      ['collection.create', 'Lead Alpha', '2026-09-01T04:00:00.000Z'],
      ['collection.create', 'Lead Alpha', '2026-09-01T05:00:00.000Z'],
      ['report.submit', 'Lead Alpha', '2026-09-07T05:00:00.000Z'],
      ['report.approve', 'Faraz Finance', '2026-09-08T05:00:00.000Z'],
      ['collection.mark_routed', 'Faraz Finance', '2026-09-10T06:00:00.000Z'],
    ]);
    expect(evidence.collectionTimeline).toEqual(
      await getCollectionTimeline(db, s.actors.finance, s.collections.a250),
    );
    expect(evidence.reportTimeline).toEqual(
      await getReportTimeline(db, s.actors.finance, s.reports.aApproved),
    );

    expect(evidence.explain).toEqual({
      figure: 'approved',
      level: 'collection',
      filters: {
        branchId: s.branches.a.id,
        reportId: s.reports.aApproved,
        collectionId: s.collections.a250,
      },
      recordCount: 1,
      value: '250.50',
      asOf: evidence.asOf,
    });
    expect(evidence.asOf).toMatch(ISO);
    expect(evidence.trail.map((t) => [t.kind, t.value])).toEqual([
      ['dashboard', '1750.50'],
      ['figure', '1750.50'],
      ['branch', '1250.50'],
      ['report', '1250.50'],
      ['collection', '250.50'],
    ]);
    expect(evidence.trail[4]).toMatchObject({ collectedOn: '2026-09-01', measure: 'amount' });
  });

  it('opens a submitted collection under reports awaiting review, ignoring collection months', async () => {
    const evidence = await getCollectionEvidence(
      db,
      s.actors.superAdmin,
      'reports_awaiting_review',
      s.branches.a.id,
      s.reports.aSubmitted,
      s.collections.a300,
      { from: '2026-09', to: '2026-09' },
    );
    expect(evidence.collection.amount).toBe('300.00');
    expect(evidence.collectionTimeline).toEqual([]);
    expect(evidence.explain.filters).toEqual({
      from: '2026-09',
      to: '2026-09',
      branchId: s.branches.a.id,
      reportId: s.reports.aSubmitted,
      collectionId: s.collections.a300,
    });
  });

  it('forbids branch lead, HR lead and content editor on L3 and L4', async () => {
    for (const actor of [s.actors.leadA, s.actors.hrA, s.actors.editor]) {
      await expect(
        getReportCollections(db, actor, 'approved', s.branches.a.id, s.reports.aApproved, {}),
      ).rejects.toBeInstanceOf(Forbidden);
      await expect(
        getCollectionEvidence(
          db,
          actor,
          'approved',
          s.branches.a.id,
          s.reports.aApproved,
          s.collections.a1000,
          {},
        ),
      ).rejects.toBeInstanceOf(Forbidden);
    }
  });
});
