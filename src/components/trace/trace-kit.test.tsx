// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithIntl } from '../../../tests/support/render-intl';
import type { Column } from '@/components/ui';
import { formatDateTime } from '@/platform/i18n/format';
import {
  ExplainDrawer,
  FigureLink,
  MonthRangeFilter,
  TRACE_FIGURE_IDS,
  TraceHeader,
  TraceTable,
  TrailBreadcrumb,
} from '.';

const nav = vi.hoisted(() => ({
  pathname: '/dashboard',
  search: '',
  push: vi.fn<(href: string) => void>(),
}));

// next-intl's createNavigation imports 'next/navigation' without an extension, which Node
// ESM cannot resolve under Vitest, so the locale-aware navigation is replaced by a stand-in.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const LOCALES = ['en', 'ur'] as const;
const MESSAGES = path.resolve(import.meta.dirname, '../../../messages');
const NAMESPACES = ['common', 'trace'];
const PHYSICAL =
  /(^|\s)!?(?:[\w-]+:)*-?(?:m[lr]-|p[lr]-|left-|right-|text-left\b|text-right\b|border-[lr]\b|rounded-[lr]\b)/;

type Messages = Record<string, unknown>;
function messages(locale: string, ns = 'trace'): Messages {
  return JSON.parse(readFileSync(path.join(MESSAGES, locale, `${ns}.json`), 'utf8')) as Messages;
}
function msg(locale: string, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Messages | undefined)?.[part], messages(locale));
  if (typeof value !== 'string') throw new Error(`missing trace.${key} (${locale})`);
  return value;
}

function expectLogicalOnly(root: HTMLElement) {
  for (const el of [root, ...root.querySelectorAll<HTMLElement>('[class]')]) {
    const cls = el.getAttribute('class') ?? '';
    expect(cls, `physical class in "${cls}"`).not.toMatch(PHYSICAL);
  }
}

beforeEach(() => {
  nav.pathname = '/dashboard';
  nav.search = '';
  nav.push.mockReset();
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('phase 3 namespaces', () => {
  const NEW = ['trace', 'drilldown', 'evidence', 'unrouted', 'exports', 'share'];

  it('are appended to the request namespace list after the existing ones', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../i18n/request.ts'), 'utf8');
    const list = /NAMESPACES = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? '';
    const names = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(names.slice(-NEW.length)).toEqual(NEW);
    expect(names.slice(0, 2)).toEqual(['common', 'errors']);
    for (const ns of names) {
      for (const locale of LOCALES) {
        expect(existsSync(path.join(MESSAGES, locale, `${ns}.json`)), `${locale}/${ns}`).toBe(true);
      }
    }
  });

  it('start empty except trace and the namespaces their owning plans have filled', () => {
    const FILLED = ['exports'];
    for (const ns of NEW.slice(1).filter((n) => !FILLED.includes(n))) {
      for (const locale of LOCALES) expect(messages(locale, ns)).toEqual({});
    }
  });

  it('define every figure with label, short, definition, includes and excludes', () => {
    for (const locale of LOCALES) {
      const figures = messages(locale).figures as Record<string, Record<string, string>>;
      expect(Object.keys(figures).sort()).toEqual([...TRACE_FIGURE_IDS].sort());
      for (const id of TRACE_FIGURE_IDS) {
        expect(Object.keys(figures[id] ?? {}).sort()).toEqual(
          ['definition', 'excludes', 'includes', 'label', 'short'].sort(),
        );
      }
    }
  });

  it('keeps Urdu copy in Urdu script with Latin digits only', () => {
    const ur = JSON.stringify(messages('ur'));
    expect(ur).not.toMatch(/[٠-٩۰-۹]/);
    expect(msg('ur', 'figures.approved.label')).toBe('منظور شدہ');
    expect(msg('ur', 'figures.pending_approval.label')).toBe('زیرِ جائزہ');
    expect(JSON.stringify(messages('en'))).not.toContain('!');
  });
});

describe.each(LOCALES)('TrailBreadcrumb (%s)', (locale) => {
  const crumbs = [
    { label: msg(locale, 'breadcrumb.dashboard'), href: '/dashboard' },
    { label: 'Approved', value: 'PKR 4,692,717.65', href: '/dashboard/kpi/approved' },
    {
      label: 'LHR-01',
      sublabel: 'Lahore Central',
      value: 'PKR 812,000.00',
      href: '/dashboard/kpi/approved/branches/b1',
    },
    { label: 'Week of 5 Oct 2026', value: 'PKR 92,500.00' },
  ];

  it('renders an ordered trail with links, values and the current level', () => {
    const { container } = renderWithIntl(<TrailBreadcrumb crumbs={crumbs} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const navEl = screen.getByRole('navigation', { name: msg(locale, 'breadcrumb.label') });
    const list = within(navEl).getByRole('list');
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(4);

    const links = within(navEl).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard',
      '/dashboard/kpi/approved',
      '/dashboard/kpi/approved/branches/b1',
    ]);
    const current = navEl.querySelector('[aria-current="page"]');
    expect(current).not.toBeNull();
    expect(current?.tagName).not.toBe('A');
    expect(current).toHaveTextContent('Week of 5 Oct 2026');

    const values = [...navEl.querySelectorAll('bdi[dir="ltr"]')].map((b) => b.textContent);
    expect(values).toEqual(['PKR 4,692,717.65', 'PKR 812,000.00', 'PKR 92,500.00']);
    expect(navEl).toHaveTextContent('Lahore Central');

    const separators = navEl.querySelectorAll('[data-trail-separator]');
    expect(separators).toHaveLength(3);
    for (const sep of separators) {
      expect(sep).toHaveAttribute('aria-hidden', 'true');
      expect(sep.getAttribute('class')).toContain('rtl:-scale-x-100');
    }
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expectLogicalOnly(container);
  });
});

describe.each(LOCALES)('FigureLink (%s)', (locale) => {
  it('renders an accessible link with the value isolated left to right', () => {
    const { container } = renderWithIntl(
      <FigureLink href="/dashboard/kpi/approved" label="Approved: view by branch">
        PKR 4,692,717.65
      </FigureLink>,
      { locale, namespaces: NAMESPACES },
    );
    const link = screen.getByRole('link', { name: 'Approved: view by branch' });
    expect(link).toHaveAttribute('href', '/dashboard/kpi/approved');
    expect(link.className).toContain('tabular-nums');
    const bdi = link.querySelector('bdi[dir="ltr"]');
    expect(bdi).toHaveTextContent('PKR 4,692,717.65');
    const chevron = link.querySelector('svg');
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(chevron?.getAttribute('class')).toContain('rtl:-scale-x-100');
    expectLogicalOnly(container);
  });

  it('changes only typography between sizes', () => {
    const classes = (['sm', 'md', 'lg', 'xl'] as const).map((size) => {
      const { unmount } = renderWithIntl(
        <FigureLink href="/x" label={`l-${size}`} size={size}>
          1
        </FigureLink>,
        { locale, namespaces: NAMESPACES },
      );
      const cls = screen.getByRole('link', { name: `l-${size}` }).className.split(/\s+/);
      unmount();
      return new Set(cls);
    });
    const shared = [...(classes[0] ?? [])].filter((c) => classes.every((set) => set.has(c)));
    const typography = /^(?:\w+:)*(?:text-|leading-)/;
    for (const set of classes) {
      for (const c of set) if (!shared.includes(c)) expect(c).toMatch(typography);
    }
  });
});

type Row = { id: string; branch: string; amount: string };
const columns: Column<Row>[] = [
  { key: 'branch', header: 'Branch', render: (r) => r.branch },
  { key: 'amount', header: 'Amount', render: (r) => r.amount, align: 'numeric' },
];
const rows: Row[] = [
  { id: 'a', branch: 'LHR-01', amount: 'PKR 100.00' },
  { id: 'b', branch: 'KHI-02', amount: 'PKR 50.00' },
];

describe.each(LOCALES)('TraceTable (%s)', (locale) => {
  function renderTable(props: Partial<Parameters<typeof TraceTable<Row>>[0]> = {}) {
    return renderWithIntl(
      <TraceTable<Row>
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        caption="Approved by branch"
        measure="amount"
        total="PKR 150.00"
        recordCount={12}
        matchesParent={true}
        parentLabel="Approved"
        {...props}
      />,
      { locale, namespaces: NAMESPACES },
    );
  }

  it('shows the record count, the total and a success pill when it matches', () => {
    const { container } = renderTable();
    const foot = container.querySelector('tfoot');
    expect(foot).not.toBeNull();
    const total = locale === 'en' ? 'Total of 12 records' : '12 ریکارڈز کا میزان';
    expect(foot).toHaveTextContent(total);
    const cells = foot!.querySelectorAll('tr > *');
    expect(cells).toHaveLength(2);
    expect(cells[1]).toHaveTextContent('PKR 150.00');
    expect(cells[1]?.querySelector('bdi[dir="ltr"]')).toHaveTextContent('PKR 150.00');
    const pill = foot!.querySelector('[data-tone]');
    expect(pill).toHaveAttribute('data-tone', 'success');
    expect(pill).toHaveTextContent(msg(locale, 'table.matches').replace('{parent}', 'Approved'));
    expect(pill?.className).toContain('bg-tone-success-bg');
    expectLogicalOnly(container);
  });

  it('uses the singular form for one record', () => {
    const { container } = renderTable({ recordCount: 1 });
    const one = locale === 'en' ? 'Total of 1 record' : '1 ریکارڈ کا میزان';
    expect(container.querySelector('tfoot')).toHaveTextContent(one);
  });

  it('shows a danger pill when the total does not match', () => {
    const { container } = renderTable({ matchesParent: false });
    const pill = container.querySelector('tfoot [data-tone]');
    expect(pill).toHaveAttribute('data-tone', 'danger');
    expect(pill).toHaveTextContent(msg(locale, 'table.mismatch').replace('{parent}', 'Approved'));
  });

  it('shows no pill when there is no parent figure', () => {
    const { container } = renderTable({ matchesParent: null });
    expect(container.querySelector('tfoot [data-tone]')).toBeNull();
  });

  it('falls back to a generic parent label', () => {
    const { container } = renderTable({ parentLabel: undefined });
    const parent = msg(locale, 'table.parentFallback');
    expect(container.querySelector('tfoot [data-tone]')).toHaveTextContent(parent);
  });

  it('notes truncation while keeping the full total', () => {
    const { container } = renderTable({ recordCount: 640, truncated: { shown: 500 } });
    const note = locale === 'en' ? 'Showing the first 500 of 640 records' : '640 میں سے پہلے 500';
    expect(container.querySelector('tfoot')).toHaveTextContent(note);
  });

  it('places the total under the numeric column and pads the trailing columns', () => {
    const wide: Column<Row>[] = [...columns, { key: 'status', header: 'S', render: () => 'ok' }];
    const { container } = renderTable({ columns: wide });
    const cells = [...container.querySelectorAll('tfoot tr > *')];
    expect(cells).toHaveLength(3);
    expect(cells[1]).toHaveTextContent('PKR 150.00');
    expect(cells[2]).toBeEmptyDOMElement();
  });

  it('renders the caller empty state when there are no rows', () => {
    renderTable({ rows: [], empty: <p>nothing here</p> });
    expect(screen.getByText('nothing here')).toBeInTheDocument();
  });
});

describe.each(LOCALES)('TraceHeader (%s)', (locale) => {
  it('renders eyebrow, title, value, meta, chips, actions and the trail above the title', () => {
    const { container } = renderWithIntl(
      <TraceHeader
        eyebrow="By branch"
        title="Approved"
        value="PKR 4,692,717.65"
        meta="As of 31 Oct 2026"
        chips={[
          { label: 'From', value: 'Aug 2026' },
          { label: 'To', value: 'Oct 2026' },
        ]}
        actions={<button type="button">Export</button>}
        trail={<p data-testid="trail">trail</p>}
      />,
      { locale, namespaces: NAMESPACES },
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Approved' });
    const trail = screen.getByTestId('trail');
    expect(trail.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('By branch')).toBeInTheDocument();
    const value = container.querySelector('bdi[dir="ltr"]');
    expect(value).toHaveTextContent('PKR 4,692,717.65');
    expect(value?.parentElement?.className).toContain('tabular-nums');
    expect(screen.getByText('As of 31 Oct 2026')).toBeInTheDocument();

    const dl = container.querySelector('dl');
    expect(dl).toHaveAttribute('aria-label', msg(locale, 'explain.filters'));
    expect([...dl!.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['From', 'To']);
    expect([...dl!.querySelectorAll('dd')].map((d) => d.textContent)).toEqual([
      'Aug 2026',
      'Oct 2026',
    ]);
    const actions = screen.getByRole('button', { name: 'Export' }).parentElement;
    expect(actions?.className).toMatch(/justify-end|ms-auto/);
    expectLogicalOnly(container);
  });

  it('omits empty optional parts', () => {
    const { container } = renderWithIntl(<TraceHeader eyebrow="E" title="T" />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container.querySelector('dl')).toBeNull();
    expect(container.querySelector('bdi')).toBeNull();
  });
});

describe.each(LOCALES)('MonthRangeFilter (%s)', (locale) => {
  const months = ['2026-08', '2026-09', '2026-10'];

  function renderFilter(from?: string, to?: string) {
    return renderWithIntl(<MonthRangeFilter months={months} from={from} to={to} />, {
      locale,
      namespaces: NAMESPACES,
    });
  }

  it('lists all time plus every month with Latin digits in labelled selects', () => {
    const { container } = renderFilter();
    expect(screen.getByRole('group', { name: msg(locale, 'filter.legend') })).toBeInTheDocument();
    const from = screen.getByRole('combobox', { name: msg(locale, 'filter.from') });
    const to = screen.getByRole('combobox', { name: msg(locale, 'filter.to') });
    for (const select of [from, to]) {
      const options = within(select).getAllByRole('option');
      expect(options).toHaveLength(4);
      expect(options[0]).toHaveTextContent(msg(locale, 'filter.allTime'));
      expect(options.map((o) => o.getAttribute('value'))).toEqual(['', ...months]);
      expect(options[3]?.textContent).toContain('2026');
      expect(options[3]?.textContent).not.toMatch(/[٠-٩۰-۹]/);
    }
    expect(within(from).getAllByRole('option')[3]).toHaveTextContent(
      locale === 'en' ? 'October 2026' : 'اکتوبر 2026',
    );
    expectLogicalOnly(container);
  });

  it('applies the range, keeps other parameters and drops the page', async () => {
    nav.search = 'branch=b1&page=3&tab=open';
    renderFilter();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: msg(locale, 'filter.from') }), [
      '2026-08',
    ]);
    await user.selectOptions(screen.getByRole('combobox', { name: msg(locale, 'filter.to') }), [
      '2026-09',
    ]);
    await user.click(screen.getByRole('button', { name: msg(locale, 'filter.apply') }));
    expect(nav.push).toHaveBeenCalledWith('/dashboard?from=2026-08&to=2026-09&branch=b1&tab=open');
  });

  it('swaps a reversed range and allows an open end', async () => {
    renderFilter('2026-10', '2026-08');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: msg(locale, 'filter.apply') }));
    expect(nav.push).toHaveBeenLastCalledWith('/dashboard?from=2026-08&to=2026-10');

    await user.selectOptions(screen.getByRole('combobox', { name: msg(locale, 'filter.to') }), [
      '',
    ]);
    await user.click(screen.getByRole('button', { name: msg(locale, 'filter.apply') }));
    expect(nav.push).toHaveBeenLastCalledWith('/dashboard?from=2026-08');
  });

  it('clears from and to and keeps everything else', async () => {
    nav.pathname = '/dashboard/kpi/approved';
    nav.search = 'from=2026-08&to=2026-09&branch=b1&page=2';
    renderFilter('2026-08', '2026-09');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: msg(locale, 'filter.clear') }));
    expect(nav.push).toHaveBeenCalledWith('/dashboard/kpi/approved?branch=b1');
    expect(screen.getByRole('combobox', { name: msg(locale, 'filter.from') })).toHaveValue('');
  });

  it('pushes the bare path when nothing remains', async () => {
    nav.search = 'from=2026-08';
    renderFilter('2026-08');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: msg(locale, 'filter.clear') }));
    expect(nav.push).toHaveBeenCalledWith('/dashboard');
  });
});

describe.each(LOCALES)('ExplainDrawer (%s)', (locale) => {
  const asOf = '2026-10-31T09:05:00.000Z';
  const props = {
    figure: 'collected',
    value: 'PKR 5,439,002.59',
    recordCount: 1207,
    asOf,
    filters: [
      { label: 'From', value: 'Aug 2026' },
      { label: 'Branch', value: 'LHR-01' },
    ],
    identities: [
      {
        left: 'Collected PKR 30.00',
        right: 'Approved + Pending + In progress PKR 30.00',
        holds: true,
      },
      { left: 'Approved PKR 20.00', right: 'Routed + Not yet routed PKR 19.00', holds: false },
    ],
  };

  function renderDrawer(overrides: Partial<Parameters<typeof ExplainDrawer>[0]> = {}) {
    return renderWithIntl(
      <main>
        <button type="button">before</button>
        <ExplainDrawer {...props} {...overrides} />
      </main>,
      { locale, namespaces: NAMESPACES },
    );
  }

  it('opens a labelled modal dialog and moves focus to its heading', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    renderDrawer();
    const user = userEvent.setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: msg(locale, 'explain.open') }));

    // showModal puts the dialog in the top layer and makes the rest of the page inert.
    expect(showModal).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const heading = within(dialog).getByRole('heading', { level: 2 });
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id);
    expect(heading).toHaveTextContent(msg(locale, 'explain.title'));
    expect(heading).toHaveTextContent(msg(locale, 'figures.collected.label'));
    expect(heading).toHaveFocus();
    showModal.mockRestore();
  });

  it('shows every part of the explanation in order', async () => {
    renderDrawer();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: msg(locale, 'explain.open') }));
    const dialog = screen.getByRole('dialog');
    const text = dialog.textContent ?? '';

    expect(dialog.querySelector('bdi[dir="ltr"]')).toHaveTextContent('PKR 5,439,002.59');
    const parts = [
      'PKR 5,439,002.59',
      msg(locale, 'figures.collected.definition'),
      msg(locale, 'figures.collected.includes'),
      msg(locale, 'figures.collected.excludes'),
      'Aug 2026',
      'LHR-01',
      '1,207',
      formatDateTime(new Date(asOf), locale),
      'Approved + Pending + In progress PKR 30.00',
    ];
    const positions = parts.map((part) => text.indexOf(part));
    for (const [i, pos] of positions.entries()) expect(pos, parts[i]).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    expect(dialog.querySelector(`time[datetime="${asOf}"]`)).not.toBeNull();
    const lines = within(dialog).getAllByRole('listitem');
    const identity = lines.filter((li) => li.hasAttribute('data-holds'));
    expect(identity).toHaveLength(2);
    expect(identity[0]).toHaveAttribute('data-holds', 'true');
    expect(identity[0]).toHaveTextContent(msg(locale, 'explain.holds'));
    expect(identity[1]).toHaveAttribute('data-holds', 'false');
    expect(identity[1]).toHaveTextContent(msg(locale, 'explain.broken'));
  });

  it('says all time when no filter is active and hides identities when none are given', async () => {
    renderDrawer({ filters: [], identities: undefined });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: msg(locale, 'explain.open') }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(msg(locale, 'explain.allTime'));
    expect(dialog).not.toHaveTextContent(msg(locale, 'explain.identities'));
  });

  it('keeps Tab inside the dialog', async () => {
    renderDrawer();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: msg(locale, 'explain.open') }));
    const dialog = screen.getByRole('dialog');
    const closers = within(dialog).getAllByRole('button', { name: msg(locale, 'explain.close') });
    expect(closers).toHaveLength(2);
    const [top, bottom] = closers;

    await user.tab();
    expect(top).toHaveFocus();
    await user.tab();
    expect(bottom).toHaveFocus();
    await user.tab();
    expect(top).toHaveFocus();
    await user.tab({ shift: true });
    expect(bottom).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    renderDrawer();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: msg(locale, 'explain.open') });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes from the close button and returns focus to the trigger', async () => {
    renderDrawer({ triggerVariant: 'icon' });
    const user = userEvent.setup();
    const name = msg(locale, 'explain.openFor').replace(
      '{figure}',
      msg(locale, 'figures.collected.label'),
    );
    const trigger = screen.getByRole('button', { name });
    expect(trigger).toHaveTextContent('i');
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    await user.click(
      within(dialog).getAllByRole('button', { name: msg(locale, 'explain.close') })[1]!,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('uses a custom trigger label', () => {
    renderDrawer({ triggerLabel: 'Why this number' });
    expect(screen.getByRole('button', { name: 'Why this number' })).toBeInTheDocument();
  });

  it('is an inline-end sheet on wide screens, a bottom sheet on phones, tokens only', () => {
    const { container } = renderDrawer();
    const dialog = container.querySelector('dialog');
    const cls = dialog?.getAttribute('class') ?? '';
    expect(cls).toContain('sm:end-0');
    expect(cls).toContain('bottom-0');
    expect(cls).toMatch(/rtl:[\w:]*-translate-x-full/);
    expect(cls).toContain('motion-reduce:transition-none');
    expectLogicalOnly(container);
    for (const el of container.querySelectorAll<HTMLElement>('[class]')) {
      const c = el.getAttribute('class') ?? '';
      expect(c).not.toMatch(
        /#[0-9a-f]{3,6}|\b(?:bg|text|border|ring)-(?:white|black|gray|slate|zinc|stone)\b/,
      );
    }
  });
});
