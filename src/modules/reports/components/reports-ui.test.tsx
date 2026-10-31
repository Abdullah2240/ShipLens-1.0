// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDate, formatDateTime } from '@/platform/i18n/format';
import type { ReportDetail, ReportListItem } from '../types';
import { ReportActions } from './ReportActions';
import { ReportCollectionsTable } from './ReportCollectionsTable';
import { ReportFilters } from './ReportFilters';
import { ReportHistory } from './ReportHistory';
import { ReportSummary, ReportTotals, lifecycleSteps } from './ReportSummary';
import { ReportsTable, ReviewQueueList } from './ReportsTable';
import { reportsHref } from './report-format';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

// next-intl's createNavigation cannot be imported under Vitest (see LanguageSwitcher.test).
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => router,
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

// Role queries over full tables and dialogs are slow on a busy runner.
vi.setConfig({ testTimeout: 20000 });

const LOCALES = ['en', 'ur'] as const;
type Locale = (typeof LOCALES)[number];
const NAMESPACES = ['common', 'reports', 'audit'];

function lookup(locale: Locale, ns: string, key: string): string {
  const file = path.resolve(import.meta.dirname, `../../../../messages/${locale}/${ns}.json`);
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      JSON.parse(readFileSync(file, 'utf8')) as unknown,
    );
  if (typeof value !== 'string') throw new Error(`missing ${ns} message ${locale}:${key}`);
  return value;
}

/** A `reports` message with simple `{name}` arguments filled in (no plural forms). */
function msg(locale: Locale, key: string, values: Record<string, string> = {}): string {
  return lookup(locale, 'reports', key).replace(
    /\{(\w+)\}/g,
    (_, name: string) => values[name] ?? `{${name}}`,
  );
}

/** One branch of a `{count, plural, ...}` message, e.g. `other` or `=0`. */
function plural(
  locale: Locale,
  key: string,
  branch: string,
  values: Record<string, string> = {},
): string {
  const source = lookup(locale, 'reports', key);
  const start = source.indexOf(`${branch} {`);
  if (start < 0) throw new Error(`no ${branch} branch in ${key}`);
  let depth = 0;
  let i = start + branch.length + 1;
  const from = i + 1;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) break;
  }
  return source
    .slice(from, i)
    .replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
}

/** The same provider `renderWithIntl` uses, for `rerender` with new props. */
function withIntl(locale: Locale, ui: ReactNode) {
  const messages = Object.fromEntries(
    NAMESPACES.map((ns) => [
      ns,
      JSON.parse(
        readFileSync(
          path.resolve(import.meta.dirname, `../../../../messages/${locale}/${ns}.json`),
          'utf8',
        ),
      ) as Record<string, unknown>,
    ]),
  );
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

const statusLabel = (locale: Locale, status: string) =>
  lookup(locale, 'common', `status.${status}`);
const weekLabel = (locale: Locale, start: string, end: string) =>
  msg(locale, 'detail.week', { start: formatDate(start, locale), end: formatDate(end, locale) });

const LAHORE = '11111111-1111-4111-8111-111111111111';
const KARACHI = '22222222-2222-4222-8222-222222222222';
const NON_LATIN_DIGITS = /[٠-٩۰-۹]/;

function listItem(overrides: Partial<ReportListItem> = {}): ReportListItem {
  return {
    id: 'a0000000-0000-4000-8000-000000000001',
    branchId: LAHORE,
    branchCode: 'LHR-01',
    branchName: 'Lahore Central',
    branchStatus: 'active',
    weekStart: '2026-10-26',
    weekEnd: '2026-11-01',
    status: 'draft',
    amount: '12500.00',
    count: 3,
    amountIsFrozen: false,
    submittedAt: null,
    submittedByName: null,
    reviewedAt: null,
    reviewedByName: null,
    version: 1,
    ...overrides,
  };
}

const REPORTS: ReportListItem[] = [
  listItem(),
  listItem({
    id: 'a0000000-0000-4000-8000-000000000002',
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
  }),
  listItem({
    id: 'a0000000-0000-4000-8000-000000000003',
    branchId: KARACHI,
    branchCode: 'KHI-02',
    branchName: 'Karachi South',
    weekStart: '2026-10-19',
    weekEnd: '2026-10-25',
    status: 'submitted',
    amount: '0.00',
    count: 0,
    amountIsFrozen: true,
    submittedAt: '2026-10-26T06:00:00.000Z',
    submittedByName: 'Hina Lead',
  }),
];

const fetchMock = vi.fn<typeof fetch>();

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method,
    contentType: new Headers(init?.headers).get('content-type'),
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no modal dialog support
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

describe('reportsHref', () => {
  it('builds the list URL from the active filters and keeps the default limit out', () => {
    expect(reportsHref({})).toBe('/reports');
    expect(reportsHref({ status: 'submitted', branchId: LAHORE, weekStart: '2026-10-26' })).toBe(
      `/reports?status=submitted&branchId=${LAHORE}&weekStart=2026-10-26`,
    );
    expect(reportsHref({ status: 'draft', limit: 60 })).toBe('/reports?status=draft');
    expect(reportsHref({ status: 'draft' }, 120)).toBe('/reports?status=draft&limit=120');
  });
});

describe.each(LOCALES)('ReportsTable (%s)', (locale) => {
  it('links every week to its report and shows status, amount, count and people', () => {
    const { container } = renderWithIntl(<ReportsTable reports={REPORTS} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');

    const table = screen.getByRole('table', { name: msg(locale, 'list.caption') });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);

    const first = rows[0]!;
    const link = within(first).getByRole('link', {
      name: weekLabel(locale, '2026-10-26', '2026-11-01'),
    });
    expect(link).toHaveAttribute('href', '/reports/a0000000-0000-4000-8000-000000000001');
    expect(within(first).getByText(statusLabel(locale, 'draft'))).toBeInTheDocument();
    expect(within(first).getByText('PKR 12,500.00')).toHaveAttribute('dir', 'ltr');
    expect(within(first).getByText(msg(locale, 'amount.live'))).toBeInTheDocument();
    expect(within(first).getByText('3')).toBeInTheDocument();

    const approved = rows[1]!;
    expect(within(approved).getByText(statusLabel(locale, 'approved'))).toBeInTheDocument();
    expect(within(approved).getByText('PKR 40,250.50')).toBeInTheDocument();
    expect(within(approved).getByText(msg(locale, 'amount.frozen'))).toBeInTheDocument();
    expect(within(approved).getByText('Bilal Ahmed')).toBeInTheDocument();
    expect(within(approved).getByText('Sana Finance')).toBeInTheDocument();
    expect(
      within(approved).getByText(formatDateTime(new Date('2026-10-27T09:30:00.000Z'), locale)),
    ).toBeInTheDocument();

    // A submitted report is not reviewed yet, whatever the reviewer columns hold.
    const submitted = rows[2]!;
    expect(within(submitted).getByText('Hina Lead')).toBeInTheDocument();
    expect(table.textContent).not.toMatch(NON_LATIN_DIGITS);
  });

  it('adds the branch column with an isolated code only for head office', () => {
    const { unmount } = renderWithIntl(<ReportsTable reports={REPORTS} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(
      screen.queryByRole('columnheader', { name: msg(locale, 'columns.branch') }),
    ).not.toBeInTheDocument();
    unmount();

    renderWithIntl(<ReportsTable reports={REPORTS} showBranch />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(
      screen.getByRole('columnheader', { name: msg(locale, 'columns.branch') }),
    ).toBeInTheDocument();
    expect(screen.getByText('Karachi South')).toBeInTheDocument();
    const code = screen.getByText('KHI-02');
    expect(code.tagName).toBe('BDI');
    expect(code).toHaveAttribute('dir', 'ltr');
  });

  it('marks the current week', () => {
    renderWithIntl(<ReportsTable reports={REPORTS} currentWeek="2026-10-26" />, {
      locale,
      namespaces: NAMESPACES,
    });
    const marker = screen.getByText(msg(locale, 'list.thisWeek'));
    expect(marker.closest('tr')).toHaveTextContent(formatDate('2026-10-26', locale));
  });

  it('shows the empty state without a table', () => {
    renderWithIntl(<ReportsTable reports={[]} />, { locale, namespaces: NAMESPACES });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(msg(locale, 'list.empty'))).toBeInTheDocument();
    expect(screen.getByText(msg(locale, 'list.emptyBody'))).toBeInTheDocument();
  });
});

describe.each(LOCALES)('ReportFilters (%s)', (locale) => {
  const BRANCHES = [
    { id: LAHORE, name: 'Lahore Central', code: 'LHR-01' },
    { id: KARACHI, name: 'Karachi South', code: 'KHI-02' },
  ];

  it('is a native GET form with status, branch and a Monday week picker', () => {
    const { container } = renderWithIntl(
      <ReportFilters
        values={{ status: 'submitted', branchId: KARACHI, weekStart: '2026-10-19' }}
        branches={BRANCHES}
        total={1234}
      />,
      { locale, namespaces: NAMESPACES },
    );
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    const form = screen.getByRole('search', { name: msg(locale, 'list.filterLabel') });
    expect(form).toHaveAttribute('method', 'get');

    const status = screen.getByRole('combobox', { name: msg(locale, 'list.filterStatus') });
    expect(status).toHaveAttribute('name', 'status');
    expect(status).toHaveValue('submitted');
    expect(
      within(status)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      msg(locale, 'list.allStatuses'),
      ...['draft', 'submitted', 'returned', 'approved'].map((s) => statusLabel(locale, s)),
    ]);

    const branch = screen.getByRole('combobox', { name: msg(locale, 'list.filterBranch') });
    expect(branch).toHaveAttribute('name', 'branchId');
    expect(branch).toHaveValue(KARACHI);
    expect(within(branch).getByRole('option', { name: 'Lahore Central (LHR-01)' })).toHaveValue(
      LAHORE,
    );

    const week = screen.getByLabelText(msg(locale, 'list.filterWeek'));
    expect(week).toHaveAttribute('type', 'date');
    expect(week).toHaveAttribute('name', 'weekStart');
    expect(week).toHaveValue('2026-10-19');
    expect(week).toHaveAccessibleDescription(msg(locale, 'list.weekHint'));

    expect(screen.getByRole('button', { name: msg(locale, 'list.apply') })).toHaveAttribute(
      'type',
      'submit',
    );
    expect(screen.getByRole('link', { name: msg(locale, 'list.clear') })).toHaveAttribute(
      'href',
      '/reports',
    );
    // Latin digits with grouping in both locales.
    expect(screen.getByRole('status')).toHaveTextContent('1,234');
  });

  it('leaves out the branch filter and the clear link when they do not apply', () => {
    renderWithIntl(<ReportFilters values={{}} total={1} />, { locale, namespaces: NAMESPACES });
    expect(
      screen.queryByRole('combobox', { name: msg(locale, 'list.filterBranch') }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: msg(locale, 'list.clear') })).not.toBeInTheDocument();
  });

  it('says how many rows are shown when the list is cut', () => {
    renderWithIntl(<ReportFilters values={{}} total={75} shown={60} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      msg(locale, 'list.shown', { shown: '60', total: '75' }),
    );
  });
});

describe.each(LOCALES)('ReviewQueueList (%s)', (locale) => {
  const queue = [
    listItem({
      id: 'b0000000-0000-4000-8000-000000000001',
      status: 'submitted',
      amountIsFrozen: true,
      submittedAt: '2026-10-20T05:00:00.000Z',
      submittedByName: 'Bilal Ahmed',
    }),
    listItem({
      id: 'b0000000-0000-4000-8000-000000000002',
      branchName: 'Karachi South',
      branchCode: 'KHI-02',
      status: 'submitted',
      amountIsFrozen: true,
      submittedAt: '2026-11-01T05:00:00.000Z',
      submittedByName: 'Hina Lead',
    }),
  ];

  it('keeps the server order, links each report and shows how long it has waited', () => {
    renderWithIntl(<ReviewQueueList reports={queue} today="2026-11-01" />, {
      locale,
      namespaces: NAMESPACES,
    });
    const list = screen.getByRole('list', { name: msg(locale, 'review.caption') });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-report-id'))).toEqual([
      'b0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000002',
    ]);
    expect(within(items[0]!).getByRole('link', { name: 'Lahore Central' })).toHaveAttribute(
      'href',
      '/reports/b0000000-0000-4000-8000-000000000001',
    );
    expect(items[0]).toHaveTextContent(
      plural(locale, 'review.waitingDays', 'other', { days: '12' }),
    );
    expect(items[1]).toHaveTextContent(plural(locale, 'review.waitingDays', '=0'));
    expect(list.textContent).not.toMatch(NON_LATIN_DIGITS);
  });

  it('shows the empty state when nothing is waiting', () => {
    renderWithIntl(<ReviewQueueList reports={[]} today="2026-11-01" />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText(msg(locale, 'review.empty'))).toBeInTheDocument();
  });
});

const REPORT_ID = 'c0000000-0000-4000-8000-000000000001';

function detail(overrides: Partial<ReportDetail> = {}): ReportDetail {
  return {
    ...listItem({ id: REPORT_ID }),
    returnReason: null,
    liveAmount: '12500.00',
    liveCount: 3,
    frozenAmount: null,
    frozenCount: null,
    collections: [],
    events: [],
    allowedActions: [],
    ...overrides,
  };
}

const SUBMITTED_EVENT = {
  id: 'e1',
  type: 'submitted' as const,
  fromStatus: 'draft' as const,
  toStatus: 'submitted' as const,
  actorName: 'Bilal Ahmed',
  reason: null,
  occurredAt: '2026-10-26T05:00:00.000Z',
};
const RETURNED_EVENT = {
  id: 'e2',
  type: 'returned' as const,
  fromStatus: 'submitted' as const,
  toStatus: 'returned' as const,
  actorName: 'Sana Finance',
  reason: 'Receipt total does not match',
  occurredAt: '2026-10-27T09:30:00.000Z',
};
const RESUBMITTED_EVENT = {
  id: 'e3',
  type: 'resubmitted' as const,
  fromStatus: 'returned' as const,
  toStatus: 'submitted' as const,
  actorName: 'Bilal Ahmed',
  reason: null,
  occurredAt: '2026-10-28T04:00:00.000Z',
};

function actionsFor(report: ReportDetail, extra?: ReactNode) {
  return (
    <ReportActions
      reportId={report.id}
      status={report.status}
      allowedActions={report.allowedActions}
      liveCount={report.liveCount}
      liveAmount={report.liveAmount}
      branchName={report.branchName}
      frozenAmount={report.frozenAmount}
      extra={extra}
    />
  );
}

describe('lifecycleSteps', () => {
  it('shows Returned only once a return has happened and marks the current status', () => {
    expect(lifecycleSteps('draft', [])).toEqual([
      { key: 'draft', state: 'current' },
      { key: 'submitted', state: 'upcoming' },
      { key: 'approved', state: 'upcoming' },
    ]);
    expect(lifecycleSteps('submitted', [SUBMITTED_EVENT]).map((s) => s.state)).toEqual([
      'complete',
      'current',
      'upcoming',
    ]);
    expect(lifecycleSteps('returned', [SUBMITTED_EVENT, RETURNED_EVENT])).toEqual([
      { key: 'draft', state: 'complete' },
      { key: 'submitted', state: 'complete' },
      { key: 'returned', state: 'current' },
      { key: 'resubmitted', state: 'upcoming' },
      { key: 'approved', state: 'upcoming' },
    ]);
    expect(
      lifecycleSteps('approved', [SUBMITTED_EVENT, RETURNED_EVENT, RESUBMITTED_EVENT]).at(-1),
    ).toEqual({ key: 'approved', state: 'current' });
  });
});

describe.each(LOCALES)('ReportSummary and ReportTotals (%s)', (locale) => {
  it('shows branch, week, status and the stepper with the current step', () => {
    const { container } = renderWithIntl(
      <ReportSummary report={detail({ status: 'submitted', events: [SUBMITTED_EVENT] })} />,
      { locale, namespaces: NAMESPACES },
    );
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(screen.getByRole('heading', { level: 1, name: 'Lahore Central' })).toBeInTheDocument();
    expect(screen.getByText('LHR-01').tagName).toBe('BDI');
    expect(
      screen.getByText(weekLabel(locale, '2026-10-26', '2026-11-01')).closest('time'),
    ).toHaveAttribute('dateTime', '2026-10-26');
    expect(screen.getByTestId('report-status')).toHaveTextContent(statusLabel(locale, 'submitted'));

    const stepper = screen.getByRole('list', { name: msg(locale, 'detail.lifecycle') });
    const steps = within(stepper).getAllByRole('listitem');
    expect(steps.map((li) => li.getAttribute('data-step'))).toEqual([
      'draft',
      'submitted',
      'approved',
    ]);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: msg(locale, 'detail.back') })).toHaveAttribute(
      'href',
      '/reports',
    );
    expect(screen.queryByText(msg(locale, 'detail.returnReasonTitle'))).not.toBeInTheDocument();
    expect(screen.queryByText(msg(locale, 'detail.lockedTitle'))).not.toBeInTheDocument();
  });

  it('shows the return reason prominently on a returned report', () => {
    renderWithIntl(
      <ReportSummary
        report={detail({
          status: 'returned',
          returnReason: 'Receipt total does not match',
          reviewedAt: '2026-10-27T09:30:00.000Z',
          reviewedByName: 'Sana Finance',
          events: [SUBMITTED_EVENT, RETURNED_EVENT],
          allowedActions: ['submit'],
        })}
      />,
      { locale, namespaces: NAMESPACES },
    );
    const callout = screen.getByRole('region', { name: msg(locale, 'detail.returnReasonTitle') });
    expect(callout).toHaveAttribute('data-callout', 'warning');
    expect(within(callout).getByText('Receipt total does not match')).toBeInTheDocument();
    expect(within(callout).getByText(msg(locale, 'detail.returnReasonNext'))).toBeInTheDocument();
    expect(callout).toHaveTextContent('Sana Finance');
    const returned = screen
      .getAllByRole('listitem')
      .find((li) => li.getAttribute('data-step') === 'returned');
    expect(returned).toHaveAttribute('aria-current', 'step');
  });

  it('shows the locked banner on an approved report', () => {
    renderWithIntl(
      <ReportSummary
        report={detail({
          status: 'approved',
          reviewedAt: '2026-10-29T09:30:00.000Z',
          reviewedByName: 'Sana Finance',
          events: [SUBMITTED_EVENT],
        })}
      />,
      { locale, namespaces: NAMESPACES },
    );
    const banner = screen.getByRole('region', { name: msg(locale, 'detail.lockedTitle') });
    expect(banner).toHaveAttribute('data-callout', 'success');
    expect(within(banner).getByText(msg(locale, 'detail.lockedBody'))).toBeInTheDocument();
  });

  it('labels the total live while open and frozen at submission once submitted', () => {
    const { unmount } = renderWithIntl(
      <ReportTotals report={detail({ status: 'draft', liveAmount: '1500.00', liveCount: 2 })} />,
      { locale, namespaces: NAMESPACES },
    );
    let totals = screen.getByRole('region', { name: msg(locale, 'detail.totals') });
    expect(totals).toHaveAttribute('data-totals', 'live');
    expect(within(totals).getByText(msg(locale, 'detail.liveTotal'))).toBeInTheDocument();
    expect(screen.getByTestId('report-total')).toHaveTextContent('PKR 1,500.00');
    unmount();

    renderWithIntl(
      <ReportTotals
        report={detail({
          status: 'submitted',
          amountIsFrozen: true,
          liveAmount: '999.00',
          liveCount: 1,
          frozenAmount: '1500.00',
          frozenCount: 2,
        })}
        note={msg(locale, 'detail.waitingReview')}
      />,
      { locale, namespaces: NAMESPACES },
    );
    totals = screen.getByRole('region', { name: msg(locale, 'detail.totals') });
    expect(totals).toHaveAttribute('data-totals', 'frozen');
    expect(within(totals).getByText(msg(locale, 'detail.frozenTotal'))).toBeInTheDocument();
    expect(screen.getByTestId('report-total')).toHaveTextContent('PKR 1,500.00');
    expect(screen.getByTestId('report-note')).toHaveTextContent(
      msg(locale, 'detail.waitingReview'),
    );
    expect(totals.textContent).not.toMatch(NON_LATIN_DIGITS);
  });
});

describe.each(LOCALES)('ReportActions (%s)', (locale) => {
  const button = (key: string) => screen.queryByRole('button', { name: msg(locale, key) });

  it('offers a Branch Lead only Submit on a draft and posts an empty JSON body', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { data: {} }));
    renderWithIntl(actionsFor(detail({ allowedActions: ['submit'] })), {
      locale,
      namespaces: NAMESPACES,
    });
    expect(button('actions.approve')).not.toBeInTheDocument();
    expect(button('actions.return')).not.toBeInTheDocument();
    expect(button('actions.resubmit')).not.toBeInTheDocument();

    await user.click(button('actions.submit')!);
    const dialog = screen.getByRole('dialog', { name: msg(locale, 'actions.confirmSubmitTitle') });
    expect(dialog).toHaveTextContent('PKR 12,500.00');
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: msg(locale, 'actions.submit') }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      {
        url: `/api/v1/reports/${REPORT_ID}/submit`,
        method: 'POST',
        contentType: 'application/json',
        body: {},
      },
    ]);
    expect(await screen.findByText(msg(locale, 'actions.done'))).toBeInTheDocument();
  });

  it('requires an explicit nil confirmation for a report with no collections', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { data: {} }));
    renderWithIntl(
      actionsFor(detail({ liveAmount: '0.00', liveCount: 0, allowedActions: ['submit'] })),
      { locale, namespaces: NAMESPACES },
    );
    await user.click(button('actions.submit')!);
    const dialog = screen.getByRole('dialog', { name: msg(locale, 'actions.nilTitle') });
    expect(dialog).toHaveTextContent(msg(locale, 'actions.nilBody'));

    await user.click(within(dialog).getByRole('button', { name: msg(locale, 'actions.submit') }));
    expect(within(dialog).getByText(msg(locale, 'actions.nilRequired'))).toBeInTheDocument();
    const checkbox = within(dialog).getByRole('checkbox', {
      name: msg(locale, 'actions.nilConfirmLabel'),
    });
    expect(checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(checkbox);
    await user.click(within(dialog).getByRole('button', { name: msg(locale, 'actions.submit') }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      {
        url: `/api/v1/reports/${REPORT_ID}/submit`,
        method: 'POST',
        contentType: 'application/json',
        body: { confirmNil: true },
      },
    ]);
  });

  it('asks for the nil confirmation when the server finds no collections', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(422, {
        error: {
          code: 'validation_failed',
          details: {
            fields: [
              {
                path: 'confirmNil',
                code: 'nil_confirmation_required',
                message: 'nil_confirmation_required',
              },
            ],
          },
        },
      }),
    );
    renderWithIntl(actionsFor(detail({ allowedActions: ['submit'] })), {
      locale,
      namespaces: NAMESPACES,
    });
    await user.click(button('actions.submit')!);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg(locale, 'actions.submit'),
      }),
    );
    const nil = await screen.findByRole('dialog', { name: msg(locale, 'actions.nilTitle') });
    expect(within(nil).getByText(msg(locale, 'errors.nil_confirmation_required'))).toBeVisible();
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('labels the action Resubmit on a returned report', () => {
    renderWithIntl(actionsFor(detail({ status: 'returned', allowedActions: ['submit'] })), {
      locale,
      namespaces: NAMESPACES,
    });
    expect(button('actions.resubmit')).toBeInTheDocument();
    expect(button('actions.submit')).not.toBeInTheDocument();
  });

  it('offers a Finance Reviewer Return and Approve on a submitted report', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { data: {} }));
    renderWithIntl(
      actionsFor(
        detail({
          status: 'submitted',
          amountIsFrozen: true,
          frozenAmount: '12500.00',
          frozenCount: 3,
          allowedActions: ['return', 'approve'],
        }),
      ),
      { locale, namespaces: NAMESPACES },
    );
    expect(button('actions.submit')).not.toBeInTheDocument();
    expect(button('actions.return')).toBeInTheDocument();

    await user.click(button('actions.approve')!);
    const dialog = screen.getByRole('dialog', {
      name: msg(locale, 'actions.confirmApproveTitle'),
    });
    expect(dialog).toHaveTextContent('Lahore Central');
    expect(dialog).toHaveTextContent('PKR 12,500.00');
    await user.click(within(dialog).getByRole('button', { name: msg(locale, 'actions.approve') }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      {
        url: `/api/v1/reports/${REPORT_ID}/approve`,
        method: 'POST',
        contentType: 'application/json',
        body: {},
      },
    ]);
  });

  it('requires a 3 to 500 character reason to return a report', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { data: {} }));
    renderWithIntl(
      actionsFor(detail({ status: 'submitted', allowedActions: ['return', 'approve'] })),
      { locale, namespaces: NAMESPACES },
    );
    await user.click(button('actions.return')!);
    const dialog = screen.getByRole('dialog', { name: msg(locale, 'actions.returnTitle') });
    const reason = within(dialog).getByRole('textbox', {
      name: msg(locale, 'actions.returnReasonLabel'),
    });
    expect(reason).toHaveAttribute('maxLength', '500');
    expect(reason).toHaveAccessibleDescription(msg(locale, 'actions.returnReasonHint'));

    await user.type(reason, '  ok ');
    await user.click(
      within(dialog).getByRole('button', { name: msg(locale, 'actions.returnConfirm') }),
    );
    expect(within(dialog).getByText(msg(locale, 'errors.too_short'))).toBeInTheDocument();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(reason);
    await user.type(reason, '  Receipt total does not match ');
    await user.click(
      within(dialog).getByRole('button', { name: msg(locale, 'actions.returnConfirm') }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(calls()).toEqual([
      {
        url: `/api/v1/reports/${REPORT_ID}/return`,
        method: 'POST',
        contentType: 'application/json',
        body: { reason: 'Receipt total does not match' },
      },
    ]);
  });

  it('maps a server reason error to the field', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      reply(422, {
        error: {
          code: 'validation_failed',
          details: { fields: [{ path: 'reason', code: 'too_big', message: 'too_long' }] },
        },
      }),
    );
    renderWithIntl(actionsFor(detail({ status: 'submitted', allowedActions: ['return'] })), {
      locale,
      namespaces: NAMESPACES,
    });
    await user.click(button('actions.return')!);
    const dialog = screen.getByRole('dialog', { name: msg(locale, 'actions.returnTitle') });
    await user.type(within(dialog).getByRole('textbox'), 'Receipt total does not match');
    await user.click(
      within(dialog).getByRole('button', { name: msg(locale, 'actions.returnConfirm') }),
    );
    expect(await within(dialog).findByText(msg(locale, 'errors.too_long'))).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('never offers Approve to the reviewer who submitted the report', () => {
    // The server leaves approve out of allowedActions for the submitter.
    renderWithIntl(actionsFor(detail({ status: 'submitted', allowedActions: ['return'] })), {
      locale,
      namespaces: NAMESPACES,
    });
    expect(button('actions.return')).toBeInTheDocument();
    expect(button('actions.approve')).not.toBeInTheDocument();
  });

  it('renders nothing when no action is allowed, as on an approved report', () => {
    const { container } = renderWithIntl(
      actionsFor(detail({ status: 'approved', allowedActions: [] })),
      { locale, namespaces: NAMESPACES },
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps room for extra controls even without lifecycle actions', () => {
    renderWithIntl(
      actionsFor(
        detail({ status: 'approved', allowedActions: [] }),
        <button type="button">extra-control</button>,
      ),
      { locale, namespaces: NAMESPACES },
    );
    expect(screen.getByRole('button', { name: 'extra-control' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: msg(locale, 'actions.title') })).toBeInTheDocument();
  });

  it('shows a conflict in an alert and refreshes the page to the current state', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(409, { error: { code: 'invalid_transition' } }));
    const props = detail({ status: 'submitted', allowedActions: ['return', 'approve'] });
    const { rerender } = renderWithIntl(actionsFor(props), { locale, namespaces: NAMESPACES });
    await user.click(button('actions.approve')!);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg(locale, 'actions.approve'),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(msg(locale, 'errors.invalid_transition')),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);

    // The refreshed page has no actions left; the message stays until dismissed.
    rerender(withIntl(locale, actionsFor({ ...props, status: 'approved', allowedActions: [] })));
    expect(screen.getByRole('alert')).toHaveTextContent(msg(locale, 'errors.invalid_transition'));
    expect(button('actions.approve')).not.toBeInTheDocument();
    await user.click(button('actions.dismiss')!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the generic message for an unknown failure without refreshing', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    renderWithIntl(actionsFor(detail({ allowedActions: ['submit'] })), {
      locale,
      namespaces: NAMESPACES,
    });
    await user.click(button('actions.submit')!);
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg(locale, 'actions.submit'),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(msg(locale, 'errors.generic')),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe.each(LOCALES)('ReportHistory (%s)', (locale) => {
  it('lists the lifecycle events in order with actor, time and return reason', () => {
    renderWithIntl(
      <ReportHistory events={[RESUBMITTED_EVENT, SUBMITTED_EVENT, RETURNED_EVENT]} />,
      { locale, namespaces: NAMESPACES },
    );
    const items = within(screen.getByTestId('report-history')).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-event-type'))).toEqual([
      'submitted',
      'returned',
      'resubmitted',
    ]);
    expect(items[1]).toHaveTextContent(msg(locale, 'events.returned'));
    expect(items[1]).toHaveTextContent(msg(locale, 'events.by', { name: 'Sana Finance' }));
    expect(items[1]).toHaveTextContent('Receipt total does not match');
    expect(items[1]).toHaveTextContent(formatDateTime(new Date(RETURNED_EVENT.occurredAt), locale));
    expect(items[0]).not.toHaveTextContent(msg(locale, 'events.reason'));
  });

  it('explains an empty history', () => {
    renderWithIntl(<ReportHistory events={[]} />, { locale, namespaces: NAMESPACES });
    expect(screen.getByText(msg(locale, 'detail.historyEmpty'))).toBeInTheDocument();
  });
});

describe.each(LOCALES)('ReportCollectionsTable (%s)', (locale) => {
  const rows = [
    {
      id: 'd0000000-0000-4000-8000-000000000001',
      collectedOn: '2026-10-27',
      amount: '1000.00',
      purpose: 'Food drive',
      status: 'active' as const,
      voidReason: null,
      routedAt: null,
      createdByName: 'Bilal Ahmed',
    },
    {
      id: 'd0000000-0000-4000-8000-000000000002',
      collectedOn: '2026-10-28',
      amount: '250.00',
      purpose: 'Clinic',
      status: 'voided' as const,
      voidReason: 'Entered twice',
      routedAt: null,
      createdByName: 'Bilal Ahmed',
    },
  ];

  it('links each collection, mutes voided rows with their reason and shows the total', () => {
    renderWithIntl(<ReportCollectionsTable collections={rows} total="1000.00" totalIsFrozen />, {
      locale,
      namespaces: NAMESPACES,
    });
    const table = screen.getByRole('table', { name: msg(locale, 'detail.collections') });
    const body = within(table).getAllByRole('row').slice(1, 3);
    expect(
      within(body[0]!).getByRole('link', { name: formatDate('2026-10-27', locale) }),
    ).toHaveAttribute('href', '/collections/d0000000-0000-4000-8000-000000000001');
    expect(body[1]).toHaveAttribute('data-collection-status', 'voided');
    expect(body[1]).toHaveTextContent(
      msg(locale, 'detail.voidedBecause', { reason: 'Entered twice' }),
    );
    expect(within(body[1]!).getByText(statusLabel(locale, 'voided'))).toBeInTheDocument();
    expect(screen.getByTestId('collections-total')).toHaveTextContent('PKR 1,000.00');
    expect(within(table).getByText(msg(locale, 'amount.frozen'))).toBeInTheDocument();
    expect(table.textContent).not.toMatch(NON_LATIN_DIGITS);
  });

  it('explains an empty week', () => {
    renderWithIntl(<ReportCollectionsTable collections={[]} total="0.00" totalIsFrozen={false} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(msg(locale, 'detail.collectionsEmpty'))).toBeInTheDocument();
  });
});

describe('reports component sources', () => {
  it.each([
    'Panel.tsx',
    'ReportsTable.tsx',
    'ReportFilters.tsx',
    'ReportSummary.tsx',
    'ReportActions.tsx',
    'ReportHistory.tsx',
    'ReportCollectionsTable.tsx',
  ])('%s uses logical utilities only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });

  it('keeps client scripting to the actions and talks to the report endpoints', () => {
    const actions = readFileSync(path.resolve(import.meta.dirname, 'ReportActions.tsx'), 'utf8');
    expect(actions).toMatch(/^'use client';/);
    expect(actions).toContain('/api/v1/reports/');
    // Client code reads the module's pure files, never its server index.
    expect(actions).not.toMatch(/from '@\/modules\/reports'/);
  });

  it('keeps the list and filters free of client scripting', () => {
    for (const file of ['ReportsTable.tsx', 'ReportFilters.tsx']) {
      const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
      expect(source).not.toMatch(/^['"]use client['"]/m);
    }
  });
});
