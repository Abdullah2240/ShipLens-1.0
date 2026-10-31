import { describe, expect, it } from 'vitest';
import { buildTrail } from './trace-trail';

const BRANCH = '11111111-1111-4111-8111-111111111111';
const REPORT = '22222222-2222-4222-8222-222222222222';
const COLLECTION = '33333333-3333-4333-8333-333333333333';

describe('buildTrail', () => {
  it('returns dashboard, figure and branch steps with filters in every href', () => {
    const trail = buildTrail({
      figure: 'approved',
      filters: { from: '2026-09' },
      overview: '250.50',
      branch: { id: BRANCH, code: 'BR-A', name: 'Alpha', value: '250.50' },
    });
    expect(trail).toEqual([
      {
        kind: 'dashboard',
        href: '/dashboard?from=2026-09',
        figure: 'approved',
        measure: 'amount',
        value: '250.50',
      },
      {
        kind: 'figure',
        href: '/dashboard/kpi/approved?from=2026-09',
        figure: 'approved',
        measure: 'amount',
        value: '250.50',
      },
      {
        kind: 'branch',
        href: `/dashboard/kpi/approved/branches/${BRANCH}?from=2026-09`,
        figure: 'approved',
        measure: 'amount',
        value: '250.50',
        branchCode: 'BR-A',
        branchName: 'Alpha',
      },
    ]);
  });

  it('returns only the dashboard and figure steps at L1', () => {
    const trail = buildTrail({ figure: 'collected', filters: {}, overview: '2100.75' });
    expect(trail.map((s) => [s.kind, s.href, s.value])).toEqual([
      ['dashboard', '/dashboard', '2100.75'],
      ['figure', '/dashboard/kpi/collected', '2100.75'],
    ]);
  });

  it('appends report and collection steps carrying their own values', () => {
    const trail = buildTrail({
      figure: 'pending_approval',
      filters: { from: '2026-08', to: '2026-09' },
      overview: '300.00',
      branch: { id: BRANCH, code: 'BR-A', name: 'Alpha', value: '300.00' },
      report: { id: REPORT, weekStart: '2026-09-07', value: '300.00' },
      collection: { id: COLLECTION, collectedOn: '2026-09-08', amount: '300.00' },
    });
    expect(trail).toHaveLength(5);
    expect(trail[3]).toEqual({
      kind: 'report',
      href: `/dashboard/kpi/pending-approval/branches/${BRANCH}/reports/${REPORT}?from=2026-08&to=2026-09`,
      figure: 'pending_approval',
      measure: 'amount',
      value: '300.00',
      weekStart: '2026-09-07',
    });
    expect(trail[4]).toEqual({
      kind: 'collection',
      href: `/dashboard/kpi/pending-approval/branches/${BRANCH}/reports/${REPORT}/collections/${COLLECTION}?from=2026-08&to=2026-09`,
      figure: 'pending_approval',
      measure: 'amount',
      value: '300.00',
      collectedOn: '2026-09-08',
    });
  });

  it('keeps the branch filter on the dashboard and figure steps only', () => {
    const trail = buildTrail({
      figure: 'approved',
      filters: { from: '2026-09', branch: BRANCH },
      overview: '250.50',
      branch: { id: BRANCH, code: 'BR-A', name: 'Alpha', value: '250.50' },
    });
    expect(trail.map((s) => s.href)).toEqual([
      `/dashboard?from=2026-09&branch=${BRANCH}`,
      `/dashboard/kpi/approved?from=2026-09&branch=${BRANCH}`,
      `/dashboard/kpi/approved/branches/${BRANCH}?from=2026-09`,
    ]);
  });

  it('uses the count measure down to the branch for count figures and amounts below', () => {
    const trail = buildTrail({
      figure: 'reports_awaiting_review',
      filters: {},
      overview: '1',
      branch: { id: BRANCH, code: 'BR-A', name: 'Alpha', value: '1' },
      report: { id: REPORT, weekStart: '2026-09-07', value: '300.00' },
    });
    expect(trail.map((s) => [s.kind, s.measure, s.value])).toEqual([
      ['dashboard', 'count', '1'],
      ['figure', 'count', '1'],
      ['branch', 'count', '1'],
      ['report', 'amount', '300.00'],
    ]);
    expect(trail[3]!.href).toBe(
      `/dashboard/kpi/reports-awaiting-review/branches/${BRANCH}/reports/${REPORT}`,
    );
  });

  it('refuses a report without its branch and a collection without its report', () => {
    expect(() =>
      buildTrail({
        figure: 'approved',
        filters: {},
        overview: '0.00',
        report: { id: REPORT, weekStart: '2026-09-07', value: '0.00' },
      }),
    ).toThrow();
    expect(() =>
      buildTrail({
        figure: 'approved',
        filters: {},
        overview: '0.00',
        branch: { id: BRANCH, code: 'BR-A', name: 'Alpha', value: '0.00' },
        collection: { id: COLLECTION, collectedOn: '2026-09-08', amount: '1.00' },
      }),
    ).toThrow();
  });
});
