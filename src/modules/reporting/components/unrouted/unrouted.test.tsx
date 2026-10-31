// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../../../tests/support/render-intl';
import { traceHref } from '@/modules/reporting/figures';
import type { RoutedRow, UnroutedRow } from '@/modules/reporting/types';
import { formatDate, formatMoney } from '@/platform/i18n/format';
import { RecentlyRoutedTable } from './RecentlyRoutedTable';
import { RoutingAction, RoutingStatusProvider } from './RoutingAction';
import { markRouted, unmarkRouted } from './routing-client';
import { UnroutedTable } from './UnroutedTable';

const nav = vi.hoisted(() => ({ refresh: vi.fn<() => void>() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: nav.refresh }),
  usePathname: () => '/dashboard/unrouted',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const LOCALES = ['en', 'ur'] as const;
type Locale = (typeof LOCALES)[number];
const NAMESPACES = ['common', 'trace', 'unrouted'];
const MESSAGES = path.resolve(import.meta.dirname, '../../../../../messages');
const PHYSICAL =
  /(^|\s)!?(?:[\w-]+:)*-?(?:m[lr]-|p[lr]-|left-|right-|text-left\b|text-right\b|border-[lr]\b|rounded-[lr]\b)/;

type Messages = Record<string, unknown>;
const cache = new Map<string, Messages>();
function messages(locale: string, ns: string): Messages {
  const key = `${locale}/${ns}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      JSON.parse(readFileSync(path.join(MESSAGES, locale, `${ns}.json`), 'utf8')) as Messages,
    );
  }
  return cache.get(key)!;
}
function raw(locale: string, key: string, ns = 'unrouted'): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Messages | undefined)?.[part], messages(locale, ns));
  if (typeof value !== 'string') throw new Error(`missing ${ns}.${key} (${locale})`);
  return value;
}
/** Simple `{name}` substitution, enough for the non-plural messages used here. */
function msg(locale: string, key: string, values: Record<string, string> = {}, ns = 'unrouted') {
  return raw(locale, key, ns).replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '');
}

function expectLogicalOnly(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('[class]')]) {
    const cls = el.getAttribute('class') ?? '';
    expect(cls, `physical class in "${cls}"`).not.toMatch(PHYSICAL);
  }
}

const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';
const REPORT_A = '33333333-3333-4333-8333-333333333333';
const REPORT_B = '44444444-4444-4444-8444-444444444444';
const COLL_A = '55555555-5555-4555-8555-555555555555';
const COLL_B = '66666666-6666-4666-8666-666666666666';

const UNROUTED: UnroutedRow[] = [
  {
    collectionId: COLL_A,
    branchId: BRANCH_A,
    branchCode: 'BR001',
    branchName: 'Lahore Central',
    reportId: REPORT_A,
    weekStart: '2026-08-31',
    collectedOn: '2026-08-31',
    purpose: 'Zakat',
    amount: '1000.00',
    approvedAt: '2026-09-05T07:00:00.000Z',
    daysWaiting: 1,
  },
  {
    collectionId: COLL_B,
    branchId: BRANCH_B,
    branchCode: 'BR002',
    branchName: 'Karachi East',
    reportId: REPORT_B,
    weekStart: '2026-10-05',
    collectedOn: '2026-10-12',
    purpose: 'Sadaqah',
    amount: '12500.00',
    approvedAt: '2026-10-20T07:00:00.000Z',
    daysWaiting: 12,
  },
];

const ROUTED: RoutedRow[] = [
  {
    collectionId: COLL_A,
    branchId: BRANCH_A,
    branchCode: 'BR001',
    branchName: 'Lahore Central',
    reportId: REPORT_A,
    weekStart: '2026-08-31',
    collectedOn: '2026-08-31',
    purpose: 'Zakat',
    amount: '1000.00',
    approvedAt: '2026-09-05T07:00:00.000Z',
    routedAt: '2026-11-01T06:00:00.000Z',
    routedByName: 'Bilal Ahmed',
  },
  {
    collectionId: COLL_B,
    branchId: BRANCH_B,
    branchCode: 'BR002',
    branchName: 'Karachi East',
    reportId: REPORT_B,
    weekStart: '2026-10-05',
    collectedOn: '2026-10-12',
    purpose: 'Sadaqah',
    amount: '12500.00',
    approvedAt: '2026-10-20T07:00:00.000Z',
    routedAt: '2026-10-30T06:00:00.000Z',
    routedByName: null,
  },
];

function summaryOf(
  locale: Locale,
  row: { branchCode: string; collectedOn: string; amount: string },
) {
  return msg(locale, 'summary', {
    code: row.branchCode,
    date: formatDate(row.collectedOn, locale),
    amount: formatMoney(row.amount, locale),
  });
}

type FetchReply = { status: number; body?: unknown } | Error;
let replies: FetchReply[] = [];
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

function queue(...items: FetchReply[]) {
  replies.push(...items);
}

beforeEach(() => {
  nav.refresh.mockReset();
  replies = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    const next = replies.shift() ?? { status: 200, body: { data: {} } };
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unrouted messages', () => {
  it('define the same keys in both locales, Urdu with Latin digits only', () => {
    const keys = (tree: Messages, prefix = ''): string[] =>
      Object.entries(tree).flatMap(([k, v]) =>
        v && typeof v === 'object' ? keys(v as Messages, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    expect(keys(messages('ur', 'unrouted')).sort()).toEqual(
      keys(messages('en', 'unrouted')).sort(),
    );
    for (const key of [
      'title',
      'lead',
      'tabs.open',
      'tabs.recent',
      'waitingDays',
      'actions.confirmMarkTitle',
      'toast.marked',
      'errors.already_routed',
      'errors.not_routed',
      'errors.not_approved',
      'errors.forbidden',
      'errors.not_found',
      'errors.network',
      'empty.openTitle',
      'filter.allBranches',
    ]) {
      expect(raw('en', key)).toBeTruthy();
      expect(raw('ur', key)).toBeTruthy();
    }
    expect(JSON.stringify(messages('ur', 'unrouted'))).not.toMatch(/[٠-٩۰-۹]/);
  });
});

describe.each(LOCALES)('UnroutedTable (%s)', (locale) => {
  const render = (props: Partial<Parameters<typeof UnroutedTable>[0]> = {}) =>
    renderWithIntl(
      <UnroutedTable
        rows={UNROUTED}
        totalAmount="13500.00"
        recordCount={2}
        parent={{ value: '13500.00', recordCount: 2 }}
        canRoute
        {...props}
      />,
      { locale, namespaces: NAMESPACES },
    );

  it('renders the columns in order with the action at the inline end', () => {
    const { container } = render();
    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim());
    expect(headers).toEqual([
      msg(locale, 'columns.branch'),
      msg(locale, 'columns.week'),
      msg(locale, 'columns.collectedOn'),
      msg(locale, 'columns.purpose'),
      msg(locale, 'columns.amount'),
      msg(locale, 'columns.approvedOn'),
      msg(locale, 'columns.waiting'),
      msg(locale, 'columns.action'),
    ]);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expectLogicalOnly(container);
  });

  it('shows codes, dates and amounts isolated left to right, amounts linking to evidence', () => {
    render();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1, 3);
    const first = rows[0]!;
    const cells = within(first).getAllByRole('cell');
    expect(cells[0]!.querySelector('bdi[dir="ltr"]')).toHaveTextContent('BR001');
    expect(cells[0]).toHaveTextContent('Lahore Central');
    expect(cells[1]!.querySelector('time')).toHaveAttribute('dateTime', '2026-08-31');
    expect(cells[1]).toHaveTextContent(formatDate('2026-08-31', locale));
    expect(cells[2]).toHaveTextContent(formatDate('2026-08-31', locale));
    expect(cells[3]).toHaveTextContent('Zakat');
    expect(cells[5]!.querySelector('time')).not.toBeNull();
    expect(cells[5]).toHaveTextContent(formatDate(new Date('2026-09-05T07:00:00.000Z'), locale));

    const link = within(cells[4]!).getByRole('link');
    expect(link).toHaveAttribute(
      'href',
      traceHref(
        'not_yet_routed',
        { branchId: BRANCH_A, reportId: REPORT_A, collectionId: COLL_A },
        {},
      ),
    );
    expect(link.querySelector('bdi[dir="ltr"]')).toHaveTextContent(formatMoney('1000.00', locale));
    expect(link).toHaveAccessibleName(
      msg(locale, 'amountLink', {
        amount: formatMoney('1000.00', locale),
        code: 'BR001',
        date: formatDate('2026-08-31', locale),
      }),
    );
  });

  it('shows days waiting with a plural', () => {
    render();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1, 3);
    const day = locale === 'en' ? '1 day' : '1 دن';
    const days = locale === 'en' ? '12 days' : '12 دن';
    expect(within(rows[0]!).getAllByRole('cell')[6]).toHaveTextContent(day);
    expect(within(rows[1]!).getAllByRole('cell')[6]).toHaveTextContent(days);
  });

  it('closes with the total, the record count and a Matches pill for the figure', () => {
    render();
    const foot = screen.getByRole('table').querySelector('tfoot')!;
    expect(foot).toHaveTextContent(formatMoney('13500.00', locale));
    const recordWord = locale === 'en' ? 'Total of 2 records' : '2 ریکارڈز کا میزان';
    expect(foot).toHaveTextContent(recordWord);
    const pill = foot.querySelector('[data-tone]');
    expect(pill).toHaveAttribute('data-tone', 'success');
    expect(pill).toHaveTextContent(
      msg(
        locale,
        'table.matches',
        {
          parent: raw(locale, 'figures.not_yet_routed.label', 'trace'),
        },
        'trace',
      ),
    );
  });

  it('flags a total that does not equal the figure', () => {
    render({ parent: { value: '13499.99', recordCount: 2 } });
    const pill = screen.getByRole('table').querySelector('tfoot [data-tone]');
    expect(pill).toHaveAttribute('data-tone', 'danger');
  });

  it('flags a record count that does not equal the figure', () => {
    render({ parent: { value: '13500.00', recordCount: 3 } });
    const pill = screen.getByRole('table').querySelector('tfoot [data-tone]');
    expect(pill).toHaveAttribute('data-tone', 'danger');
  });

  it('gives each row a mark action named after the collection', () => {
    render();
    const button = screen.getByRole('button', {
      name: msg(locale, 'actions.markFor', { summary: summaryOf(locale, UNROUTED[1]!) }),
    });
    expect(button).toHaveTextContent(msg(locale, 'actions.mark'));
  });

  it('omits the action column for a viewer who cannot route', () => {
    render({ canRoute: false });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  });

  it('shows the empty state when nothing waits', () => {
    render({ rows: [], totalAmount: '0.00', recordCount: 0 });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(msg(locale, 'empty.openTitle'));
  });
});

describe.each(LOCALES)('RecentlyRoutedTable (%s)', (locale) => {
  it('lists routed collections with routed on, routed by and an undo text button', () => {
    const { container } = renderWithIntl(<RecentlyRoutedTable rows={ROUTED} canRoute />, {
      locale,
      namespaces: NAMESPACES,
    });
    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim());
    expect(headers).toEqual([
      msg(locale, 'columns.branch'),
      msg(locale, 'columns.week'),
      msg(locale, 'columns.collectedOn'),
      msg(locale, 'columns.purpose'),
      msg(locale, 'columns.amount'),
      msg(locale, 'columns.routedOn'),
      msg(locale, 'columns.routedBy'),
      msg(locale, 'columns.action'),
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    const first = within(rows[0]!).getAllByRole('cell');
    expect(within(first[4]!).getByRole('link')).toHaveAttribute(
      'href',
      traceHref('routed', { branchId: BRANCH_A, reportId: REPORT_A, collectionId: COLL_A }, {}),
    );
    expect(first[5]!.querySelector('time')).toHaveAttribute('dateTime', '2026-11-01T06:00:00.000Z');
    expect(first[6]).toHaveTextContent('Bilal Ahmed');
    expect(within(rows[1]!).getAllByRole('cell')[6]).toHaveTextContent(
      msg(locale, 'routedByUnknown'),
    );
    const undo = screen.getByRole('button', {
      name: msg(locale, 'actions.undoFor', { summary: summaryOf(locale, ROUTED[0]!) }),
    });
    expect(undo).toHaveTextContent(msg(locale, 'actions.undo'));
    expect(undo).toHaveAttribute('data-variant', 'text');
    expectLogicalOnly(container);
  });

  it('shows the empty state when nothing was routed', () => {
    renderWithIntl(<RecentlyRoutedTable rows={[]} canRoute />, { locale, namespaces: NAMESPACES });
    expect(screen.getByRole('status')).toHaveTextContent(msg(locale, 'empty.recentTitle'));
  });
});

describe.each(LOCALES)('RoutingAction (%s)', (locale) => {
  const summary = summaryOf(locale, UNROUTED[1]!);

  function renderAction(mode: 'mark' | 'undo') {
    return renderWithIntl(<RoutingAction collectionId={COLL_B} mode={mode} summary={summary} />, {
      locale,
      namespaces: NAMESPACES,
    });
  }

  it('confirms, sends one POST, shows progress, refreshes and announces', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify({ data: { collectionId: COLL_B, routedAt: 'x' } }), {
                status: 200,
              }),
            );
        }),
    );
    const { container } = renderAction('mark');
    const trigger = screen.getByRole('button', {
      name: msg(locale, 'actions.markFor', { summary }),
    });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: msg(locale, 'actions.confirmMarkTitle') });
    expect(dialog).toHaveTextContent(summary);
    expect(fetchMock).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole('button', {
      name: msg(locale, 'actions.confirmMark'),
    });
    await user.dblClick(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/v1/collections/${COLL_B}/routed`);
    expect(init?.method).toBe('POST');

    const busy = screen.getByRole('button', { name: msg(locale, 'actions.markFor', { summary }) });
    expect(busy).toBeDisabled();
    expect(busy).toHaveTextContent(msg(locale, 'actions.marking'));

    await act(async () => release?.());
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    const live = container.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent(msg(locale, 'toast.marked', { summary }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expectLogicalOnly(container);
  });

  it('does nothing when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderAction('mark');
    await user.click(
      screen.getByRole('button', { name: msg(locale, 'actions.markFor', { summary }) }),
    );
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: raw(locale, 'actions.cancel', 'common') }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('shows the localized conflict and refreshes when already routed', async () => {
    const user = userEvent.setup();
    queue({ status: 409, body: { error: { code: 'already_routed', message: 'x' } } });
    renderAction('mark');
    await user.click(
      screen.getByRole('button', { name: msg(locale, 'actions.markFor', { summary }) }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg(locale, 'actions.confirmMark'),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(msg(locale, 'errors.already_routed')),
    );
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: msg(locale, 'actions.markFor', { summary }) }),
    ).toBeEnabled();
  });

  it('keeps the row and does not refresh after a network failure', async () => {
    const user = userEvent.setup();
    queue(new TypeError('Failed to fetch'));
    renderAction('mark');
    await user.click(
      screen.getByRole('button', { name: msg(locale, 'actions.markFor', { summary }) }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg(locale, 'actions.confirmMark'),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(msg(locale, 'errors.network')),
    );
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('undo confirms, sends DELETE, refreshes and announces', async () => {
    const user = userEvent.setup();
    queue({ status: 200, body: { data: { collectionId: COLL_B, routedAt: null } } });
    const { container } = renderAction('undo');
    const trigger = screen.getByRole('button', {
      name: msg(locale, 'actions.undoFor', { summary }),
    });
    expect(trigger).toHaveAttribute('data-variant', 'text');
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: msg(locale, 'actions.confirmUndoTitle') });
    expect(dialog).toHaveTextContent(summary);
    await user.click(
      within(dialog).getByRole('button', { name: msg(locale, 'actions.confirmUndo') }),
    );
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('DELETE');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      msg(locale, 'toast.undone', { summary }),
    );
  });

  it('undo shows the not routed conflict and refreshes', async () => {
    const user = userEvent.setup();
    queue({ status: 409, body: { error: { code: 'not_routed' } } });
    renderAction('undo');
    await user.click(
      screen.getByRole('button', { name: msg(locale, 'actions.undoFor', { summary }) }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg(locale, 'actions.confirmUndo'),
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(msg(locale, 'errors.not_routed')),
    );
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it('announces through a shared provider that outlives the row', async () => {
    const user = userEvent.setup();
    const { rerender, container } = renderWithIntl(
      <RoutingStatusProvider>
        <RoutingAction collectionId={COLL_B} mode="mark" summary={summary} />
      </RoutingStatusProvider>,
      { locale, namespaces: NAMESPACES },
    );
    await user.click(
      screen.getByRole('button', { name: msg(locale, 'actions.markFor', { summary }) }),
    );
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: msg(locale, 'actions.confirmMark'),
      }),
    );
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    void rerender;
    const live = container.querySelectorAll('[aria-live="polite"]');
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent(msg(locale, 'toast.marked', { summary }));
  });
});

describe('routing-client', () => {
  const ID = COLL_A;

  it('POSTs with same-origin credentials and no content type when there is no body', async () => {
    queue({ status: 200, body: { data: { collectionId: ID, routedAt: '2026-11-01T06:00:00Z' } } });
    await expect(markRouted(ID)).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/v1/collections/${ID}/routed`);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.has('content-type')).toBe(false);
    expect(headers.get('accept')).toBe('application/json');
  });

  it('DELETEs the same path', async () => {
    queue({ status: 200, body: { data: { collectionId: ID, routedAt: null } } });
    await expect(unmarkRouted(ID)).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/v1/collections/${ID}/routed`);
    expect(fetchMock.mock.calls[0]![1]?.method).toBe('DELETE');
    expect(fetchMock.mock.calls[0]![1]?.credentials).toBe('same-origin');
  });

  it('escapes the id into the path', async () => {
    await markRouted('a/b');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/collections/a%2Fb/routed');
  });

  it.each([
    [409, 'already_routed', 'already_routed'],
    [409, 'not_routed', 'not_routed'],
    [409, 'not_approved', 'not_approved'],
    [403, 'forbidden', 'forbidden'],
    [404, 'not_found', 'not_found'],
  ] as const)('maps %i %s to %s', async (status, code, expected) => {
    queue({ status, body: { error: { code, message: 'm' } } });
    await expect(markRouted(ID)).resolves.toEqual({ ok: false, code: expected });
  });

  it('falls back on the status when the body has no known code', async () => {
    queue(
      { status: 403, body: { error: { code: 'something_else' } } },
      { status: 401, body: { error: { code: 'unauthenticated' } } },
      { status: 404 },
      { status: 409, body: null },
      { status: 409, body: null },
      { status: 500, body: { error: { code: 'internal' } } },
    );
    await expect(markRouted(ID)).resolves.toEqual({ ok: false, code: 'forbidden' });
    await expect(markRouted(ID)).resolves.toEqual({ ok: false, code: 'forbidden' });
    await expect(markRouted(ID)).resolves.toEqual({ ok: false, code: 'not_found' });
    await expect(markRouted(ID)).resolves.toEqual({ ok: false, code: 'already_routed' });
    await expect(unmarkRouted(ID)).resolves.toEqual({ ok: false, code: 'not_routed' });
    await expect(markRouted(ID)).resolves.toEqual({ ok: false, code: 'network' });
  });

  it('maps a failed request to network', async () => {
    queue(new TypeError('Failed to fetch'));
    await expect(unmarkRouted(ID)).resolves.toEqual({ ok: false, code: 'network' });
  });
});
