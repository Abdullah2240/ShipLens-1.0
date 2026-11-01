import { useLocale, useTranslations } from 'next-intl';
import { dirFor, type Locale } from '@/i18n/routing';
import { formatMoney } from '@/platform/i18n/format';
import { toMinor } from '@/platform/money';
import { basisPointsMinor, compactMinor, niceCeiling, ticks } from './ratio';

export type TrendTone = 'primary' | 'pending' | 'neutral' | 'success' | 'info';

export interface TrendSeriesDef {
  key: string;
  label: string;
  tone: TrendTone;
}

export interface TrendPoint {
  /** PKT month, YYYY-MM. */
  month: string;
  /** Decimal money string per series key; a missing key counts as zero. */
  values: Record<string, string>;
}

export type TrendChartProps = {
  points: TrendPoint[];
  series: TrendSeriesDef[];
  caption: string;
  /** Text alternative read by assistive technology in place of the drawing. */
  summary: string;
  height?: number;
};

// Fills follow currentColor so both themes come from the tokens. Full class strings
// so Tailwind can see them.
export const TREND_TONE_TEXT: Record<TrendTone, string> = {
  primary: 'text-primary',
  pending: 'text-tone-pending-fg',
  neutral: 'text-border-strong',
  success: 'text-tone-success-fg',
  info: 'text-tone-info-fg',
};

const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-GB-u-nu-latn',
  ur: 'ur-PK-u-nu-latn',
};

const MONTH_RE = /^(\d{4})-(\d{2})$/;

/** 'YYYY-MM' to a short month name and a Latin-digit year. */
export function monthParts(month: string, locale: Locale): { name: string; year: string } {
  const match = MONTH_RE.exec(month);
  if (!match) return { name: month, year: '' };
  const [, year = '', mm = ''] = match;
  const name = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'UTC',
    month: 'short',
  }).format(new Date(Date.UTC(Number(year), Number(mm) - 1, 15)));
  return { name, year };
}

export function formatMonth(month: string, locale: Locale): string {
  const { name, year } = monthParts(month, locale);
  return year ? `${name} ${year}` : name;
}

export function sortPoints(points: TrendPoint[]): TrendPoint[] {
  return [...points].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

function minorOf(point: TrendPoint, key: string): bigint {
  const value = point.values[key];
  const minor = value === undefined ? 0n : toMinor(value);
  return minor > 0n ? minor : 0n;
}

// Geometry. Horizontal positions are in basis points of the width (0..10000) and become
// SVG percentages, so the chart fills any width while text keeps its real size.
// Vertical positions are pixels.
const PAD_TOP = 16;
const AXIS = 40;
const GUTTER = 1000;
const MAX_BAR = 1200;
const GAP = 2;
const FULL = 10000;

const pctAttr = (bpOfWidth: number) => `${bpOfWidth / 100}%`;
const round2 = (value: number) => Math.round(value * 100) / 100;

type Bar = { series: TrendSeriesDef; y: number; height: number; bp: number; amount: string };
type Column = { point: TrendPoint; x: number; width: number; center: number; bars: Bar[] };

export function TrendChart({ points, series, caption, summary, height = 240 }: TrendChartProps) {
  const t = useTranslations('dashboard.chart');
  const locale = useLocale() as Locale;
  const rtl = dirFor(locale) === 'rtl';

  const legend = (
    <ul aria-label={t('legend')} className="ms-auto flex flex-wrap gap-x-4 gap-y-1">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs font-normal text-text-muted">
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-[3px] bg-current ${TREND_TONE_TEXT[s.tone]}`}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );

  const header = (
    <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-2 text-sm font-semibold text-text">
      {caption}
      <span className="text-xs font-normal text-text-muted">{t('amountAxis')}</span>
      {points.length > 0 ? legend : null}
    </figcaption>
  );

  if (points.length === 0) {
    return (
      <figure className="flex min-w-0 flex-col gap-4">
        {header}
        <p className="rounded-card border border-dashed border-border px-4 py-10 text-center text-sm text-text-muted">
          {t('noData')}
        </p>
      </figure>
    );
  }

  const sorted = sortPoints(points);
  const totals = sorted.map((point) => series.reduce((sum, s) => sum + minorOf(point, s.key), 0n));
  const max = totals.reduce((a, b) => (b > a ? b : a), 0n);
  const ceiling = niceCeiling(max);
  const tickValues = ticks(max);

  const plotH = Math.max(80, height - PAD_TOP - AXIS);
  const baseline = PAD_TOP + plotH;
  const yOf = (bp: number) => round2(baseline - (bp * plotH) / FULL);

  // Mirror horizontally in RTL locales: oldest month at the inline start.
  const mirror = (x: number, width: number) => (rtl ? FULL - x - width : x);

  const band = (FULL - GUTTER) / sorted.length;
  const barWidth = Math.round(Math.min(band * 0.56, MAX_BAR));

  const columns: Column[] = sorted.map((point, i) => {
    const x = mirror(Math.round(GUTTER + i * band + (band - barWidth) / 2), barWidth);
    const bars: Bar[] = [];
    let cumulative = 0n;
    let previousBp = 0;
    for (const s of series) {
      const value = minorOf(point, s.key);
      if (value === 0n) continue;
      cumulative += value;
      const bp = basisPointsMinor(cumulative, ceiling);
      const bottom = yOf(previousBp) - (bars.length > 0 ? GAP : 0);
      const top = yOf(bp);
      const segment = Math.max(1, round2(bottom - top));
      bars.push({
        series: s,
        y: round2(bottom - segment),
        height: segment,
        bp: bp - previousBp,
        amount: point.values[s.key] ?? '0.00',
      });
      previousBp = bp;
    }
    return { point, x, width: barWidth, center: x + barWidth / 2, bars };
  });

  const gridFrom = rtl ? 0 : GUTTER;
  const gridTo = rtl ? FULL - GUTTER : FULL;

  return (
    <figure className="flex min-w-0 flex-col gap-4">
      {header}
      <svg
        role="img"
        aria-label={summary}
        width="100%"
        height={height}
        className="block overflow-visible text-text-muted"
      >
        <g data-grid>
          {tickValues.map((tick) => {
            const y = yOf(basisPointsMinor(tick, ceiling));
            return (
              <g key={tick.toString()}>
                <line
                  data-gridline
                  x1={pctAttr(gridFrom)}
                  x2={pctAttr(gridTo)}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                  className={tick === 0n ? 'text-border-strong' : 'text-border'}
                />
                <text
                  data-tick-label
                  x={rtl ? '100%' : '0%'}
                  y={y}
                  direction="ltr"
                  textAnchor={rtl ? 'end' : 'start'}
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="currentColor"
                  className="tabular text-text-muted"
                >
                  {compactMinor(tick)}
                </text>
              </g>
            );
          })}
        </g>

        <g data-bars>
          {columns.map((column) =>
            column.bars.map((bar) => (
              <rect
                key={`${column.point.month}-${bar.series.key}`}
                data-month={column.point.month}
                data-series={bar.series.key}
                data-bp={bar.bp}
                x={pctAttr(column.x)}
                width={pctAttr(column.width)}
                y={bar.y}
                height={bar.height}
                rx={2}
                ry={2}
                fill="currentColor"
                className={`${TREND_TONE_TEXT[bar.series.tone]} hover:opacity-80`}
              >
                <title>
                  {t('barTitle', {
                    month: formatMonth(column.point.month, locale),
                    series: bar.series.label,
                    amount: formatMoney(bar.amount, locale),
                  })}
                </title>
              </rect>
            )),
          )}
        </g>

        <g data-months>
          {columns.map((column, i) => {
            const { name, year } = monthParts(column.point.month, locale);
            const previousYear =
              i > 0 ? monthParts(sorted[i - 1]?.month ?? '', locale).year : undefined;
            const showYear = year !== '' && year !== previousYear;
            return (
              <g key={column.point.month}>
                <text
                  data-month-label
                  x={pctAttr(column.center)}
                  y={baseline + 18}
                  textAnchor="middle"
                  fontSize={11}
                  fill="currentColor"
                  className="text-text-muted"
                >
                  {name}
                </text>
                {showYear ? (
                  <text
                    data-year-label
                    x={pctAttr(column.center)}
                    y={baseline + 33}
                    direction="ltr"
                    textAnchor="middle"
                    fontSize={10}
                    fill="currentColor"
                    className="tabular text-text-muted opacity-75"
                  >
                    {year}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
    </figure>
  );
}
