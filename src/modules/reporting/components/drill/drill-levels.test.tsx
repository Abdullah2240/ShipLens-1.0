// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../../tests/support/render-intl';
import type {
  BranchFigureRow,
  BranchHeader,
  ReportFigureRow,
  TraceLevel,
} from '@/modules/reporting/trace-types';
import type { FigureId } from '@/modules/reporting/types';
import { BranchFigureTable, DrillExportLinks } from './BranchFigureTable';
import { AutoDate, ReportFigureTable } from './ReportFigureTable';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.setConfig({ testTimeout: 20000 });

const LOCALES = ['en', 'ur'] as const;
const NAMESPACES = ['common', 'trace', 'drilldown', 'dashboard'];
const AS_OF = '2026-10-31T10:15:00.000Z';
const A = '7d3c1a52-9b8e-4c1f-a2b3-0e5f6a7b8c9d';
const B = '0b1c2d3e-4f50-4a1b-8c2d-3e4f5a6b7c8d';
const R1 = '9a683b03-1111-4c1f-a2b3-0e5f6a7b8c9d';
const R2 = '9a683b03-2222-4c1f-a2b3-0e5f6a7b8c9d';
const R3 = '9a683b03-3333-4c1f-a2b3-0e5f6a7b8c9d';
const R4 = '9a683b03-4444-4c1f-a2b3-0e5f6a7b8c9d';

const COPY = {
  en: {
    total: (n: number) => new RegExp(`Total of ${n} records?`),
    matches: 'Matches',
    mismatch: 'Does not match',
    approvedShort: 'Approved',
    viewApproved: 'View approved',
    emptyL1: 'No branch adds to this figure',
    emptyL2: 'No weekly reports behind this figure',
    active: 'Active',
    paused: 'Paused',
    wholeWeek: 'Whole week',
    lastSubmission: 'At last submission',
    notYet: 'Not yet',
    awaitingHeader: 'Awaiting review',
    approvedReports: 'Approved reports',
  },
  ur: {
    total: (n: number) => new RegExp(`${n} ریکارڈز? کا میزان`),
    matches: 'کے مطابق',
    mismatch: 'کے مطابق نہیں',
    approvedShort: 'منظور شدہ',
    viewApproved: 'منظور شدہ دیکھیں',
    emptyL1: 'کوئی شاخ اس عدد میں شامل نہیں',
    emptyL2: 'اس عدد کے پیچھے کوئی ہفتہ وار رپورٹ نہیں',
    active: 'فعال',
    paused: 'موقوف',
    wholeWeek: 'پورا ہفتہ',
    lastSubmission: 'آخری بار جمع کراتے وقت',
    notYet: 'ابھی نہیں',
    awaitingHeader: 'منتظرِ جائزہ',
    approvedReports: 'منظور شدہ رپورٹیں',
  },
} as const;

function l1<R>(figure: FigureId, rows: R[], over: Partial<TraceLevel<R>> = {}): TraceLevel<R> {
  const measure =
    figure === 'active_branches' || figure === 'reports_awaiting_review' ? 'count' : 'amount';
  return {
    figure,
    slug: figure.replace(/_/g, '-'),
    measure,
    level: 'branches',
    parentValue: '0.00',
    rows,
    total: '0.00',
    recordCount: rows.length,
    matchesParent: true,
    truncated: null,
    explain: {
      figure,
      level: 'branches',
      filters: {},
      recordCount: rows.length,
      value: '0',
      asOf: AS_OF,
    },
    asOf: AS_OF,
    trail: [],
    ...over,
  };
}

function branchRow(over: Partial<BranchFigureRow>): BranchFigureRow {
  return {
    branchId: A,
    branchCode: 'LHR-01',
    branchName: 'Lahore Central',
    branchStatus: 'active',
    value: '1250.50',
    recordCount: 2,
    reportCount: 1,
    href: `/dashboard/kpi/approved/branches/${A}?from=2026-09`,
    ...over,
  };
}

const APPROVED_ROWS = [
  branchRow({}),
  branchRow({
    branchId: B,
    branchCode: 'KHI-02',
    branchName: 'Karachi East',
    branchStatus: 'paused',
    value: '500.00',
    recordCount: 3,
    reportCount: 2,
    href: `/dashboard/kpi/approved/branches/${B}?from=2026-09`,
  }),
];

const APPROVED_L1 = l1('approved', APPROVED_ROWS, {
  parentValue: '1750.50',
  total: '1750.50',
});

const BRANCH: BranchHeader = {
  branchId: A,
  branchCode: 'LHR-01',
  branchName: 'Lahore Central',
  branchStatus: 'active',
  city: 'Lahore',
};

function reportRow(over: Partial<ReportFigureRow>): ReportFigureRow {
  return {
    reportId: R1,
    weekStart: '2026-08-31',
    weekEnd: '2026-09-06',
    status: 'approved',
    value: '1000.00',
    recordCount: 1,
    frozenAmount: '1000.00',
    frozenCount: 1,
    submittedAt: '2026-09-07T10:00:00.000Z',
    reviewedAt: '2026-09-08T10:00:00.000Z',
    href: `/dashboard/kpi/approved/branches/${A}/reports/${R1}?from=2026-09`,
    ...over,
  };
}

const L2_ROWS = [
  reportRow({}),
  // Approved, but only part of its week falls in the selected months.
  reportRow({
    reportId: R2,
    weekStart: '2026-09-28',
    weekEnd: '2026-10-04',
    value: '150.50',
    frozenAmount: '400.00',
    href: `/x/${R2}`,
  }),
  // Returned after a submission and changed since.
  reportRow({
    reportId: R3,
    status: 'returned',
    value: '100.00',
    frozenAmount: '80.00',
    reviewedAt: '2026-09-20T10:00:00.000Z',
    href: `/x/${R3}`,
  }),
  // Draft: never submitted.
  reportRow({
    reportId: R4,
    status: 'draft',
    value: '0.00',
    recordCount: 0,
    frozenAmount: null,
    frozenCount: null,
    submittedAt: null,
    reviewedAt: null,
    href: `/x/${R4}`,
  }),
];

function l2(rows: ReportFigureRow[], over: Partial<TraceLevel<ReportFigureRow>> = {}) {
  return {
    ...l1<ReportFigureRow>('approved', rows, {
      level: 'reports',
      parentValue: '1250.50',
      total: '1250.50',
    }),
    ...over,
    branch: BRANCH,
  };
}

function expectLogical(container: HTMLElement) {
  expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
}

function footerOf(container: HTMLElement): HTMLElement {
  const foot = container.querySelector('tfoot');
  expect(foot).not.toBeNull();
  return foot as HTMLElement;
}

describe.each(LOCALES)('BranchFigureTable (%s)', (locale) => {
  const C = COPY[locale];
  const render = (ui: React.ReactElement) => renderWithIntl(ui, { locale, namespaces: NAMESPACES });

  it('lists each branch with code, name, status, counts and a linked amount', () => {
    const { container } = render(<BranchFigureTable level={APPROVED_L1} />);
    expect(container.getAttribute('dir')).toBe(locale === 'ur' ? 'rtl' : 'ltr');
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    const first = within(rows[0] as HTMLElement);
    expect(first.getByText('Lahore Central')).toBeTruthy();
    expect(first.getByText('LHR-01')).toBeTruthy();
    expect(first.getByText(C.active)).toBeTruthy();
    const link = first.getByRole('link');
    expect(link.getAttribute('href')).toBe(APPROVED_ROWS[0]?.href);
    expect(link.textContent).toContain('PKR 1,250.50');
    expect(link.getAttribute('aria-label')).toContain('Lahore Central');
    expect(link.getAttribute('aria-label')).toContain('PKR 1,250.50');
    expect(within(rows[1] as HTMLElement).getByText(C.paused)).toBeTruthy();
    expectLogical(container);
  });

  it('footer: total, collections behind it and a Matches pill naming the figure', () => {
    const { container } = render(<BranchFigureTable level={APPROVED_L1} />);
    const foot = footerOf(container);
    expect(foot.textContent).toMatch(C.total(5));
    expect(foot.textContent).toContain('PKR 1,750.50');
    const pill = foot.querySelector('[data-tone]');
    expect(pill?.getAttribute('data-tone')).toBe('success');
    expect(pill?.textContent).toContain(C.matches);
    expect(pill?.textContent).toContain(C.approvedShort);
  });

  it('shows a danger pill when the level does not match its parent', () => {
    const { container } = render(
      <BranchFigureTable level={{ ...APPROVED_L1, matchesParent: false }} />,
    );
    const pill = footerOf(container).querySelector('[data-tone]');
    expect(pill?.getAttribute('data-tone')).toBe('danger');
    expect(pill?.textContent).toContain(C.mismatch);
  });

  it('shows integer counts for reports awaiting review', () => {
    const rows = [
      branchRow({
        value: '2',
        recordCount: 2,
        reportCount: 2,
        href: `/dashboard/kpi/reports-awaiting-review/branches/${A}`,
      }),
      branchRow({
        branchId: B,
        branchCode: 'KHI-02',
        branchName: 'Karachi East',
        value: '1',
        recordCount: 1,
        reportCount: 1,
        href: '/k',
      }),
    ];
    const { container } = render(
      <BranchFigureTable
        level={l1('reports_awaiting_review', rows, { parentValue: '3', total: '3' })}
      />,
    );
    expect(screen.getByRole('columnheader', { name: C.awaitingHeader })).toBeTruthy();
    const links = within(container.querySelector('tbody') as HTMLElement).getAllByRole('link');
    expect(links.map((a) => a.textContent?.trim())).toEqual(['2', '1']);
    expect(links[0]?.getAttribute('href')).toBe(rows[0]?.href);
    expect(container.textContent).not.toContain('PKR');
    const foot = footerOf(container);
    expect(foot.textContent).toMatch(C.total(3));
    expect(foot.querySelector('td[data-measure="count"]')?.textContent).toContain('3');
    expectLogical(container);
  });

  it('replaces the value with a "View approved" link for active branches', () => {
    const rows = [
      branchRow({
        value: '1',
        recordCount: 1,
        reportCount: 4,
        href: `/dashboard/kpi/approved/branches/${A}`,
      }),
      branchRow({
        branchId: B,
        branchCode: 'KHI-02',
        branchName: 'Karachi East',
        value: '1',
        recordCount: 1,
        reportCount: 0,
        href: `/dashboard/kpi/approved/branches/${B}`,
      }),
    ];
    const { container } = render(
      <BranchFigureTable level={l1('active_branches', rows, { parentValue: '2', total: '2' })} />,
    );
    const links = within(container.querySelector('tbody') as HTMLElement).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toContain(C.viewApproved);
    expect(links[1]?.getAttribute('href')).toBe(`/dashboard/kpi/approved/branches/${B}`);
    expect(screen.getByRole('columnheader', { name: C.approvedReports })).toBeTruthy();
    expect(footerOf(container).textContent).toMatch(C.total(2));
    expectLogical(container);
  });

  it('renders the level-1 empty state when no branch contributes', () => {
    const { container } = render(<BranchFigureTable level={l1('approved', [])} />);
    expect(screen.getByRole('status').textContent).toContain(C.emptyL1);
    expect(container.querySelector('table')).toBeNull();
  });
});

describe.each(LOCALES)('ReportFigureTable (%s)', (locale) => {
  const C = COPY[locale];
  const render = (ui: React.ReactElement) => renderWithIntl(ui, { locale, namespaces: NAMESPACES });

  it('lists weeks, statuses, records, frozen totals, dates and linked amounts', () => {
    const { container } = render(<ReportFigureTable level={l2(L2_ROWS)} />);
    expect(container.getAttribute('dir')).toBe(locale === 'ur' ? 'rtl' : 'ltr');
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(4);
    const first = rows[0] as HTMLElement;
    const times = [...first.querySelectorAll('time')].map((t) => t.getAttribute('dateTime'));
    expect(times).toEqual([
      '2026-08-31',
      '2026-09-06',
      '2026-09-07T10:00:00.000Z',
      '2026-09-08T10:00:00.000Z',
    ]);
    // Dates read in their own direction: never forced left to right.
    for (const time of first.querySelectorAll('time')) {
      expect(time.closest('bdi')?.getAttribute('dir')).toBeNull();
    }
    const link = within(first).getByRole('link');
    expect(link.getAttribute('href')).toBe(L2_ROWS[0]?.href);
    expect(link.textContent).toContain('PKR 1,000.00');
    expect(first.querySelector('[data-frozen-note]')).toBeNull();
    expectLogical(container);
  });

  it('marks frozen totals that differ, with the reason, and dashes what is not set', () => {
    const { container } = render(<ReportFigureTable level={l2(L2_ROWS)} />);
    const rows = [...container.querySelectorAll('tbody tr')] as HTMLElement[];
    expect(rows[1]?.querySelector('[data-frozen-note]')?.textContent).toBe(C.wholeWeek);
    expect(rows[1]?.textContent).toContain('PKR 400.00');
    expect(rows[2]?.querySelector('[data-frozen-note]')?.textContent).toBe(C.lastSubmission);
    // A returned report has a review date, but no approval date.
    expect(rows[2]?.querySelectorAll('time')).toHaveLength(3);
    expect(rows[3]?.querySelector('[data-frozen-note]')).toBeNull();
    expect(rows[3]?.querySelectorAll('time')).toHaveLength(2);
    expect(within(rows[3] as HTMLElement).getAllByText(C.notYet)).toHaveLength(3);
  });

  it('footer: amount total, collections and a pill naming the branch', () => {
    const { container } = render(<ReportFigureTable level={l2(L2_ROWS)} />);
    const foot = footerOf(container);
    expect(foot.textContent).toMatch(C.total(3));
    expect(foot.textContent).toContain('PKR 1,250.50');
    const pill = foot.querySelector('[data-tone]');
    expect(pill?.getAttribute('data-tone')).toBe('success');
    expect(pill?.textContent).toContain('LHR-01');
  });

  it('counts the reports for reports awaiting review and totals their amounts', () => {
    const rows = [
      reportRow({
        status: 'submitted',
        value: '300.00',
        frozenAmount: '300.00',
        recordCount: 3,
        reviewedAt: null,
      }),
      reportRow({
        reportId: R2,
        status: 'submitted',
        value: '50.25',
        frozenAmount: '50.25',
        recordCount: 1,
        reviewedAt: null,
        href: '/y',
      }),
    ];
    const level = {
      ...l2(rows, {
        figure: 'reports_awaiting_review',
        measure: 'count',
        parentValue: '2',
        total: '2',
        recordCount: 2,
      }),
    };
    const { container } = render(<ReportFigureTable level={level} />);
    const foot = footerOf(container);
    expect(foot.textContent).toMatch(C.total(2));
    expect(foot.textContent).toContain('PKR 350.25');
    expect(container.querySelectorAll('tbody [data-frozen-note]')).toHaveLength(0);
  });

  it('renders the level-2 empty state', () => {
    const { container } = render(
      <ReportFigureTable level={l2([], { total: '0.00', parentValue: '0.00' })} />,
    );
    expect(screen.getByRole('status').textContent).toContain(C.emptyL2);
    expect(container.querySelector('table')).toBeNull();
  });
});

describe.each(LOCALES)('drill helpers (%s)', (locale) => {
  it('DrillExportLinks renders plain downloads, the reports one only when given', () => {
    const { container } = renderWithIntl(
      <DrillExportLinks
        reports="/api/v1/exports/reports?figure=approved&locale=en"
        collections="/api/v1/exports/collections?figure=approved&locale=en"
      />,
      { locale, namespaces: NAMESPACES },
    );
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/api/v1/exports/reports?figure=approved&locale=en',
      '/api/v1/exports/collections?figure=approved&locale=en',
    ]);
    for (const a of links) expect(a.hasAttribute('download')).toBe(true);
    expectLogical(container);
    const only = renderWithIntl(<DrillExportLinks collections="/c" />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(only.container.querySelectorAll('a')).toHaveLength(1);
  });

  it('AutoDate formats business dates and instants in PKT with automatic direction', () => {
    const { container } = renderWithIntl(
      <p>
        <AutoDate value="2026-08-31" /> <AutoDate value="2026-09-30T20:00:00.000Z" />
      </p>,
      { locale, namespaces: NAMESPACES },
    );
    const times = [...container.querySelectorAll('time')];
    expect(times.map((t) => t.getAttribute('dateTime'))).toEqual([
      '2026-08-31',
      '2026-09-30T20:00:00.000Z',
    ]);
    // 20:00 UTC on 30 Sep is 1 Oct in Pakistan.
    expect(times[1]?.textContent).toMatch(/^1 /);
    expect(times[0]?.textContent).toMatch(/31/);
    for (const t of times) expect(t.parentElement?.tagName).toBe('BDI');
    for (const t of times) expect(t.parentElement?.getAttribute('dir')).toBeNull();
  });
});
