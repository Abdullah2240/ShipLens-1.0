// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../../tests/support/render-intl';
import { FIGURES } from '@/modules/reporting/figures';
import type {
  DashboardSummary,
  FigureId,
  ReportingFilters,
  TrendSeries,
} from '@/modules/reporting/types';
import { CountFigures } from './CountFigures';
import { DashboardActions } from './DashboardActions';
import { DashboardTabs, activeDashboardTab } from './DashboardTabs';
import { MoneyFlow } from './MoneyFlow';
import { TrendSection } from './TrendSection';
import { buildDashboardModel } from './dashboard-view-model';

const nav = vi.hoisted(() => ({ pathname: '/dashboard' }));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.setConfig({ testTimeout: 20000 });

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  nav.pathname = '/dashboard';
});

const LOCALES = ['en', 'ur'] as const;
const NAMESPACES = ['common', 'trace', 'dashboard'];
const AS_OF = '2026-10-31T10:15:00.000Z';
const FILTERS: ReportingFilters = { from: '2026-08', to: '2026-10' };
const Q = '?from=2026-08&to=2026-10';

const LABELS = {
  en: {
    collected: 'Collected',
    approved: 'Approved',
    pending_approval: 'Pending approval',
    in_progress: 'In progress',
    routed: 'Routed to main account',
    not_yet_routed: 'Not yet routed',
    active_branches: 'Active branches',
    reports_awaiting_review: 'Reports awaiting review',
    explain: /How is this calculated/,
  },
  ur: {
    collected: 'وصول شدہ',
    approved: 'منظور شدہ',
    pending_approval: 'زیرِ جائزہ',
    in_progress: 'زیرِ تکمیل',
    routed: 'مرکزی اکاؤنٹ میں منتقل شدہ',
    not_yet_routed: 'ابھی منتقل نہیں ہوئی',
    active_branches: 'فعال شاخیں',
    reports_awaiting_review: 'جائزے کی منتظر رپورٹیں',
    explain: /اس کا حساب کیسے ہوا/,
  },
} as const;

function figure(id: FigureId, value: string, recordCount: number) {
  return { figure: id, measure: FIGURES[id].measure, value, recordCount };
}

const SUMMARY: DashboardSummary = {
  asOf: AS_OF,
  filters: FILTERS,
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

const ZERO = { notYetRouted: '0.00', routed: '0.00' };
const TREND: TrendSeries = {
  asOf: AS_OF,
  filters: FILTERS,
  months: [
    {
      month: '2026-08',
      collected: '1500.00',
      approved: '1500.00',
      pendingApproval: '0.00',
      inProgress: '0.00',
      ...ZERO,
    },
    {
      month: '2026-09',
      collected: '590.75',
      approved: '250.50',
      pendingApproval: '300.00',
      inProgress: '40.25',
      ...ZERO,
    },
    {
      month: '2026-10',
      collected: '10.00',
      approved: '0.00',
      pendingApproval: '0.00',
      inProgress: '10.00',
      ...ZERO,
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

const MODEL = buildDashboardModel(SUMMARY, TREND, FILTERS);

function expectLogical(container: HTMLElement) {
  expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
}

describe.each(LOCALES)('MoneyFlow (%s)', (locale) => {
  const L = LABELS[locale];

  it('renders Collected and Approved as figure links into level 1', () => {
    const { container } = renderWithIntl(<MoneyFlow model={MODEL} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container.getAttribute('dir')).toBe(locale === 'ur' ? 'rtl' : 'ltr');
    expect(container.getAttribute('lang')).toBe(locale);

    const collected = screen.getByRole('link', {
      name: new RegExp(`^${L.collected}، PKR 2,100\\.75|^${L.collected}, PKR 2,100\\.75`),
    });
    expect(collected.getAttribute('href')).toBe(`/dashboard/kpi/collected${Q}`);
    expect(collected.getAttribute('aria-label')).toContain('PKR 2,100.75');
    const approved = screen.getByRole('link', { name: new RegExp(`^${L.approved}[،,] PKR 1,750`) });
    expect(approved.getAttribute('href')).toBe(`/dashboard/kpi/approved${Q}`);
    expectLogical(container);
  });

  it('splits Collected and Approved with identity bars whose legend values link', () => {
    const { container } = renderWithIntl(<MoneyFlow model={MODEL} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const legend = (key: string) =>
      container.querySelector(`[data-legend-segment="${key}"] a`)?.getAttribute('href');
    expect(legend('approved')).toBe(`/dashboard/kpi/approved${Q}`);
    expect(legend('pending_approval')).toBe(`/dashboard/kpi/pending-approval${Q}`);
    expect(legend('in_progress')).toBe(`/dashboard/kpi/in-progress${Q}`);
    expect(legend('routed')).toBe(`/dashboard/kpi/routed${Q}`);
    expect(legend('not_yet_routed')).toBe(`/dashboard/kpi/not-yet-routed${Q}`);
    const collectedPanel = container.querySelector('[data-flow-panel="collected"]');
    const approvedPanel = container.querySelector('[data-flow-panel="approved"]');
    expect(collectedPanel?.querySelectorAll('[data-legend-segment]')).toHaveLength(3);
    expect(approvedPanel?.querySelectorAll('[data-legend-segment]')).toHaveLength(2);
    expect(container.querySelector('[data-identities]')?.getAttribute('data-identities')).toBe(
      'hold',
    );
  });

  it("opens Collected's drawer with its identity and the three live values", () => {
    renderWithIntl(<MoneyFlow model={MODEL} />, { locale, namespaces: NAMESPACES });
    const triggers = screen.getAllByRole('button', { name: L.explain });
    fireEvent.click(triggers[0]!);
    const dialog = screen.getByRole('dialog');
    const identity = dialog.querySelector('[data-holds]');
    expect(identity?.getAttribute('data-holds')).toBe('true');
    const text = identity?.textContent ?? '';
    for (const part of [L.collected, L.approved, L.pending_approval, L.in_progress]) {
      expect(text).toContain(part);
    }
    for (const amount of ['PKR 2,100.75', 'PKR 1,750.50', 'PKR 300.00', 'PKR 50.25']) {
      expect(text).toContain(amount);
    }
    expect(text.match(/\+/g)).toHaveLength(2);
  });

  it("opens Approved's drawer with Routed + Not yet routed", () => {
    renderWithIntl(<MoneyFlow model={MODEL} />, { locale, namespaces: NAMESPACES });
    const triggers = screen.getAllByRole('button', { name: L.explain });
    fireEvent.click(triggers[1]!);
    const identity = screen.getByRole('dialog').querySelector('[data-holds]');
    const text = identity?.textContent ?? '';
    expect(text).toContain(L.routed);
    expect(text).toContain(L.not_yet_routed);
    expect(text).toContain('PKR 250.50');
    expect(text).toContain('PKR 1,500.00');
  });

  it('offers a drawer for each of the four parts', () => {
    renderWithIntl(<MoneyFlow model={MODEL} />, { locale, namespaces: NAMESPACES });
    const group = screen.getByRole('group');
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.replace(/^i/, '').trim())).toEqual([
      L.pending_approval,
      L.in_progress,
      L.routed,
      L.not_yet_routed,
    ]);
  });

  it('marks broken identities', () => {
    const broken = buildDashboardModel(
      { ...SUMMARY, identities: { collected: false, approved: true } },
      TREND,
      FILTERS,
    );
    const { container } = renderWithIntl(<MoneyFlow model={broken} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container.querySelector('[data-identities]')?.getAttribute('data-identities')).toBe(
      'broken',
    );
  });
});

describe.each(LOCALES)('CountFigures (%s)', (locale) => {
  const L = LABELS[locale];

  it('renders both counts as linked cards with drawers', () => {
    const { container } = renderWithIntl(<CountFigures model={MODEL} />, {
      locale,
      namespaces: NAMESPACES,
    });
    const branches = screen.getByRole('link', { name: new RegExp(`^${L.active_branches}`) });
    expect(branches.getAttribute('href')).toBe(`/dashboard/kpi/active-branches${Q}`);
    expect(branches.textContent).toContain('2');
    const awaiting = screen.getByRole('link', {
      name: new RegExp(`^${L.reports_awaiting_review}`),
    });
    expect(awaiting.getAttribute('href')).toBe(`/dashboard/kpi/reports-awaiting-review${Q}`);
    expect(screen.getAllByRole('button', { name: L.explain })).toHaveLength(2);
    expectLogical(container);
  });
});

describe.each(LOCALES)('TrendSection (%s)', (locale) => {
  const L = LABELS[locale];

  it('renders the chart and a linked table alternative with totals', () => {
    const { container } = renderWithIntl(<TrendSection model={MODEL} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container.querySelector('svg[role="img"]')).not.toBeNull();
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    const table = within(details as HTMLElement).getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers.slice(1)).toEqual([L.approved, L.pending_approval, L.in_progress]);

    const hrefs = within(table)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/dashboard/kpi/approved?from=2026-09&to=2026-09');
    expect(hrefs).toContain('/dashboard/kpi/pending-approval?from=2026-09&to=2026-09');
    expect(hrefs).toContain('/dashboard/kpi/in-progress?from=2026-10&to=2026-10');
    // Zero cells are not links: 9 cells, 4 zeros.
    expect(hrefs).toHaveLength(5);

    const footer = table.querySelector('tfoot');
    expect(footer?.textContent).toContain('PKR 1,750.50');
    expect(footer?.textContent).toContain('PKR 300.00');
    expect(footer?.textContent).toContain('PKR 50.25');
    expectLogical(container);
  });
});

describe.each(LOCALES)('DashboardActions (%s)', (locale) => {
  it('lists four CSV downloads and a print link, all with the filters', () => {
    const { container } = renderWithIntl(
      <DashboardActions exportHref={MODEL.exportHref} printHref={MODEL.printHref} />,
      { locale, namespaces: NAMESPACES },
    );
    const downloads = [...container.querySelectorAll('details a[download]')].map((a) =>
      a.getAttribute('href'),
    );
    expect(downloads).toEqual([
      `/api/v1/exports/summary?from=2026-08&to=2026-10&locale=${locale}`,
      `/api/v1/exports/reports?figure=approved&from=2026-08&to=2026-10&locale=${locale}`,
      `/api/v1/exports/collections?figure=approved&from=2026-08&to=2026-10&locale=${locale}`,
      `/api/v1/exports/unrouted?from=2026-08&to=2026-10&locale=${locale}`,
    ]);
    const print = [...container.querySelectorAll('a')].find((a) => !a.hasAttribute('download'));
    expect(print?.getAttribute('href')).toBe(`/dashboard/print${Q}`);
    expect(container.firstElementChild?.className).toContain('print:hidden');
    expectLogical(container);
  });
});

describe.each(LOCALES)('DashboardTabs (%s)', (locale) => {
  it.each([
    ['/dashboard', 'overview'],
    ['/dashboard/kpi/approved/branches/x', 'overview'],
    ['/dashboard/unrouted', 'unrouted'],
  ])('marks the active tab on %s', (pathname, active) => {
    nav.pathname = pathname;
    const { container } = renderWithIntl(<DashboardTabs />, { locale, namespaces: NAMESPACES });
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/dashboard', '/dashboard/unrouted']);
    const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe(
      active === 'overview' ? '/dashboard' : '/dashboard/unrouted',
    );
    expect(screen.getByRole('navigation').className).toContain('print:hidden');
    expectLogical(container);
  });

  it('marks no tab elsewhere', () => {
    expect(activeDashboardTab('/dashboard/print')).toBeNull();
    expect(activeDashboardTab('/dashboard/unroutedx')).toBeNull();
  });
});
