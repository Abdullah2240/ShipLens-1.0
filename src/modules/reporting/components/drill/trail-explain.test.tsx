// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../../../tests/support/render-intl';
import type { Explanation } from '@/modules/reporting/types';
import { LevelExplain } from './LevelExplain';
import { TraceTrail, type TrailStepLike } from './TraceTrail';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.setConfig({ testTimeout: 20000 });

beforeAll(() => {
  // jsdom has no showModal; the drawer only needs open/close to toggle.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

const LOCALES = ['en', 'ur'] as const;
const NAMESPACES = ['common', 'trace', 'dashboard'];
const BRANCH = '7d3c1a52-9b8e-4c1f-a2b3-0e5f6a7b8c9d';
const REPORT = '9a683b03-1111-4c1f-a2b3-0e5f6a7b8c9d';
const COLLECTION = '24636f8f-2222-4c1f-a2b3-0e5f6a7b8c9d';

const L1 = '/dashboard/kpi/approved';
const L2 = `${L1}/branches/${BRANCH}`;
const L3 = `${L2}/reports/${REPORT}`;
const L4 = `${L3}/collections/${COLLECTION}`;

const STEPS: TrailStepLike[] = [
  {
    kind: 'dashboard',
    href: '/dashboard',
    figure: 'approved',
    measure: 'amount',
    value: '1750.50',
  },
  { kind: 'figure', href: L1, figure: 'approved', measure: 'amount', value: '1750.50' },
  {
    kind: 'branch',
    href: L2,
    figure: 'approved',
    measure: 'amount',
    value: '1250.50',
    branchCode: 'LHR-01',
    branchName: 'Lahore Central',
  },
  {
    kind: 'report',
    href: L3,
    figure: 'approved',
    measure: 'amount',
    value: '1250.50',
    weekStart: '2026-08-31',
  },
  {
    kind: 'collection',
    href: L4,
    figure: 'approved',
    measure: 'amount',
    value: '1000.00',
    collectedOn: '2026-09-01',
  },
];

describe.each(LOCALES)('TraceTrail (%s)', (locale) => {
  it('renders every step as a crumb carrying its value, the last one current', () => {
    const { container } = renderWithIntl(<TraceTrail steps={STEPS} />, {
      locale,
      namespaces: NAMESPACES,
    });
    expect(container.getAttribute('dir')).toBe(locale === 'ur' ? 'rtl' : 'ltr');
    const nav = screen.getByRole('navigation');
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(5);

    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/dashboard', L1, L2, L3]);

    const current = nav.querySelector('[aria-current="page"]');
    expect(current).not.toBeNull();
    expect(current?.textContent).toContain('PKR 1,000.00');
    expect(current?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-01');

    expect(items[1]?.textContent).toContain('PKR 1,750.50');
    expect(items[2]?.querySelector('bdi[dir="ltr"]')?.textContent).toContain('LHR-01');
    expect(items[2]?.textContent).toContain('Lahore Central');
    expect(items[2]?.textContent).toContain('PKR 1,250.50');
    expect(items[3]?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-08-31');
    expect(items[3]?.textContent).toContain(locale === 'en' ? 'Week of' : 'کا ہفتہ');
    expect(items[0]?.textContent).not.toContain('PKR');
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
  });

  it('formats count steps as integers', () => {
    renderWithIntl(
      <TraceTrail
        steps={[
          {
            kind: 'dashboard',
            href: '/dashboard',
            figure: 'reports_awaiting_review',
            measure: 'count',
            value: '1234',
          },
          {
            kind: 'figure',
            href: '/dashboard/kpi/reports-awaiting-review',
            figure: 'reports_awaiting_review',
            measure: 'count',
            value: '1234',
          },
        ]}
      />,
      { locale, namespaces: NAMESPACES },
    );
    const current = document.querySelector('[aria-current="page"]');
    expect(current?.textContent).toContain('1,234');
    expect(current?.textContent).not.toContain('PKR');
  });
});

const EXPLAIN: Explanation = {
  figure: 'approved',
  level: 'collections',
  filters: { from: '2026-08', to: '2026-09', branchId: BRANCH, reportId: REPORT },
  recordCount: 2,
  value: '1250.50',
  asOf: '2026-10-31T10:15:00.000Z',
};

describe.each(LOCALES)('LevelExplain (%s)', (locale) => {
  it('opens the drawer with the figure, value, record count, as-of and chips', () => {
    renderWithIntl(
      <LevelExplain
        explain={EXPLAIN}
        value="PKR 1,250.50"
        branchName="Lahore Central"
        reportLabel="Week of 31 Aug 2026"
      />,
      { locale, namespaces: NAMESPACES },
    );
    fireEvent.click(screen.getByRole('button', { name: locale === 'en' ? /How is this/ : /حساب/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(locale === 'en' ? 'Approved' : 'منظور شدہ');
    expect(dialog.textContent).toContain('PKR 1,250.50');
    expect(dialog.querySelector('time')?.getAttribute('dateTime')).toBe(EXPLAIN.asOf);
    const chips = dialog.querySelector('dl');
    expect(chips).not.toBeNull();
    const terms = [...(chips?.querySelectorAll('dt') ?? [])].map((dt) => dt.textContent);
    expect(terms).toEqual(
      locale === 'en' ? ['Months', 'Branch', 'Report'] : ['مہینے', 'شاخ', 'رپورٹ'],
    );
    const values = [...(chips?.querySelectorAll('dd') ?? [])].map((dd) => dd.textContent);
    expect(values[0]).toContain('2026');
    expect(values[1]).toBe('Lahore Central');
    expect(values[2]).toBe('Week of 31 Aug 2026');
  });

  it('shows "all time" for a figure with no filters and a short id without a name', () => {
    const { unmount } = renderWithIntl(
      <LevelExplain explain={{ ...EXPLAIN, filters: {} }} value="PKR 1,250.50" />,
      { locale, namespaces: NAMESPACES },
    );
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain(
      locale === 'en' ? 'No filters: all time, all branches' : 'کوئی فلٹر نہیں',
    );
    unmount();

    renderWithIntl(
      <LevelExplain explain={{ ...EXPLAIN, filters: { branch: BRANCH } }} value="x" />,
      { locale, namespaces: NAMESPACES },
    );
    fireEvent.click(screen.getByRole('button'));
    const dl = screen.getByRole('dialog').querySelector('dl');
    const dd = [...(dl?.querySelectorAll('dd') ?? [])].map((d) => d.textContent);
    expect(dd).toEqual([locale === 'en' ? 'All time' : 'تمام عرصہ', BRANCH.slice(0, 8)]);
  });

  it('passes identities through to the drawer', () => {
    renderWithIntl(
      <LevelExplain
        explain={{ ...EXPLAIN, filters: {} }}
        value="PKR 1,250.50"
        triggerVariant="icon"
        identities={[{ left: 'Approved', right: 'Routed + Not yet routed', holds: true }]}
      />,
      { locale, namespaces: NAMESPACES },
    );
    fireEvent.click(screen.getByRole('button'));
    const item = screen.getByRole('dialog').querySelector('[data-holds]');
    expect(item?.getAttribute('data-holds')).toBe('true');
    expect(item?.textContent).toContain('Routed + Not yet routed');
  });
});
