// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { BranchesByCity } from '@/components/public/BranchesByCity';
import { ApplicationDetailView } from '@/modules/applications/components/ApplicationDetailView';
import { ApplicationsTable } from '@/modules/applications/components/ApplicationsTable';
import type { ApplicationDetail } from '@/modules/applications/review-types';
import { BranchLeadsPanel } from '@/modules/branches/components/BranchLeadsPanel';
import { BranchesTable } from '@/modules/branches/components/BranchesTable';
import type { BranchListItem } from '@/modules/branches/types';
import { CollectionsTable } from '@/modules/collections/components/CollectionsTable';
import { CurrentWeekCard } from '@/modules/collections/components/CurrentWeekCard';
import type { CollectionItem, CurrentWeek } from '@/modules/collections/types';
import { ContentEntriesTable } from '@/modules/content/components/ContentEntriesTable';
import { EventsTable } from '@/modules/content/components/EventsTable';
import type { EventView } from '@/modules/content/event-types';
import { MemberEditForm } from '@/modules/members/components/MemberEditForm';
import { MembersTable } from '@/modules/members/components/MembersTable';
import type { MemberListItem } from '@/modules/members/types';
import { ReportCollectionsTable } from '@/modules/reports/components/ReportCollectionsTable';
import { ReportHistory } from '@/modules/reports/components/ReportHistory';
import { ReportSummary, ReportTotals } from '@/modules/reports/components/ReportSummary';
import { ReportsTable, ReviewQueueList } from '@/modules/reports/components/ReportsTable';
import type { ReportDetail, ReportListItem } from '@/modules/reports/types';
import { AuditTimeline } from '@/modules/timeline/components/AuditTimeline';
import type { TimelineEntry } from '@/modules/timeline/types';
import { formatDate, formatDateTime } from '@/platform/i18n/format';
import { fillSlots, slot } from './Bidi';

// I18N-04 retrofit: in Urdu, every machine value (code, email, phone, amount, request id)
// sits in an LTR isolate and every typed name and every date in an automatic-direction
// isolate, with its text unchanged.

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  Link: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.setConfig({ testTimeout: 20000 });

function isolates(root: HTMLElement, text: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('bdi')].filter((el) => el.textContent === text);
}

/** The value is the whole text of an LTR isolate. */
function expectLtr(root: HTMLElement, text: string) {
  const found = isolates(root, text).filter((el) => el.getAttribute('dir') === 'ltr');
  expect(found.length, `LTR isolate for "${text}"`).toBeGreaterThan(0);
}

/** The value is the whole text of an automatic-direction isolate. */
function expectAuto(root: HTMLElement, text: string) {
  const found = isolates(root, text).filter((el) => {
    const dir = el.getAttribute('dir');
    return dir === null || dir === 'auto';
  });
  expect(found.length, `auto isolate for "${text}"`).toBeGreaterThan(0);
}

const ur = (namespaces: string[]) => ({ locale: 'ur' as const, namespaces });

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '22222222-2222-4222-8222-222222222222';

const MEMBER: MemberListItem = {
  id: '33333333-3333-4333-8333-333333333333',
  memberCode: 'M00042',
  fullName: 'Ali Khan',
  email: 'ali.khan@example.test',
  phone: '0300-0000123',
  teamId: '44444444-4444-4444-8444-444444444444',
  teamName: 'Food drive',
  memberRole: 'volunteer',
  status: 'active',
  branchId: BRANCH_ID,
  branchName: 'Lahore Central',
  joinedOn: '2026-03-14',
};

describe('members (ur)', () => {
  const NS = ['common', 'members'];

  it('MembersTable isolates code, email and phone LTR and names automatically', () => {
    const { container } = renderWithIntl(<MembersTable members={[MEMBER]} showBranch />, ur(NS));
    expect(container).toHaveAttribute('dir', 'rtl');
    const row = container.querySelector('tbody tr') as HTMLElement;
    for (const value of ['M00042', 'ali.khan@example.test', '0300-0000123']) {
      expectLtr(row, value);
    }
    for (const value of ['Ali Khan', 'Food drive', 'Lahore Central']) expectAuto(row, value);
    // The row keeps every value intact and in its own cell.
    expect(row.textContent).toContain('M00042');
    expect(row.textContent).toContain('ali.khan@example.test');
  });

  it('MemberEditForm isolates the profile values', () => {
    const { container } = renderWithIntl(
      <MemberEditForm
        member={MEMBER}
        teams={[{ id: MEMBER.teamId!, name: 'Food drive' }]}
        canEdit={false}
      />,
      ur(NS),
    );
    for (const value of ['M00042', 'ali.khan@example.test', '0300-0000123']) {
      expectLtr(container, value);
    }
    for (const value of ['Ali Khan', 'Lahore Central', 'Food drive']) {
      expectAuto(container, value);
    }
    expectAuto(container, formatDate('2026-03-14', 'ur'));
  });
});

const APPLICATION: ApplicationDetail = {
  id: '55555555-5555-4555-8555-555555555555',
  fullName: 'Sara Ahmed',
  email: 'sara@example.test',
  phone: '0321-1234567',
  branchId: BRANCH_ID,
  branchName: 'Lahore Central',
  status: 'accepted',
  createdAt: '2026-10-20T07:15:00.000Z',
  decidedAt: '2026-10-21T10:00:00.000Z',
  message: null,
  decisionNote: null,
  decidedByName: 'Hina HR',
  memberId: MEMBER.id,
  memberCode: 'M00043',
};

describe('applications (ur)', () => {
  const NS = ['common', 'shell', 'applications'];

  it('ApplicationsTable isolates email, phone, names and the received date', () => {
    const { container } = renderWithIntl(
      <ApplicationsTable applications={[APPLICATION]} showBranch />,
      ur(NS),
    );
    expectLtr(container, 'sara@example.test');
    expectLtr(container, '0321-1234567');
    expectAuto(container, 'Sara Ahmed');
    expectAuto(container, 'Lahore Central');
    expectAuto(container, formatDateTime(new Date(APPLICATION.createdAt), 'ur'));
  });

  it('ApplicationDetailView isolates contact values, names, dates and the member code', () => {
    const { container } = renderWithIntl(
      <ApplicationDetailView application={APPLICATION} />,
      ur(NS),
    );
    expectLtr(container, 'sara@example.test');
    expectLtr(container, '0321-1234567');
    expectLtr(container, 'M00043');
    for (const value of ['Sara Ahmed', 'Lahore Central', 'Hina HR']) expectAuto(container, value);
    expectAuto(container, formatDateTime(new Date(APPLICATION.createdAt), 'ur'));
    expectAuto(container, formatDateTime(new Date(APPLICATION.decidedAt!), 'ur'));
  });
});

describe('content (ur)', () => {
  const NS = ['common', 'shell', 'content'];

  it('ContentEntriesTable isolates the page path and the updated date', () => {
    const updatedAt = '2026-10-20T09:15:00.000Z';
    const { container } = renderWithIntl(
      <ContentEntriesTable
        entries={[
          {
            key: 'about',
            locale: 'en',
            exists: true,
            title: 'About us',
            body: 'We help.',
            status: 'draft',
            hasUnpublishedChanges: false,
            translationMissing: false,
            publishedAt: null,
            updatedAt,
          },
        ]}
      />,
      ur(NS),
    );
    expectLtr(container, '/about');
    expectAuto(container, formatDateTime(new Date(updatedAt), 'ur'));
  });

  it('EventsTable isolates the English title, branch name and venue', () => {
    const event: EventView = {
      id: '66666666-6666-4666-8666-666666666666',
      slug: 'evt-1a2b3c4d',
      titleEn: 'Health camp',
      titleUr: null,
      summaryEn: null,
      summaryUr: null,
      location: 'Community hall',
      startsAt: '2026-11-15T09:30:00.000Z',
      endsAt: null,
      branchId: BRANCH_ID,
      branchName: 'Lahore Central',
      status: 'draft',
      hasUnpublishedChanges: false,
      publishedAt: null,
      updatedAt: '2026-10-20T09:15:00.000Z',
    };
    const { container } = renderWithIntl(<EventsTable events={[event]} />, ur(NS));
    for (const value of ['Health camp', 'Lahore Central', 'Community hall']) {
      expectAuto(container, value);
    }
    expectAuto(container, formatDateTime(new Date(event.startsAt!), 'ur'));
  });
});

const BRANCH: BranchListItem = {
  id: BRANCH_ID,
  code: 'BR002',
  name: 'Lahore Central',
  city: 'Lahore',
  status: 'active',
  leadCount: 1,
  createdAt: '2026-01-05T06:00:00.000Z',
};

describe('branches (ur)', () => {
  const NS = ['common', 'branches'];

  it('BranchesTable isolates the code LTR and the name, city and date automatically', () => {
    const { container } = renderWithIntl(<BranchesTable branches={[BRANCH]} />, ur(NS));
    expectLtr(container, 'BR002');
    expectAuto(container, 'Lahore Central');
    expectAuto(container, 'Lahore');
    expectAuto(container, formatDate(new Date(BRANCH.createdAt), 'ur'));
  });

  it('BranchLeadsPanel isolates the lead name and email', () => {
    const { container } = renderWithIntl(
      <BranchLeadsPanel
        branchId={BRANCH_ID}
        leads={[
          {
            userId: '77777777-7777-4777-8777-777777777777',
            name: 'Ayesha Lead',
            email: 'lead.lahore@shiplens.test',
            role: 'branch_lead',
          },
        ]}
        canAssign={false}
        closed={false}
      />,
      ur(NS),
    );
    expectLtr(container, 'lead.lahore@shiplens.test');
    expectAuto(container, 'Ayesha Lead');
  });
});

function collection(overrides: Partial<CollectionItem> = {}): CollectionItem {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    branchId: BRANCH_ID,
    branchCode: 'BR002',
    branchName: 'Lahore Central',
    branchStatus: 'active',
    reportId: REPORT_ID,
    reportStatus: 'draft',
    weekStart: '2026-10-26',
    amount: '2500.75',
    collectedOn: '2026-10-28',
    purpose: 'Ration packs',
    note: null,
    status: 'active',
    voidReason: null,
    voidedAt: null,
    routedAt: null,
    createdAt: '2026-10-28T06:00:00.000Z',
    createdByName: 'Bilal Ahmed',
    lock: { lastEditableOn: '2026-11-04', locked: false, daysLeft: 3 },
    editability: 'editable',
    ...overrides,
  };
}

describe('collections (ur)', () => {
  const NS = ['common', 'collections'];

  it('CollectionsTable isolates code and amount LTR, names, purpose, reason and date', () => {
    const { container } = renderWithIntl(
      <CollectionsTable
        items={[
          collection(),
          collection({
            id: '99999999-9999-4999-8999-999999999999',
            status: 'voided',
            voidReason: 'Entered twice',
            editability: 'voided',
          }),
        ]}
        showBranch
      />,
      ur(NS),
    );
    expectLtr(container, 'BR002');
    expectLtr(container, 'PKR 2,500.75');
    for (const value of ['Lahore Central', 'Ration packs', 'Bilal Ahmed', 'Entered twice']) {
      expectAuto(container, value);
    }
    expectAuto(container, formatDate('2026-10-28', 'ur'));
  });

  it('CurrentWeekCard isolates the total LTR and the week range automatically', () => {
    const week: CurrentWeek = {
      weekStart: '2026-10-26',
      weekEnd: '2026-11-01',
      today: '2026-10-29',
      reportId: REPORT_ID,
      reportStatus: 'draft',
      activeTotal: '15250.5',
      activeCount: 4,
      branchStatus: 'active',
    };
    const { container, getByTestId } = renderWithIntl(<CurrentWeekCard week={week} />, ur(NS));
    expectLtr(container, 'PKR 15,250.50');
    expect(getByTestId('week-total')).toHaveTextContent('PKR 15,250.50');
    const range = container.querySelector('time bdi');
    expect(range).not.toHaveAttribute('dir');
    expect(range?.textContent).toContain(formatDate('2026-10-26', 'ur'));
    expect(range?.textContent).toContain(formatDate('2026-11-01', 'ur'));
  });
});

function report(overrides: Partial<ReportListItem> = {}): ReportListItem {
  return {
    id: REPORT_ID,
    branchId: BRANCH_ID,
    branchCode: 'BR002',
    branchName: 'Lahore Central',
    branchStatus: 'active',
    weekStart: '2026-10-19',
    weekEnd: '2026-10-25',
    status: 'approved',
    amount: '40250.50',
    count: 7,
    amountIsFrozen: true,
    submittedAt: '2026-10-26T05:00:00.000Z',
    submittedByName: 'Bilal Ahmed',
    reviewedAt: '2026-10-27T09:30:00.000Z',
    reviewedByName: 'Sana Finance',
    version: 1,
    ...overrides,
  };
}

function detail(overrides: Partial<ReportDetail> = {}): ReportDetail {
  return {
    ...report(),
    returnReason: null,
    liveAmount: '40250.50',
    liveCount: 7,
    frozenAmount: '40250.50',
    frozenCount: 7,
    collections: [],
    events: [],
    allowedActions: [],
    ...overrides,
  };
}

describe('reports (ur)', () => {
  const NS = ['common', 'reports', 'audit'];
  const weekRange = (start: string, end: string) =>
    [formatDate(start, 'ur'), formatDate(end, 'ur')] as const;

  it('ReportsTable isolates code and amount LTR, week, names and dates automatically', () => {
    const { container } = renderWithIntl(<ReportsTable reports={[report()]} showBranch />, ur(NS));
    expectLtr(container, 'BR002');
    expectLtr(container, 'PKR 40,250.50');
    for (const value of ['Lahore Central', 'Bilal Ahmed', 'Sana Finance']) {
      expectAuto(container, value);
    }
    expectAuto(container, formatDateTime(new Date('2026-10-27T09:30:00.000Z'), 'ur'));
    const [start, end] = weekRange('2026-10-19', '2026-10-25');
    const week = isolates(container, `${start} – ${end}`);
    expect(week.length).toBeGreaterThan(0);
  });

  it('ReviewQueueList isolates the submitter and the waiting-since date inside the sentence', () => {
    const { container } = renderWithIntl(
      <ReviewQueueList
        reports={[report({ status: 'submitted', reviewedAt: null, reviewedByName: null })]}
        today="2026-11-01"
      />,
      ur(NS),
    );
    expectLtr(container, 'BR002');
    expectLtr(container, 'PKR 40,250.50');
    expectAuto(container, 'Bilal Ahmed');
    expectAuto(container, formatDateTime(new Date('2026-10-26T05:00:00.000Z'), 'ur'));
  });

  it('ReportSummary and ReportTotals isolate branch, code, week, reviewer and totals', () => {
    const { container } = renderWithIntl(
      <>
        <ReportSummary report={detail()} />
        <ReportTotals report={detail()} />
      </>,
      ur(NS),
    );
    expectLtr(container, 'BR002');
    expectLtr(container, 'PKR 40,250.50');
    expectAuto(container, 'Lahore Central');
    expectAuto(container, 'Sana Finance');
    expectAuto(container, formatDateTime(new Date('2026-10-27T09:30:00.000Z'), 'ur'));
    const [start, end] = weekRange('2026-10-19', '2026-10-25');
    expect(isolates(container, `${start} – ${end}`).length).toBeGreaterThan(0);
  });

  it('ReportTotals isolates the last submitted amount inside its sentence', () => {
    const { container } = renderWithIntl(
      <ReportTotals
        report={detail({ status: 'returned', liveAmount: '1500.00', frozenAmount: '1200.00' })}
      />,
      ur(NS),
    );
    expectLtr(container, 'PKR 1,500.00');
    expectLtr(container, 'PKR 1,200.00');
  });

  it('ReportCollectionsTable isolates amounts and total LTR, dates and void reasons automatically', () => {
    const { container, getByTestId } = renderWithIntl(
      <ReportCollectionsTable
        collections={[
          {
            id: 'd0000000-0000-4000-8000-000000000001',
            collectedOn: '2026-10-20',
            amount: '1000.00',
            purpose: 'Food drive',
            status: 'active',
            voidReason: null,
            routedAt: null,
            createdByName: 'Bilal Ahmed',
          },
          {
            id: 'd0000000-0000-4000-8000-000000000002',
            collectedOn: '2026-10-21',
            amount: '250.00',
            purpose: 'Clinic',
            status: 'voided',
            voidReason: 'Entered twice',
            routedAt: null,
            createdByName: 'Bilal Ahmed',
          },
        ]}
        total="1000.00"
        totalIsFrozen
      />,
      ur(NS),
    );
    expectLtr(container, 'PKR 1,000.00');
    expectLtr(container, 'PKR 250.00');
    expect(getByTestId('collections-total')).toHaveTextContent('PKR 1,000.00');
    expectAuto(container, formatDate('2026-10-20', 'ur'));
    expectAuto(container, 'Entered twice');
  });

  it('ReportHistory isolates actor names and event times', () => {
    const occurredAt = '2026-10-26T05:00:00.000Z';
    const { container } = renderWithIntl(
      <ReportHistory
        events={[
          {
            id: 'e1',
            type: 'submitted',
            fromStatus: 'draft',
            toStatus: 'submitted',
            actorName: 'Bilal Ahmed',
            reason: null,
            occurredAt,
          },
        ]}
      />,
      ur(NS),
    );
    expectAuto(container, 'Bilal Ahmed');
    expectAuto(container, formatDateTime(new Date(occurredAt), 'ur'));
  });
});

describe('AuditTimeline (ur)', () => {
  it('isolates the actor name, time, money change and request id', () => {
    const entry: TimelineEntry = {
      id: '1',
      occurredAt: '2026-10-27T09:30:00.000Z',
      action: 'collection.amend',
      actorName: 'Ayesha Lead',
      actorRole: 'branch_lead',
      entityType: 'collection',
      entityId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      changes: [
        { field: 'amount', before: '100.00', after: '1500.50' },
        { field: 'collected_on', before: '2026-10-26', after: '2026-10-27' },
      ],
      requestId: 'b7e1d2c3-0000-4000-8000-000000000001',
    };
    const { container } = renderWithIntl(
      <AuditTimeline entries={[entry]} />,
      ur(['audit', 'common']),
    );
    expectAuto(container, 'Ayesha Lead');
    expectAuto(container, formatDateTime(new Date(entry.occurredAt), 'ur'));
    expectLtr(container, 'PKR 100.00');
    expectLtr(container, 'PKR 1,500.50');
    expectLtr(container, 'b7e1d2c3');
    expectLtr(container, 'a1b2c3d4');
  });
});

describe('BranchesByCity (ur)', () => {
  it('isolates city and branch names (no phone or email is public)', () => {
    const { container } = renderWithIntl(
      <BranchesByCity
        branches={[{ id: BRANCH_ID, name: 'Lahore Central', city: 'Lahore', summary: null }]}
        locale="ur"
      />,
      ur(['common', 'shell', 'public']),
    );
    expectAuto(container, 'Lahore Central');
    expectAuto(container, 'Lahore');
    expect(container.textContent).not.toMatch(/@/);
  });
});

describe('fillSlots', () => {
  it('puts nodes where the slot markers landed and keeps the visible text', () => {
    const sentence = `Approved by ${slot(0)} on ${slot(1)}`;
    const { container } = renderWithIntl(
      <p>{fillSlots(sentence, [<bdi key="n">Ali Khan</bdi>, <bdi key="d">27 Oct 2026</bdi>])}</p>,
    );
    expect(container.textContent).toBe('Approved by Ali Khan on 27 Oct 2026');
    expect(container.querySelectorAll('bdi')).toHaveLength(2);
  });

  it('returns the text unchanged when there is no marker', () => {
    expect(fillSlots('Plain text', [])).toBe('Plain text');
  });

  it('works on an Urdu message whose value comes first', () => {
    const { container } = renderWithIntl(
      <p>{fillSlots(`${slot()} کی جانب سے`, [<bdi key="n">Ayesha Lead</bdi>])}</p>,
      { locale: 'ur' },
    );
    expect(container.textContent).toBe('Ayesha Lead کی جانب سے');
    expect(container.querySelector('p')?.firstElementChild?.tagName).toBe('BDI');
  });
});
