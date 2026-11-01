// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { MoneyText } from '@/components/ui';
import {
  IdentityBar,
  KpiCard,
  TrendChart,
  TrendTable,
  basisPoints,
  niceCeiling,
  ticks,
  type IdentitySegment,
  type TrendPoint,
  type TrendSeriesDef,
} from '.';

// next-intl's createNavigation cannot be imported under Vitest (see LanguageSwitcher.test).
vi.mock('@/i18n/navigation', () => ({
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

const LOCALES = ['en', 'ur'] as const;
type Locale = (typeof LOCALES)[number];
const NAMESPACES = ['common', 'dashboard'];

function msg(locale: Locale, key: string): string {
  const file = path.resolve(import.meta.dirname, `../../../messages/${locale}/dashboard.json`);
  const tree = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const value = key.split('.').reduce<unknown>((node, part) => {
    return (node as Record<string, unknown>)[part];
  }, tree);
  if (typeof value !== 'string') throw new Error(`missing message ${key}`);
  return value;
}

const render = (ui: React.ReactElement, locale: Locale = 'en') =>
  renderWithIntl(ui, { locale, namespaces: NAMESPACES });

const HEX_IN_CLASS = /class="[^"]*#[0-9a-f]{3,8}/i;

const SERIES: TrendSeriesDef[] = [
  { key: 'approved', label: 'Approved', tone: 'primary' },
  { key: 'pending', label: 'Pending approval', tone: 'pending' },
  { key: 'progress', label: 'In progress', tone: 'neutral' },
];

const POINTS: TrendPoint[] = [
  { month: '2026-08', values: { approved: '1000.00', pending: '500.00', progress: '0.00' } },
  { month: '2026-09', values: { approved: '1234.50', pending: '0.00', progress: '250.25' } },
  { month: '2026-10', values: { approved: '600.00', pending: '300.00', progress: '100.00' } },
];

const SEGMENTS: IdentitySegment[] = [
  { key: 'approved', label: 'Approved', amount: '1750.50', href: '/kpi/approved', tone: 'success' },
  { key: 'pending', label: 'Pending', amount: '300.00', href: '/kpi/pending', tone: 'pending' },
  { key: 'progress', label: 'In progress', amount: '50.25', tone: 'neutral' },
];

describe.each(LOCALES)('KpiCard (%s)', (locale) => {
  it('renders the value as a link with the given accessible label', () => {
    render(
      <KpiCard
        label="Collected"
        value={<MoneyText amount="5439002.59" />}
        href="/kpi/collected"
        linkLabel="Collected: open breakdown"
      />,
      locale,
    );
    const link = screen.getByRole('link', { name: 'Collected: open breakdown' });
    expect(link).toHaveAttribute('href', '/kpi/collected');
    expect(link).toHaveTextContent('PKR 5,439,002.59');
  });

  it('names the link by its value and the breakdown hint when no label is given', () => {
    render(<KpiCard label="Approved" value="207" href="/kpi/approved" />, locale);
    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName(`207 ${msg(locale, 'card.viewBreakdown')}`);
  });

  it('renders plain text without href', () => {
    render(<KpiCard label="Active branches" value="5" />, locale);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('uses the large tabular size for the hero emphasis', () => {
    const { container } = render(
      <KpiCard label="Collected" value="1" emphasis="hero" tone="primary" />,
      locale,
    );
    const value = container.querySelector('[data-kpi-value]');
    expect(value?.className).toContain('text-4xl');
    expect(value?.className).toContain('tabular');
    expect(container.querySelector('[data-emphasis="hero"]')).not.toBeNull();
    expect(container.querySelector('[data-tone="primary"]')).not.toBeNull();
  });

  it('renders explain in the header at the inline end, and the hint', () => {
    const { container } = render(
      <KpiCard
        label="Approved"
        value="1"
        explain={<button type="button">How is this calculated?</button>}
        hint="Across 6 branches"
      />,
      locale,
    );
    const header = container.querySelector('header');
    const explain = within(header as HTMLElement).getByRole('button');
    expect(explain.parentElement?.className).toContain('ms-auto');
    expect(screen.getByText('Across 6 branches')).toBeInTheDocument();
  });
});

describe.each(LOCALES)('IdentityBar (%s)', (locale) => {
  it('sizes segments from basis points and lists every segment in the legend', () => {
    const { container } = render(
      <IdentityBar total="2100.75" segments={SEGMENTS} caption="Collected by status" />,
      locale,
    );
    const bars = [...container.querySelectorAll<HTMLElement>('[data-bar-segment]')];
    expect(bars.map((b) => b.style.inlineSize)).toEqual(['83.32%', '14.28%', '2.39%']);
    expect(bars.map((b) => b.dataset.bp)).toEqual(['8332', '1428', '239']);
    expect(bars[0]?.className).toContain('bg-tone-success-fg');

    expect(screen.getByText('Collected by status').tagName).toBe('FIGCAPTION');
    const items = container.querySelectorAll('li[data-legend-segment]');
    expect(items).toHaveLength(3);

    const approved = screen.getByRole('link', { name: /Approved/ });
    expect(approved).toHaveAttribute('href', '/kpi/approved');
    expect(approved).toHaveTextContent('PKR 1,750.50');
    expect(screen.getByRole('link', { name: /Pending/ })).toHaveAttribute('href', '/kpi/pending');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    // The segment without href is plain text, still with its amount and share.
    const progress = items[2] as HTMLElement;
    expect(within(progress).queryByRole('link')).toBeNull();
    expect(progress).toHaveTextContent('In progress');
    expect(progress).toHaveTextContent('PKR 50.25');
    expect(progress).toHaveTextContent('2.39%');
  });

  it('renders an empty track for a zero total and still lists zeros', () => {
    const zeros = SEGMENTS.map((s) => ({ ...s, amount: '0.00' }));
    const { container } = render(
      <IdentityBar total="0.00" segments={zeros} caption="Collected by status" />,
      locale,
    );
    expect(container.querySelectorAll('[data-bar-segment]')).toHaveLength(0);
    expect(container.querySelector('[data-track]')).not.toBeNull();
    const items = container.querySelectorAll('li[data-legend-segment]');
    expect(items).toHaveLength(3);
    for (const item of items) expect(item).toHaveTextContent('PKR 0.00');
  });

  it('hides the colour track from assistive technology; the legend carries the text', () => {
    const { container } = render(
      <IdentityBar total="2100.75" segments={SEGMENTS} caption="c" />,
      locale,
    );
    expect(container.querySelector('[data-track]')).toHaveAttribute('aria-hidden', 'true');
    for (const s of SEGMENTS) {
      expect(screen.getByText(s.label as string)).toBeInTheDocument();
    }
  });
});

function rectsOf(container: HTMLElement, month: string) {
  return [...container.querySelectorAll<SVGRectElement>(`rect[data-month="${month}"]`)];
}

const pct = (value: string | null) => Number((value ?? '').replace('%', ''));

describe.each(LOCALES)('TrendChart (%s)', (locale) => {
  const summary = 'Approved rose from PKR 1,000 in August to PKR 1,234.50 in September.';

  it('renders an accessible figure with caption, gridlines and Latin labels', () => {
    const { container } = render(
      <TrendChart points={POINTS} series={SERIES} caption="Monthly totals" summary={summary} />,
      locale,
    );
    const figure = container.querySelector('figure');
    expect(figure).not.toBeNull();
    expect(within(figure as HTMLElement).getByText('Monthly totals').tagName).toBe('FIGCAPTION');

    const svg = screen.getByRole('img', { name: summary });
    expect(svg.tagName.toLowerCase()).toBe('svg');

    // Highest month total is 1234.50 + 250.25 = 1484.75 -> ceiling PKR 2,000 in quarters.
    const expected = ticks(148475n);
    expect(expected).toEqual([0n, 50000n, 100000n, 150000n, 200000n]);
    const grid = container.querySelectorAll('[data-gridline]');
    expect(grid).toHaveLength(expected.length);
    const labels = [...container.querySelectorAll('[data-tick-label]')].map((t) => t.textContent);
    expect(labels).toEqual(['0', '500', '1k', '1.5k', '2k']);
    for (const label of labels) expect(label).toMatch(/^[0-9.,kM]+$/);

    const months = [...container.querySelectorAll('[data-month-label]')].map(
      (t) => t.textContent ?? '',
    );
    expect(months).toHaveLength(3);
    const years = [...container.querySelectorAll('[data-year-label]')].map((t) => t.textContent);
    expect(years).toEqual(['2026']);
    for (const m of months) expect(m).not.toMatch(/[۰-۹٠-٩]/);
  });

  it('stacks bars proportionally to the nice ceiling, from decimal strings', () => {
    const { container } = render(
      <TrendChart points={POINTS} series={SERIES} caption="c" summary={summary} />,
      locale,
    );
    const ceiling = niceCeiling(148475n);
    const august = rectsOf(container, '2026-08');
    // Zero values draw nothing; August has approved and pending.
    expect(august.map((r) => r.dataset.series)).toEqual(['approved', 'pending']);
    expect(august[0]?.dataset.bp).toBe(String(basisPoints('1000.00', `${ceiling / 100n}.00`)));
    expect(august[0]?.dataset.bp).toBe('5000');
    expect(august[1]?.dataset.bp).toBe('2500');

    // Bottom segment: 5000 bp of a 184px plot (240 - 16 top - 40 axis) = 92px tall.
    expect(Number(august[0]?.getAttribute('height'))).toBe(92);
    // Upper segment keeps a 2px gap above the one below.
    expect(Number(august[1]?.getAttribute('height'))).toBe(44);
    expect(august[0]?.getAttribute('rx')).toBe('2');
    expect(august[0]?.getAttribute('fill')).toBe('currentColor');
    expect(august[0]?.getAttribute('class')).toContain('text-primary');
    expect(august[1]?.getAttribute('class')).toContain('text-tone-pending-fg');

    const title = august[0]?.querySelector('title')?.textContent ?? '';
    expect(title).toContain('PKR 1,000.00');
    expect(title).toContain('Approved');
  });

  it('places the oldest month at the inline start', () => {
    const { container } = render(
      <TrendChart points={POINTS} series={SERIES} caption="c" summary={summary} />,
      locale,
    );
    const first = pct(rectsOf(container, '2026-08')[0]?.getAttribute('x') ?? null);
    const last = pct(rectsOf(container, '2026-10')[0]?.getAttribute('x') ?? null);
    if (locale === 'ur') expect(first).toBeGreaterThan(last);
    else expect(first).toBeLessThan(last);

    // Text is positioned, never mirrored with a transform.
    expect(container.querySelector('svg [transform*="scale(-1"]')).toBeNull();
    const ticksAnchor = container.querySelector('[data-tick-label]')?.getAttribute('text-anchor');
    expect(ticksAnchor).toBe(locale === 'ur' ? 'end' : 'start');
  });

  it('mirrors x coordinates exactly between locales', () => {
    const en = render(<TrendChart points={POINTS} series={SERIES} caption="c" summary="s" />, 'en');
    const enRects = [...en.container.querySelectorAll('rect[data-month]')].map((r) => ({
      x: pct(r.getAttribute('x')),
      w: pct(r.getAttribute('width')),
    }));
    en.unmount();
    const ur = render(<TrendChart points={POINTS} series={SERIES} caption="c" summary="s" />, 'ur');
    const urRects = [...ur.container.querySelectorAll('rect[data-month]')].map((r) => ({
      x: pct(r.getAttribute('x')),
      w: pct(r.getAttribute('width')),
    }));
    expect(urRects).toHaveLength(enRects.length);
    enRects.forEach((r, i) => {
      expect(urRects[i]?.w).toBeCloseTo(r.w, 2);
      expect(urRects[i]?.x).toBeCloseTo(100 - r.x - r.w, 2);
    });
  });

  it('renders the legend with every series label', () => {
    render(<TrendChart points={POINTS} series={SERIES} caption="c" summary="s" />, locale);
    const legend = screen.getByRole('list', { name: msg(locale, 'chart.legend') });
    for (const s of SERIES) expect(within(legend).getByText(s.label)).toBeInTheDocument();
  });

  it('shows the no-data message instead of an empty svg', () => {
    const { container } = render(
      <TrendChart points={[]} series={SERIES} caption="Monthly totals" summary="s" />,
      locale,
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.getByText(msg(locale, 'chart.noData'))).toBeInTheDocument();
    expect(screen.getByText('Monthly totals')).toBeInTheDocument();
  });
});

describe.each(LOCALES)('TrendTable (%s)', (locale) => {
  it('renders months as rows and series as columns with money cells', () => {
    render(<TrendTable points={POINTS} series={SERIES} caption="Monthly totals" />, locale);
    const table = screen.getByRole('table');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([msg(locale, 'chart.monthAxis'), ...SERIES.map((s) => s.label)]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('PKR 1,234.50');
    expect(rows[1]).toHaveTextContent('PKR 250.25');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('links every non-zero cell and leaves zeros as text', () => {
    const hrefFor = (month: string, key: string) => `/kpi/${key}?from=${month}&to=${month}`;
    render(
      <TrendTable points={POINTS} series={SERIES} caption="Monthly totals" hrefFor={hrefFor} />,
      locale,
    );
    const links = screen.getAllByRole('link');
    // 9 cells, 2 zeros
    expect(links).toHaveLength(7);
    expect(
      links.some((l) => l.getAttribute('href') === '/kpi/approved?from=2026-09&to=2026-09'),
    ).toBe(true);
    const zero = screen.getAllByText('PKR 0.00');
    expect(zero).toHaveLength(2);
    for (const z of zero) expect(z.closest('a')).toBeNull();
  });

  it('shows the totals row in the footer', () => {
    const { container } = render(
      <TrendTable
        points={POINTS}
        series={SERIES}
        caption="Monthly totals"
        totals={{ approved: '2834.50', pending: '800.00', progress: '350.25' }}
      />,
      locale,
    );
    const foot = container.querySelector('tfoot') as HTMLElement;
    expect(foot).not.toBeNull();
    expect(foot).toHaveTextContent(msg(locale, 'chart.total'));
    expect(foot).toHaveTextContent('PKR 2,834.50');
    expect(foot).toHaveTextContent('PKR 350.25');
  });

  it('shows the no-data message for no points', () => {
    render(<TrendTable points={[]} series={SERIES} caption="Monthly totals" />, locale);
    expect(screen.getByText(msg(locale, 'chart.noData'))).toBeInTheDocument();
  });
});

describe.each(LOCALES)('figure kit markup (%s)', (locale) => {
  it('uses logical classes and theme tokens only', () => {
    const { container } = render(
      <>
        <KpiCard label="Collected" value="1" href="/x" emphasis="hero" explain={<span>?</span>} />
        <IdentityBar total="2100.75" segments={SEGMENTS} caption="c" />
        <TrendChart points={POINTS} series={SERIES} caption="c" summary="s" />
        <TrendTable
          points={POINTS}
          series={SERIES}
          caption="t"
          hrefFor={() => '/x'}
          totals={{ approved: '1.00' }}
        />
      </>,
      locale,
    );
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expect(findPhysicalDirection(container.innerHTML)).toEqual([]);
    expect(container.innerHTML).not.toMatch(HEX_IN_CLASS);
  });
});
