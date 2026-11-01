import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  TrendChart,
  TrendTable,
  formatMonth,
  type TrendPoint,
  type TrendSeriesDef,
} from '@/components/figures';
import type { Locale } from '@/i18n/routing';
import type { FigureId } from '@/modules/reporting/types';
import { formatInt, formatMoney } from '@/platform/i18n/format';
import { TREND_KEYS, type DashboardModel, type TrendKey } from './dashboard-view-model';

const TONE: Record<TrendKey, TrendSeriesDef['tone']> = {
  approved: 'primary',
  pending_approval: 'pending',
  in_progress: 'neutral',
};

/** Stacked monthly bars with an accessible, fully linked table behind a disclosure. */
export function TrendSection({ model }: { model: DashboardModel }) {
  const t = useTranslations('dashboard');
  const tf = useTranslations('trace.figures');
  const locale = useLocale() as Locale;
  const titleId = useId();

  const series: TrendSeriesDef[] = TREND_KEYS.map((key) => ({
    key,
    label: tf(`${key}.label`),
    tone: TONE[key],
  }));
  const points: TrendPoint[] = model.trendPoints.map((p) => ({
    month: p.month,
    values: { ...p.values },
  }));
  const first = model.months[0];
  const last = model.months[model.months.length - 1];
  const summary =
    first && last
      ? t('trend.summary', {
          n: model.months.length,
          months: formatInt(model.months.length, locale),
          first: formatMonth(first, locale),
          last: formatMonth(last, locale),
          total: formatMoney(model.collected.value, locale),
        })
      : t('chart.noData');

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-5 rounded-card border border-border bg-surface-raised p-6 shadow-card"
    >
      <h2 id={titleId} className="text-sm font-semibold text-text">
        {t('trend.title')}
      </h2>
      <TrendChart points={points} series={series} caption={t('trend.caption')} summary={summary} />
      <details className="group border-t border-border pt-4">
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-4 transition-transform group-open:rotate-90 rtl:-scale-x-100 motion-reduce:transition-none"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
          <span className="group-open:hidden">{t('chart.viewTable')}</span>
          <span className="hidden group-open:inline">{t('chart.hideTable')}</span>
        </summary>
        <div className="mt-4 min-w-0 overflow-x-auto">
          <TrendTable
            points={points}
            series={series}
            caption={t('trend.tableCaption')}
            hrefFor={(month, key) => model.trendHref(month, key as FigureId)}
            totals={{
              approved: model.approved.value,
              pending_approval: model.pending.value,
              in_progress: model.inProgress.value,
            }}
          />
        </div>
      </details>
    </section>
  );
}
