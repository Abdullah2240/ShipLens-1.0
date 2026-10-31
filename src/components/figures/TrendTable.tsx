import { useLocale, useTranslations } from 'next-intl';
import { DataTable, MoneyText, type Column } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { toMinor } from '@/platform/money';
import {
  TREND_TONE_TEXT,
  formatMonth,
  sortPoints,
  type TrendPoint,
  type TrendSeriesDef,
} from './TrendChart';

export type TrendTableProps = {
  points: TrendPoint[];
  series: TrendSeriesDef[];
  caption: string;
  /** When set, every non-zero cell links to this path (locale is added by Link). */
  hrefFor?: (month: string, seriesKey: string) => string;
  totals?: Record<string, string>;
};

/** Table alternative to TrendChart: months as rows, series as columns. */
export function TrendTable({ points, series, caption, hrefFor, totals }: TrendTableProps) {
  const t = useTranslations('dashboard.chart');
  const locale = useLocale() as Locale;

  const columns: Column<TrendPoint>[] = [
    {
      key: 'month',
      header: t('monthAxis'),
      className: 'whitespace-nowrap font-medium text-text',
      render: (point) => <time dateTime={point.month}>{formatMonth(point.month, locale)}</time>,
    },
    ...series.map((s): Column<TrendPoint> => ({
      key: s.key,
      align: 'end',
      className: 'tabular whitespace-nowrap',
      header: (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-2 rounded-[2px] bg-current ${TREND_TONE_TEXT[s.tone]}`}
          />
          {s.label}
        </span>
      ),
      render: (point) => {
        const amount = point.values[s.key] ?? '0.00';
        if (toMinor(amount) === 0n || !hrefFor) {
          return (
            <MoneyText
              amount={amount}
              className={toMinor(amount) === 0n ? 'text-text-muted' : 'text-text'}
            />
          );
        }
        return (
          <Link
            href={hrefFor(point.month, s.key)}
            className="rounded-sm font-medium text-primary decoration-primary/40 underline-offset-4 hover:underline"
          >
            <MoneyText amount={amount} />{' '}
            <span className="sr-only">
              {t('cellContext', { month: formatMonth(point.month, locale), series: s.label })}
            </span>
          </Link>
        );
      },
    })),
  ];

  const footer = totals ? (
    <tr>
      <th scope="row" className="px-4 py-3 text-start font-semibold">
        {t('total')}
      </th>
      {series.map((s) => (
        <td key={s.key} className="tabular whitespace-nowrap px-4 py-3 text-end">
          {totals[s.key] !== undefined ? <MoneyText amount={totals[s.key] ?? '0.00'} /> : null}
        </td>
      ))}
    </tr>
  ) : undefined;

  return (
    <DataTable
      columns={columns}
      rows={sortPoints(points)}
      getRowKey={(point) => point.month}
      caption={caption}
      footer={footer}
      empty={
        <p className="rounded-card border border-dashed border-border px-4 py-10 text-center text-sm text-text-muted">
          {t('noData')}
        </p>
      }
    />
  );
}
