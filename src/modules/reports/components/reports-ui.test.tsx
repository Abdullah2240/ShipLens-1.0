// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../tests/support/render-intl';
import { formatDate, formatDateTime } from '@/platform/i18n/format';
import type { ReportListItem } from '../types';
import { ReportFilters } from './ReportFilters';
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

beforeEach(() => {
  vi.clearAllMocks();
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

describe('reports component sources', () => {
  it.each(['ReportsTable.tsx', 'ReportFilters.tsx'])('%s uses logical utilities only', (file) => {
    const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
    expect(findPhysicalDirection(source, file)).toEqual([]);
  });

  it('keeps the list and filters free of client scripting', () => {
    for (const file of ['ReportsTable.tsx', 'ReportFilters.tsx']) {
      const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
      expect(source).not.toMatch(/^['"]use client['"]/m);
    }
  });
});
