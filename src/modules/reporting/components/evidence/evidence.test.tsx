// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../../tests/support/render-intl';
import type {
  BranchHeader,
  CollectionEvidence,
  CollectionFigureRow,
  ReportEventRow,
  ReportHeader,
  TraceLevel,
} from '@/modules/reporting/trace-types';
import { CollectionEvidenceCard } from './CollectionEvidenceCard';
import { CollectionFigureTable } from './CollectionFigureTable';
import { ReportEventsList } from './ReportEventsList';
import { ReportSummaryCard } from './ReportSummaryCard';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.setConfig({ testTimeout: 20000 });

const LOCALES = ['en', 'ur'] as const;
const NAMESPACES = ['common', 'trace', 'evidence', 'audit', 'dashboard'];
const BRANCH_ID = '7d3c1a52-9b8e-4c1f-a2b3-0e5f6a7b8c9d';
const REPORT_ID = '9a683b03-1111-4c1f-a2b3-0e5f6a7b8c9d';
const COLLECTION_ID = '24636f8f-2222-4c1f-a2b3-0e5f6a7b8c9d';
const L3 = `/dashboard/kpi/approved/branches/${BRANCH_ID}/reports/${REPORT_ID}`;
const L4 = `${L3}/collections/${COLLECTION_ID}`;

const BRANCH: BranchHeader = {
  branchId: BRANCH_ID,
  branchCode: 'LHR-01',
  branchName: 'Lahore Central',
  branchStatus: 'active',
  city: 'Lahore',
};

const APPROVED: ReportHeader = {
  reportId: REPORT_ID,
  weekStart: '2026-08-31',
  weekEnd: '2026-09-06',
  status: 'approved',
  liveAmount: '1250.50',
  liveCount: 2,
  frozenAmount: '1250.50',
  frozenCount: 2,
  frozenMatchesLive: true,
  submittedAt: '2026-09-07T05:00:00.000Z',
  submittedByName: 'Lead Alpha',
  reviewedAt: '2026-09-08T09:30:00.000Z',
  reviewedByName: 'Faraz Finance',
  returnReason: null,
};

const DRAFT: ReportHeader = {
  ...APPROVED,
  status: 'draft',
  frozenAmount: null,
  frozenCount: null,
  frozenMatchesLive: null,
  submittedAt: null,
  submittedByName: null,
  reviewedAt: null,
  reviewedByName: null,
};

const EVENTS: ReportEventRow[] = [
  {
    id: '1',
    type: 'submitted',
    fromStatus: 'draft',
    toStatus: 'submitted',
    actorName: 'Lead Alpha',
    reason: null,
    occurredAt: '2026-09-07T05:00:00.000Z',
  },
  {
    id: '2',
    type: 'returned',
    fromStatus: 'submitted',
    toStatus: 'returned',
    actorName: 'Faraz Finance',
    reason: 'Receipt 14 is missing',
    occurredAt: '2026-09-07T10:00:00.000Z',
  },
  {
    id: '3',
    type: 'resubmitted',
    fromStatus: 'returned',
    toStatus: 'submitted',
    actorName: 'Lead Alpha',
    reason: null,
    occurredAt: '2026-09-08T04:00:00.000Z',
  },
  {
    id: '4',
    type: 'approved',
    fromStatus: 'submitted',
    toStatus: 'approved',
    actorName: 'Faraz Finance',
    reason: null,
    occurredAt: '2026-09-08T09:30:00.000Z',
  },
];

const ROWS: CollectionFigureRow[] = [
  {
    collectionId: COLLECTION_ID,
    collectedOn: '2026-08-31',
    purpose: 'Food parcels',
    amount: '1000.00',
    routedAt: '2026-09-10T06:00:00.000Z',
    href: L4,
  },
  {
    collectionId: '33333333-3333-4c1f-a2b3-0e5f6a7b8c9d',
    collectedOn: '2026-09-02',
    purpose: 'School fees',
    amount: '250.50',
    routedAt: null,
    href: `${L3}/collections/33333333-3333-4c1f-a2b3-0e5f6a7b8c9d`,
  },
];

function level(
  overrides: Partial<TraceLevel<CollectionFigureRow>> = {},
): TraceLevel<CollectionFigureRow> & { report: ReportHeader } {
  return {
    figure: 'approved',
    slug: 'approved',
    measure: 'amount',
    level: 'collections',
    parentValue: '1250.50',
    rows: ROWS,
    total: '1250.50',
    recordCount: 2,
    matchesParent: true,
    truncated: null,
    explain: {
      figure: 'approved',
      level: 'collections',
      filters: { branchId: BRANCH_ID, reportId: REPORT_ID },
      recordCount: 2,
      value: '1250.50',
      asOf: '2026-10-31T10:00:00.000Z',
    },
    asOf: '2026-10-31T10:00:00.000Z',
    trail: [],
    report: APPROVED,
    ...overrides,
  };
}

const EVIDENCE: CollectionEvidence = {
  figure: 'approved',
  slug: 'approved',
  branch: BRANCH,
  report: APPROVED,
  reportEvents: EVENTS,
  collection: {
    collectionId: COLLECTION_ID,
    amount: '1000.00',
    collectedOn: '2026-08-31',
    purpose: 'Food parcels',
    status: 'active',
    voidReason: null,
    routedAt: '2026-09-10T06:00:00.000Z',
    routedByName: 'Faraz Finance',
    createdAt: '2026-08-31T08:00:00.000Z',
    createdByName: 'Lead Alpha',
  },
  collectionTimeline: [],
  reportTimeline: [],
  explain: {
    figure: 'approved',
    level: 'collection',
    filters: { branchId: BRANCH_ID, reportId: REPORT_ID, collectionId: COLLECTION_ID },
    recordCount: 1,
    value: '1000.00',
    asOf: '2026-10-31T10:00:00.000Z',
  },
  asOf: '2026-10-31T10:00:00.000Z',
  trail: [
    {
      kind: 'report',
      href: L3,
      figure: 'approved',
      measure: 'amount',
      value: '1250.50',
      weekStart: '2026-08-31',
    },
  ],
};

/** Text of every auto-direction isolate (names, purposes, localized dates). */
function isolatedTexts(root: Element | undefined): (string | null)[] {
  return [...(root?.querySelectorAll('bdi:not([dir])') ?? [])].map((b) => b.textContent);
}

function render(ui: React.ReactElement, locale: 'en' | 'ur') {
  return renderWithIntl(ui, { locale, namespaces: NAMESPACES });
}

const COPY = {
  en: {
    match: 'Totals match',
    differ: 'Totals differ',
    notSubmitted: 'Not yet submitted',
    approved: 'Approved',
    returned: 'Returned',
    routed: 'Sent to main account',
    notRouted: 'Not yet sent',
    eventsEmpty: 'No report events yet',
    totalOf: 'Total of 2 records',
    matches: 'Matches',
    voided: 'Voided',
  },
  ur: {
    match: 'میزان برابر ہے',
    differ: 'میزان میں فرق ہے',
    notSubmitted: 'ابھی جمع نہیں ہوئی',
    approved: 'منظور کی گئی',
    returned: 'واپس کی گئی',
    routed: 'مرکزی اکاؤنٹ میں منتقل شدہ',
    notRouted: 'ابھی منتقل نہیں ہوئی',
    eventsEmpty: 'رپورٹ کا ابھی کوئی مرحلہ درج نہیں',
    totalOf: '2 ریکارڈز کا میزان',
    matches: 'کے مطابق',
    voided: 'کالعدم',
  },
} as const;

describe.each(LOCALES)('ReportSummaryCard (%s)', (locale) => {
  const copy = COPY[locale];

  it('shows frozen and live totals with a success "Totals match" marker', () => {
    const { container } = render(<ReportSummaryCard report={APPROVED} branch={BRANCH} />, locale);
    const frozen = container.querySelector('[data-total="frozen"]');
    const live = container.querySelector('[data-total="live"]');
    expect(frozen?.textContent).toContain('PKR 1,250.50');
    expect(live?.textContent).toContain('PKR 1,250.50');
    expect(frozen?.querySelector('bdi[dir="ltr"]')).not.toBeNull();
    const marker = container.querySelector('[data-totals]');
    expect(marker?.getAttribute('data-totals')).toBe('match');
    expect(marker?.getAttribute('data-tone')).toBe('success');
    expect(marker?.textContent).toContain(copy.match);
    expect(marker?.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toContain('Lead Alpha');
    expect(container.textContent).toContain('Faraz Finance');
    expect(container.querySelector('[data-status]')?.getAttribute('data-status')).toBe('approved');
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
  });

  it('puts names in auto-direction isolates and dates in time elements', () => {
    const { container } = render(<ReportSummaryCard report={APPROVED} branch={BRANCH} />, locale);
    const names = [...container.querySelectorAll('bdi:not([dir])')].map((b) => b.textContent);
    expect(names).toContain('Lead Alpha');
    expect(names).toContain('Faraz Finance');
    const times = [...container.querySelectorAll('time')].map((t) => t.getAttribute('dateTime'));
    expect(times).toContain('2026-08-31');
    expect(times).toContain('2026-09-06');
    expect(times).toContain(APPROVED.reviewedAt);
    expect(container.textContent).toContain('LHR-01');
  });

  it('flags a mismatch between frozen and live totals in the danger tone with text', () => {
    const { container } = render(
      <ReportSummaryCard
        report={{ ...APPROVED, liveAmount: '1200.00', frozenMatchesLive: false }}
        branch={BRANCH}
      />,
      locale,
    );
    const marker = container.querySelector('[data-totals]');
    expect(marker?.getAttribute('data-totals')).toBe('differ');
    expect(marker?.getAttribute('data-tone')).toBe('danger');
    expect(marker?.textContent).toContain(copy.differ);
  });

  it('shows "Not yet submitted" for a draft instead of a frozen total', () => {
    const { container } = render(<ReportSummaryCard report={DRAFT} branch={BRANCH} />, locale);
    const frozen = container.querySelector('[data-total="frozen"]');
    expect(frozen?.textContent).toContain(copy.notSubmitted);
    expect(frozen?.textContent).not.toContain('PKR');
    expect(container.querySelector('[data-totals]')).toBeNull();
  });

  it('shows the return reason when present', () => {
    const { container } = render(
      <ReportSummaryCard
        report={{
          ...APPROVED,
          status: 'returned',
          frozenMatchesLive: null,
          returnReason: 'Receipt 14 is missing',
        }}
        branch={BRANCH}
      />,
      locale,
    );
    expect(container.querySelector('[data-return-reason]')?.textContent).toContain(
      'Receipt 14 is missing',
    );
  });
});

describe.each(LOCALES)('ReportEventsList (%s)', (locale) => {
  const copy = COPY[locale];

  it('lists events in order with localized labels, actors and reasons', () => {
    const { container } = render(<ReportEventsList events={EVENTS} />, locale);
    const items = [...container.querySelectorAll('li[data-event-type]')];
    expect(items.map((i) => i.getAttribute('data-event-type'))).toEqual([
      'submitted',
      'returned',
      'resubmitted',
      'approved',
    ]);
    expect(items[1]?.textContent).toContain(copy.returned);
    expect(items[1]?.textContent).toContain('Receipt 14 is missing');
    expect(items[3]?.textContent).toContain(copy.approved);
    expect(isolatedTexts(items[3])).toContain('Faraz Finance');
    expect(items[3]?.querySelector('time')?.getAttribute('dateTime')).toBe(
      '2026-09-08T09:30:00.000Z',
    );
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
  });

  it('sorts events by time even when given out of order', () => {
    const { container } = render(<ReportEventsList events={[...EVENTS].reverse()} />, locale);
    const first = container.querySelector('li[data-event-type]');
    expect(first?.getAttribute('data-event-type')).toBe('submitted');
  });

  it('renders the empty copy without events', () => {
    const { container } = render(<ReportEventsList events={[]} />, locale);
    expect(container.querySelector('li')).toBeNull();
    expect(container.textContent).toContain(copy.eventsEmpty);
  });
});

describe.each(LOCALES)('CollectionFigureTable (%s)', (locale) => {
  const copy = COPY[locale];

  it('renders dates, purposes, routed badges and amount links with a matching footer', () => {
    const { container } = render(<CollectionFigureTable level={level()} />, locale);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-08-31');
    expect(isolatedTexts(rows[0])).toContain('Food parcels');
    const link = rows[0]?.querySelector(`a[href="${L4}"]`);
    expect(link?.textContent).toContain('PKR 1,000.00');
    expect(link?.getAttribute('aria-label')).toContain('PKR 1,000.00');
    const routed = rows[0]?.querySelector('[data-routed]');
    expect(routed?.getAttribute('data-routed')).toBe('routed');
    expect(routed?.getAttribute('data-tone')).toBe('info');
    expect(routed?.textContent).toContain(copy.routed);
    const waiting = rows[1]?.querySelector('[data-routed]');
    expect(waiting?.getAttribute('data-routed')).toBe('waiting');
    expect(waiting?.getAttribute('data-tone')).toBe('warning');
    expect(waiting?.textContent).toContain(copy.notRouted);

    const foot = container.querySelector('tfoot');
    expect(foot?.textContent).toContain(copy.totalOf);
    expect(foot?.textContent).toContain('PKR 1,250.50');
    const pill = foot?.querySelector('[data-tone]');
    expect(pill?.getAttribute('data-tone')).toBe('success');
    expect(pill?.textContent).toContain(copy.matches);
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
  });

  it('shows no routed badge for rows of a report that is not approved', () => {
    const { container } = render(
      <CollectionFigureTable
        level={level({ figure: 'pending_approval' }) as never}
        reportStatus="submitted"
      />,
      locale,
    );
    expect(container.querySelector('[data-routed]')).toBeNull();
  });

  it('shows the mismatch pill and the truncation note', () => {
    const { container } = render(
      <CollectionFigureTable
        level={level({ matchesParent: false, truncated: { shown: 2 }, recordCount: 600 })}
      />,
      locale,
    );
    const foot = container.querySelector('tfoot');
    expect(foot?.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe('danger');
    expect(foot?.textContent).toContain('600');
  });

  it('renders the empty state for a level without rows', () => {
    const { container } = render(
      <CollectionFigureTable level={level({ rows: [], total: '0.00', recordCount: 0 })} />,
      locale,
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe.each(LOCALES)('CollectionEvidenceCard (%s)', (locale) => {
  const copy = COPY[locale];

  it('shows the facts in a definition list with the amount as the headline figure', () => {
    const { container } = render(<CollectionEvidenceCard evidence={EVIDENCE} />, locale);
    const amount = container.querySelector('[data-fact="amount"]');
    expect(amount?.textContent).toContain('PKR 1,000.00');
    expect(amount?.className).toMatch(/text-\[2/);
    expect(container.querySelector('dl')).not.toBeNull();
    expect(container.querySelector('[data-fact="purpose"] bdi')?.textContent).toBe('Food parcels');
    expect(
      container.querySelector('[data-fact="collectedOn"] time')?.getAttribute('dateTime'),
    ).toBe('2026-08-31');
    expect(container.querySelector('[data-fact="routed"]')?.textContent).toContain(copy.routed);
    expect(container.querySelector('[data-fact="routed"]')?.textContent).toContain('Faraz Finance');
    expect(container.querySelector('[data-fact="createdBy"]')?.textContent).toContain('Lead Alpha');
    expect(container.querySelector(`[data-fact="report"] a[href="${L3}"]`)).not.toBeNull();
    expect(container.querySelector('[data-fact="voidReason"]')).toBeNull();
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
  });

  it('shows the void reason only for a voided collection, and no routing for it', () => {
    const { container } = render(
      <CollectionEvidenceCard
        evidence={{
          ...EVIDENCE,
          collection: {
            ...EVIDENCE.collection,
            status: 'voided',
            voidReason: 'Entered twice',
            routedAt: null,
            routedByName: null,
          },
        }}
      />,
      locale,
    );
    expect(container.querySelector('[data-fact="voidReason"]')?.textContent).toContain(
      'Entered twice',
    );
    expect(container.querySelector('[data-fact="status"]')?.textContent).toContain(copy.voided);
    expect(container.textContent).not.toContain('Faraz Finance');
  });

  it('shows "not yet sent" without a routed-by line for an unrouted approved collection', () => {
    const { container } = render(
      <CollectionEvidenceCard
        evidence={{
          ...EVIDENCE,
          collection: { ...EVIDENCE.collection, routedAt: null, routedByName: null },
        }}
      />,
      locale,
    );
    const routed = container.querySelector('[data-fact="routed"]');
    expect(routed?.getAttribute('data-routed')).toBe('waiting');
    expect(routed?.textContent).not.toContain('Faraz Finance');
  });
});
