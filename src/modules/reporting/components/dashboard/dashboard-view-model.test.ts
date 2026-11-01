import { describe, expect, it } from 'vitest';
import {
  FIGURES,
  traceHref,
  type DashboardSummary,
  type FigureId,
  type ReportingFilters,
  type TrendSeries,
} from '@/modules/reporting';
import { sumMoney } from '@/platform/money';
import { buildDashboardModel, overviewFilterChipsInput } from './dashboard-view-model';

const BRANCH = '7d3c1a52-9b8e-4c1f-a2b3-0e5f6a7b8c9d';
const AS_OF = '2026-10-31T10:15:00.000Z';

function figure(id: FigureId, value: string, recordCount: number) {
  return { figure: id, measure: FIGURES[id].measure, value, recordCount };
}

function summaryFor(filters: ReportingFilters): DashboardSummary {
  return {
    asOf: AS_OF,
    filters,
    identities: { collected: true, approved: true },
    figures: {
      collected: figure('collected', '2100.75', 6),
      approved: figure('approved', '1750.50', 3),
      pending_approval: figure('pending_approval', '300.00', 1),
      in_progress: figure('in_progress', '50.25', 2),
      not_yet_routed: figure('not_yet_routed', '1500.00', 2),
      routed: figure('routed', '250.50', 1),
      active_branches: figure('active_branches', '2', 2),
      reports_awaiting_review: figure('reports_awaiting_review', '1', 1),
    },
  };
}

const TREND: TrendSeries = {
  asOf: AS_OF,
  filters: {},
  months: [
    {
      month: '2026-08',
      collected: '1500.00',
      approved: '1500.00',
      pendingApproval: '0.00',
      inProgress: '0.00',
      notYetRouted: '1500.00',
      routed: '0.00',
    },
    {
      month: '2026-09',
      collected: '590.75',
      approved: '250.50',
      pendingApproval: '300.00',
      inProgress: '40.25',
      notYetRouted: '0.00',
      routed: '250.50',
    },
    {
      month: '2026-10',
      collected: '10.00',
      approved: '0.00',
      pendingApproval: '0.00',
      inProgress: '10.00',
      notYetRouted: '0.00',
      routed: '0.00',
    },
  ],
  totals: {
    collected: '2100.75',
    approved: '1750.50',
    pendingApproval: '300.00',
    inProgress: '50.25',
    notYetRouted: '1500.00',
    routed: '250.50',
  },
};

describe('buildDashboardModel', () => {
  const filters: ReportingFilters = { branch: BRANCH };
  const model = buildDashboardModel(summaryFor(filters), TREND, filters);

  it('links every card to its level 1 with the current filters', () => {
    const cards = [
      model.collected,
      model.approved,
      model.pending,
      model.inProgress,
      model.notYetRouted,
      model.routed,
      model.activeBranches,
      model.awaitingReview,
    ];
    expect(cards.map((c) => c.figure)).toEqual([
      'collected',
      'approved',
      'pending_approval',
      'in_progress',
      'not_yet_routed',
      'routed',
      'active_branches',
      'reports_awaiting_review',
    ]);
    for (const card of cards) {
      expect(card.href).toBe(traceHref(card.figure, {}, filters));
      expect(card.href).toContain(`branch=${BRANCH}`);
    }
    expect(model.collected).toEqual({
      figure: 'collected',
      value: '2100.75',
      measure: 'amount',
      recordCount: 6,
      href: `/dashboard/kpi/collected?branch=${BRANCH}`,
    });
    expect(model.activeBranches.measure).toBe('count');
    expect(model.awaitingReview.href).toBe(
      `/dashboard/kpi/reports-awaiting-review?branch=${BRANCH}`,
    );
  });

  it('splits collected and approved into segments that add up to their parent', () => {
    expect(model.collectedSegments.map((s) => s.figure)).toEqual([
      'approved',
      'pending_approval',
      'in_progress',
    ]);
    expect(model.approvedSegments.map((s) => s.figure)).toEqual(['routed', 'not_yet_routed']);
    expect(sumMoney(model.collectedSegments.map((s) => s.amount))).toBe(model.collected.value);
    expect(sumMoney(model.approvedSegments.map((s) => s.amount))).toBe(model.approved.value);
    for (const segment of [...model.collectedSegments, ...model.approvedSegments]) {
      expect(segment.href).toBe(traceHref(segment.figure, {}, filters));
    }
  });

  it('maps trend months to the three status series', () => {
    expect(model.months).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(model.trendPoints[1]).toEqual({
      month: '2026-09',
      values: { approved: '250.50', pending_approval: '300.00', in_progress: '40.25' },
    });
  });

  it('links a trend cell to level 1 for that one month, keeping the branch', () => {
    expect(model.trendHref('2026-09', 'approved')).toBe(
      `/dashboard/kpi/approved?from=2026-09&to=2026-09&branch=${BRANCH}`,
    );
    const unfiltered = buildDashboardModel(summaryFor({}), TREND, {});
    expect(unfiltered.trendHref('2026-09', 'approved')).toBe(
      '/dashboard/kpi/approved?from=2026-09&to=2026-09',
    );
    expect(unfiltered.trendHref('2026-08', 'pending_approval')).toBe(
      '/dashboard/kpi/pending-approval?from=2026-08&to=2026-08',
    );
  });

  it('builds export and print links that carry the filters', () => {
    const ranged: ReportingFilters = { from: '2026-08', to: '2026-09', branch: BRANCH };
    const m = buildDashboardModel(summaryFor(ranged), TREND, ranged);
    expect(m.exportHref('collections', 'ur')).toBe(
      `/api/v1/exports/collections?figure=approved&from=2026-08&to=2026-09&branch=${BRANCH}&locale=ur`,
    );
    expect(m.exportHref('reports', 'en')).toBe(
      `/api/v1/exports/reports?figure=approved&from=2026-08&to=2026-09&branch=${BRANCH}&locale=en`,
    );
    expect(m.exportHref('summary', 'en')).toBe(
      `/api/v1/exports/summary?from=2026-08&to=2026-09&branch=${BRANCH}&locale=en`,
    );
    expect(m.exportHref('unrouted', 'ur')).toBe(
      `/api/v1/exports/unrouted?from=2026-08&to=2026-09&branch=${BRANCH}&locale=ur`,
    );
    expect(m.printHref).toBe(`/dashboard/print?from=2026-08&to=2026-09&branch=${BRANCH}`);
    const bare = buildDashboardModel(summaryFor({}), TREND, {});
    expect(bare.printHref).toBe('/dashboard/print');
    expect(bare.exportHref('summary', 'en')).toBe('/api/v1/exports/summary?locale=en');
  });

  it('describes each figure at the overview level for its drawer', () => {
    expect(model.explain.approved).toEqual({
      figure: 'approved',
      level: 'overview',
      filters,
      recordCount: 3,
      value: '1750.50',
      asOf: AS_OF,
    });
    expect(model.identities).toEqual({ collected: true, approved: true });
    expect(model.asOf).toBe(AS_OF);
  });

  it('ignores invalid filter values passed in', () => {
    const m = buildDashboardModel(summaryFor({}), TREND, { from: '2026-13', branch: 'x' });
    expect(m.collected.href).toBe('/dashboard/kpi/collected');
    expect(m.printHref).toBe('/dashboard/print');
  });
});

describe('overviewFilterChipsInput', () => {
  it('is empty when nothing is filtered and lists months and branch otherwise', () => {
    expect(overviewFilterChipsInput({})).toEqual([]);
    expect(overviewFilterChipsInput({ from: '2026-08', to: '2026-09', branch: BRANCH })).toEqual([
      { kind: 'months', from: '2026-08', to: '2026-09' },
      { kind: 'branch', id: BRANCH },
    ]);
    expect(overviewFilterChipsInput({ branch: BRANCH })).toEqual([
      { kind: 'months' },
      { kind: 'branch', id: BRANCH },
    ]);
    expect(overviewFilterChipsInput({ to: '2026-09', reportId: 'r1' })).toEqual([
      { kind: 'months', to: '2026-09' },
      { kind: 'report', id: 'r1' },
    ]);
  });
});
