import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { COLLECTION_STATUSES } from '@/platform/config/constants';
import { COLLECTIONS_PATH } from './CollectionsTable';

export interface CollectionFilterValues {
  branchId?: string;
  status?: string;
  weekStart?: string;
}

export interface CollectionFiltersFormProps {
  branches: Array<{ id: string; code: string; name: string }>;
  values: CollectionFilterValues;
}

const labelClass = 'text-xs font-semibold text-text-muted';
const fieldClass =
  'block h-10 w-full rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Head-office filters as a native GET form: no client script, shareable URLs. */
export function CollectionFiltersForm({ branches, values }: CollectionFiltersFormProps) {
  const t = useTranslations('collections.page');
  const status = useTranslations('common.status');
  const filtered = Boolean(values.branchId || values.status || values.weekStart);

  return (
    <form
      method="get"
      role="search"
      aria-label={t('filtersLabel')}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface-raised p-4 shadow-card sm:p-5"
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="collections-branch" className={labelClass}>
            {t('filterBranch')}
          </label>
          <select
            id="collections-branch"
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="collections-status" className={labelClass}>
            {t('filterStatus')}
          </label>
          <select
            id="collections-status"
            name="status"
            defaultValue={values.status ?? ''}
            className={fieldClass}
          >
            <option value="">{t('allStatuses')}</option>
            {COLLECTION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {status(value)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="collections-week" className={labelClass}>
            {t('filterWeek')}
          </label>
          <input
            id="collections-week"
            name="weekStart"
            type="date"
            dir="ltr"
            defaultValue={values.weekStart ?? ''}
            className={`${fieldClass} tabular`}
          />
        </div>

        <button
          type="submit"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:col-span-3 lg:col-span-1"
        >
          {t('apply')}
        </button>
      </div>

      {filtered ? (
        <div className="flex justify-end border-t border-border pt-3 text-sm">
          <Link
            href={COLLECTIONS_PATH}
            className="inline-flex items-center gap-1.5 rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('clear')}
          </Link>
        </div>
      ) : null}
    </form>
  );
}
