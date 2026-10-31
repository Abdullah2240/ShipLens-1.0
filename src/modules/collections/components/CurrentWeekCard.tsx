import { useLocale, useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatDate, formatInt, formatMoney } from '@/platform/i18n/format';
import { addDays } from '@/platform/time';
import { ACCEPTING_BRANCH_STATUSES, type CurrentWeek } from '../types';

export const reportHref = (reportId: string) => `/reports/${reportId}`;

export interface CurrentWeekCardProps {
  week: CurrentWeek;
}

/** The Branch Lead's current PKT week: range, report status, running total and the lock rule. */
export function CurrentWeekCard({ week }: CurrentWeekCardProps) {
  const t = useTranslations('collections.week');
  const locale = useLocale() as Locale;
  const accepting = (ACCEPTING_BRANCH_STATUSES as readonly string[]).includes(week.branchStatus);
  const days = Array.from({ length: 7 }, (_, index) => addDays(week.weekStart, index));

  return (
    <section
      aria-labelledby="current-week-title"
      className="relative flex flex-col overflow-hidden rounded-card border border-border bg-surface-raised shadow-card"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r from-primary via-primary/70 to-accent/70 rtl:bg-linear-to-l"
      />
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="current-week-title" className="text-sm font-semibold text-text">
              {t('title')}
            </h2>
            <p className="text-sm text-text-muted tabular">
              <time dateTime={week.weekStart}>
                {t('range', {
                  start: formatDate(week.weekStart, locale),
                  end: formatDate(week.weekEnd, locale),
                })}
              </time>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-xs font-medium text-text-muted">{t('reportStatus')}</span>
            {week.reportId && week.reportStatus ? (
              <span className="flex flex-wrap items-center justify-end gap-2">
                <StatusBadge status={week.reportStatus} />
                <Link
                  href={reportHref(week.reportId)}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {t('openReport')}
                  <svg
                    viewBox="0 0 20 20"
                    className="size-4 rtl:-scale-x-100"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M8 5l5 5-5 5" />
                  </svg>
                </Link>
              </span>
            ) : (
              <span className="max-w-48 text-end text-xs text-text-muted">{t('noReport')}</span>
            )}
          </div>
        </header>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('total')}
          </span>
          <span
            dir="ltr"
            data-testid="week-total"
            className="self-start text-3xl font-semibold tracking-tight text-text tabular sm:text-4xl"
          >
            {formatMoney(week.activeTotal, locale)}
          </span>
          <span className="text-sm text-text-muted">
            {t('count', { count: week.activeCount, total: formatInt(week.activeCount, locale) })}
          </span>
        </div>

        <ol aria-hidden="true" className="grid grid-cols-7 gap-1.5">
          {days.map((day) => (
            <li
              key={day}
              className={`h-1.5 rounded-full ${
                day === week.today
                  ? 'bg-primary ring-2 ring-primary/30 ring-offset-1 ring-offset-surface-raised'
                  : day < week.today
                    ? 'bg-primary/45'
                    : 'bg-surface-sunken'
              }`}
            />
          ))}
        </ol>

        {accepting ? (
          <p className="flex items-start gap-2.5 text-sm leading-relaxed text-text-muted">
            <svg
              viewBox="0 0 20 20"
              className="mt-0.5 size-4 shrink-0 text-primary"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="6.5" />
              <path d="M10 6.5V10l2.25 1.5" />
            </svg>
            <span>{t('lockExplainer')}</span>
          </p>
        ) : (
          <p
            role="status"
            className="flex items-start gap-2.5 rounded-lg border border-tone-warning-fg/25 bg-tone-warning-bg px-4 py-3 text-sm text-tone-warning-fg"
          >
            <svg
              viewBox="0 0 20 20"
              className="mt-0.5 size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="6.5" />
              <path d="M10 6.5v4.5M10 13.5v.01" />
            </svg>
            <span>{t('notAccepting')}</span>
          </p>
        )}
      </div>
    </section>
  );
}
