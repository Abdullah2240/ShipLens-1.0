import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { REPORT_STATUSES } from '@/platform/config/constants';
import { formatInt } from '@/platform/i18n/format';
import { asLocale, REPORTS_PATH, type ReportFilterValues } from './report-format';

export type BranchOption = { id: string; name: string; code: string };

export interface ReportFiltersProps {
  values: ReportFilterValues;
  /** Head office only; the branch filter is left out without it. */
  branches?: BranchOption[];
  total: number;
  /** Rows on screen, when fewer than `total`. */
  shown?: number;
}

const labelClass = 'text-xs font-semibold text-text-muted';
const fieldClass =
  'block h-10 w-full rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Status, branch and week filters as a native GET form, so every view is a shareable URL. */
export function ReportFilters({ values, branches, total, shown }: ReportFiltersProps) {
  const t = useTranslations('reports.list');
  const status = useTranslations('common.status');
  const locale = asLocale(useLocale());
  const id = useId();
  const filtered = Boolean(values.status || values.branchId || values.weekStart);
  const withBranch = branches !== undefined;

  return (
    <form
      method="get"
      role="search"
      aria-label={t('filterLabel')}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface-raised p-4 shadow-card sm:p-5"
    >
      <div
        className={`grid gap-3 sm:grid-cols-2 lg:items-start ${
          withBranch
            ? 'lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]'
            : 'lg:grid-cols-[repeat(2,minmax(0,1fr))_auto]'
        }`}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-status`} className={labelClass}>
            {t('filterStatus')}
          </label>
          <select
            id={`${id}-status`}
            name="status"
            defaultValue={values.status ?? ''}
            className={fieldClass}
          >
            <option value="">{t('allStatuses')}</option>
            {REPORT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {status(value)}
              </option>
            ))}
          </select>
        </div>

        {withBranch ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-branch`} className={labelClass}>
              {t('filterBranch')}
            </label>
            <select
              id={`${id}-branch`}
              name="branchId"
              defaultValue={values.branchId ?? ''}
              className={fieldClass}
            >
              <option value="">{t('allBranches')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {`${branch.name} (${branch.code})`}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-week`} className={labelClass}>
            {t('filterWeek')}
          </label>
          <input
            id={`${id}-week`}
            type="date"
            name="weekStart"
            dir="ltr"
            defaultValue={values.weekStart ?? ''}
            aria-describedby={`${id}-week-hint`}
            className={`${fieldClass} text-start tabular`}
          />
          <p id={`${id}-week-hint`} className="text-xs text-text-muted">
            {t('weekHint')}
          </p>
        </div>

        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:col-span-2 lg:col-span-1 lg:mt-[1.375rem]"
        >
          {t('apply')}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm">
        <p role="status" className="font-medium text-text-muted tabular">
          {shown !== undefined && shown < total
            ? t('shown', { shown: formatInt(shown, locale), total: formatInt(total, locale) })
            : t('count', { count: total, total: formatInt(total, locale) })}
        </p>
        {filtered ? (
          <Link
            href={REPORTS_PATH}
            className="inline-flex items-center gap-1.5 rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <svg
              viewBox="0 0 20 20"
              className="size-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
            </svg>
            {t('clear')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
