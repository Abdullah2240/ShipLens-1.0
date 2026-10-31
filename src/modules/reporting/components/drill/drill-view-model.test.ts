import { describe, expect, it } from 'vitest';
import type { BranchFigureRow, ReportFigureRow } from '@/modules/reporting/trace-types';
import {
  chipsFor,
  exportLinks,
  footerRecordCount,
  frozenNoteKind,
  type ChipLabels,
} from './drill-view-model';

const BRANCH = '7d3c1a52-9b8e-4c1f-a2b3-0e5f6a7b8c9d';
const REPORT = '9a683b03-1111-4c1f-a2b3-0e5f6a7b8c9d';

const LABELS: ChipLabels = {
  from: 'From',
  to: 'To',
  branch: 'Branch',
  allTime: 'All time',
  period: 'Period',
  earliest: 'Earliest',
  latest: 'Latest',
};

describe('chipsFor', () => {
  it('gives one "All time" chip when nothing narrows the figure', () => {
    expect(chipsFor({}, LABELS)).toEqual([{ label: 'Period', value: 'All time' }]);
  });

  it('gives a from chip and an open "To" chip for a from-only range', () => {
    expect(chipsFor({ from: '2026-09' }, LABELS)).toEqual([
      { label: 'From', value: '2026-09' },
      { label: 'To', value: 'Latest' },
    ]);
  });

  it('gives an open "From" chip for a to-only range', () => {
    expect(chipsFor({ to: '2026-10' }, LABELS)).toEqual([
      { label: 'From', value: 'Earliest' },
      { label: 'To', value: '2026-10' },
    ]);
  });

  it('formats months with the given formatter', () => {
    const chips = chipsFor(
      { from: '2026-08', to: '2026-10' },
      { ...LABELS, formatMonth: (m) => `M:${m}` },
    );
    expect(chips).toEqual([
      { label: 'From', value: 'M:2026-08' },
      { label: 'To', value: 'M:2026-10' },
    ]);
  });

  it('falls back to "All time" for an open side without its own label', () => {
    const bare: ChipLabels = { from: 'From', to: 'To', branch: 'Branch', allTime: 'All time' };
    expect(chipsFor({ from: '2026-09' }, bare)[1]).toEqual({ label: 'To', value: 'All time' });
    expect(chipsFor({}, bare)).toEqual([{ label: 'All time', value: 'All time' }]);
  });

  it('passes the branch name through, from the filter or from the path', () => {
    expect(chipsFor({ branch: BRANCH }, LABELS, { branch: 'Lahore Central' })).toEqual([
      { label: 'Period', value: 'All time' },
      { label: 'Branch', value: 'Lahore Central' },
    ]);
    expect(
      chipsFor({ from: '2026-09', to: '2026-09', branchId: BRANCH }, LABELS, {
        branch: 'Multan',
      }),
    ).toEqual([
      { label: 'From', value: '2026-09' },
      { label: 'To', value: '2026-09' },
      { label: 'Branch', value: 'Multan' },
    ]);
  });

  it('shows the short branch id when the name is unknown', () => {
    expect(chipsFor({ branchId: BRANCH }, LABELS)[1]).toEqual({
      label: 'Branch',
      value: '7d3c1a52',
    });
  });

  it('drops malformed months instead of showing them', () => {
    expect(chipsFor({ from: 'bogus' }, LABELS)).toEqual([{ label: 'Period', value: 'All time' }]);
  });
});

describe('exportLinks', () => {
  it('carries the figure, the month filter and the path branch at the reports level', () => {
    expect(
      exportLinks('reports', 'approved', { from: '2026-09' }, { branchId: BRANCH }, 'en'),
    ).toEqual({
      reports: `/api/v1/exports/reports?figure=approved&from=2026-09&branch=${BRANCH}&locale=en`,
      collections: `/api/v1/exports/collections?figure=approved&from=2026-09&branch=${BRANCH}&locale=en`,
    });
  });

  it('keeps the branch filter at the branches level and uses the figure slug', () => {
    const links = exportLinks(
      'branches',
      'pending_approval',
      { from: '2026-08', to: '2026-10', branch: BRANCH },
      {},
      'ur',
    );
    expect(links.reports).toBe(
      `/api/v1/exports/reports?figure=pending-approval&from=2026-08&to=2026-10&branch=${BRANCH}&locale=ur`,
    );
    expect(links.collections).toBe(
      `/api/v1/exports/collections?figure=pending-approval&from=2026-08&to=2026-10&branch=${BRANCH}&locale=ur`,
    );
  });

  it('lets the path branch win over a branch filter below level 1', () => {
    const other = '11111111-2222-4333-8444-555555555555';
    expect(
      exportLinks('reports', 'approved', { branch: other }, { branchId: BRANCH }, 'en').reports,
    ).toBe(`/api/v1/exports/reports?figure=approved&branch=${BRANCH}&locale=en`);
  });

  it('offers only the collections export for one report', () => {
    expect(
      exportLinks('collections', 'routed', {}, { branchId: BRANCH, reportId: REPORT }, 'en'),
    ).toEqual({
      collections: `/api/v1/exports/collections?figure=routed&branch=${BRANCH}&reportId=${REPORT}&locale=en`,
    });
  });

  it('maps count figures onto the money figure behind their rows', () => {
    expect(exportLinks('branches', 'reports_awaiting_review', {}, {}, 'en').reports).toBe(
      '/api/v1/exports/reports?figure=pending-approval&locale=en',
    );
    expect(exportLinks('branches', 'active_branches', {}, {}, 'en').collections).toBe(
      '/api/v1/exports/collections?figure=approved&locale=en',
    );
  });

  it('never lets a locale outside en and ur into the link', () => {
    expect(exportLinks('branches', 'approved', {}, {}, 'fr').reports).toBe(
      '/api/v1/exports/reports?figure=approved&locale=en',
    );
  });
});

function branchRow(over: Partial<BranchFigureRow>): BranchFigureRow {
  return {
    branchId: BRANCH,
    branchCode: 'LHR-01',
    branchName: 'Lahore',
    branchStatus: 'active',
    value: '10.00',
    recordCount: 2,
    reportCount: 1,
    href: '/x',
    ...over,
  };
}

describe('footerRecordCount', () => {
  it('counts the collections behind a money level, not the branches', () => {
    const rows = [branchRow({ recordCount: 2 }), branchRow({ recordCount: 5 })];
    expect(footerRecordCount('branches', 'amount', rows, 2)).toBe(7);
    expect(footerRecordCount('reports', 'amount', rows, 2)).toBe(7);
  });

  it('counts the reports behind reports awaiting review at level 1', () => {
    const rows = [branchRow({ recordCount: 2 }), branchRow({ recordCount: 1 })];
    expect(footerRecordCount('branches', 'count', rows, 2)).toBe(3);
  });

  it('counts the rows (reports) of a count figure at level 2', () => {
    expect(footerRecordCount('reports', 'count', [branchRow({ recordCount: 4 })], 1)).toBe(1);
  });
});

function reportRow(over: Partial<ReportFigureRow>): ReportFigureRow {
  return {
    reportId: REPORT,
    weekStart: '2026-08-31',
    weekEnd: '2026-09-06',
    status: 'approved',
    value: '1250.50',
    recordCount: 2,
    frozenAmount: '1250.50',
    frozenCount: 2,
    submittedAt: '2026-09-07T10:00:00.000Z',
    reviewedAt: '2026-09-08T10:00:00.000Z',
    href: '/x',
    ...over,
  };
}

describe('frozenNoteKind', () => {
  it('is null when the frozen total equals the value or was never set', () => {
    expect(frozenNoteKind(reportRow({}))).toBeNull();
    expect(frozenNoteKind(reportRow({ status: 'draft', frozenAmount: null }))).toBeNull();
    expect(frozenNoteKind(reportRow({ value: '1250.5' }))).toBeNull();
  });

  it('explains a submitted or approved report counted for part of its week', () => {
    expect(frozenNoteKind(reportRow({ value: '1000.00' }))).toBe('wholeWeek');
    expect(frozenNoteKind(reportRow({ status: 'submitted', value: '250.50' }))).toBe('wholeWeek');
  });

  it('explains a returned report whose frozen total predates its changes', () => {
    expect(frozenNoteKind(reportRow({ status: 'returned', value: '900.00' }))).toBe(
      'lastSubmission',
    );
  });
});
