import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, StatusBadge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatDate, formatMoney } from '@/platform/i18n/format';
import { isEditable } from '../capabilities';
import type { CollectionItem } from '../types';
import { reportHref } from './CurrentWeekCard';
import { LockBadge } from './LockBadge';
import { VoidCollectionDialog } from './VoidCollectionDialog';

export const COLLECTIONS_PATH = '/collections';
export const collectionHref = (id: string) => `${COLLECTIONS_PATH}/${id}`;
export const collectionEditHref = (id: string) => `${collectionHref(id)}#amend`;

export interface CollectionsTableProps {
  items: CollectionItem[];
  showBranch?: boolean;
  canAmend?: boolean;
  canVoid?: boolean;
}

const linkClass =
  'rounded-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const actionClass =
  'inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-xs font-semibold text-text shadow-xs transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function BranchCode({ code }: { code: string }) {
  return (
    <bdi
      dir="ltr"
      className="inline-block rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-xs font-medium text-text-muted tabular"
    >
      {code}
    </bdi>
  );
}

/**
 * Collections as a table on wide screens and as stacked cards on phones (one markup, so the
 * table semantics stay). Edit and Void show only when the server says the row is editable
 * and the role may write.
 */
export function CollectionsTable({
  items,
  showBranch = false,
  canAmend = false,
  canVoid = false,
}: CollectionsTableProps) {
  const t = useTranslations('collections');
  const locale = useLocale() as Locale;

  if (items.length === 0) {
    return <EmptyState title={t('page.empty')} body={t('page.emptyHint')} />;
  }

  const cell = 'max-sm:block sm:px-4 sm:py-3 sm:align-middle';

  return (
    <div
      role="region"
      aria-label={t('page.caption')}
      tabIndex={0}
      className="overflow-x-auto rounded-card border border-border bg-surface-raised shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <table className="w-full border-collapse text-sm max-sm:block">
        <caption className="sr-only">{t('page.caption')}</caption>
        <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-text-muted max-sm:sr-only">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-start font-semibold">
              {t('columns.date')}
            </th>
            {showBranch ? (
              <th scope="col" className="px-4 py-2.5 text-start font-semibold">
                {t('columns.branch')}
              </th>
            ) : null}
            <th scope="col" className="px-4 py-2.5 text-start font-semibold">
              {t('columns.purpose')}
            </th>
            <th scope="col" className="px-4 py-2.5 text-end font-semibold">
              {t('columns.amount')}
            </th>
            <th scope="col" className="px-4 py-2.5 text-start font-semibold">
              {t('columns.report')}
            </th>
            <th scope="col" className="px-4 py-2.5 text-start font-semibold">
              {t('columns.state')}
            </th>
            <th scope="col" className="px-4 py-2.5 text-end font-semibold">
              {t('columns.actions')}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border max-sm:block">
          {items.map((row) => {
            const voided = row.status === 'voided';
            const editable = isEditable(row.editability);
            return (
              <tr
                key={row.id}
                data-collection-id={row.id}
                data-voided={voided || undefined}
                className={`max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-3 max-sm:gap-y-2 max-sm:p-4 ${
                  voided ? 'bg-surface-sunken/50 text-text-muted' : 'hover:bg-surface-sunken/60'
                }`}
              >
                <td className={`${cell} whitespace-nowrap text-text-muted tabular`}>
                  <time dateTime={row.collectedOn}>{formatDate(row.collectedOn, locale)}</time>
                </td>
                {showBranch ? (
                  <td className={`${cell} max-sm:col-span-2 max-sm:row-start-2`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <BranchCode code={row.branchCode} />
                      <span className={voided ? '' : 'text-text'}>{row.branchName}</span>
                    </span>
                  </td>
                ) : null}
                <td className={`${cell} min-w-40 max-sm:col-span-2`}>
                  <span className="flex flex-col gap-0.5">
                    <Link
                      href={collectionHref(row.id)}
                      className={`font-semibold underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        voided ? 'text-text-muted' : 'text-text'
                      }`}
                    >
                      <bdi>{row.purpose}</bdi>
                    </Link>
                    {showBranch && row.createdByName ? (
                      <span className="text-xs text-text-muted">
                        <span className="sr-only">{t('columns.loggedBy')}: </span>
                        {row.createdByName}
                      </span>
                    ) : null}
                    {voided && row.voidReason ? (
                      <span className="text-xs text-tone-danger-fg" data-testid="void-reason">
                        {t('void.reasonLabel', { reason: row.voidReason })}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td
                  className={`${cell} whitespace-nowrap text-end tabular max-sm:col-start-2 max-sm:row-start-1`}
                >
                  <span
                    dir="ltr"
                    className={voided ? 'text-text-muted line-through' : 'font-semibold text-text'}
                  >
                    {formatMoney(row.amount, locale)}
                  </span>
                </td>
                <td className={cell}>
                  <Link
                    href={reportHref(row.reportId)}
                    className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <StatusBadge status={row.reportStatus} />
                  </Link>
                </td>
                <td className={`${cell} max-sm:justify-self-end`}>
                  <LockBadge
                    editability={row.editability}
                    daysLeft={row.lock.daysLeft}
                    lastEditableOn={row.lock.lastEditableOn}
                  />
                </td>
                <td className={`${cell} max-sm:col-span-2 sm:text-end`}>
                  <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Link href={collectionHref(row.id)} className={`${linkClass} px-1 text-xs`}>
                      {t('actions.view')}
                    </Link>
                    {editable && canAmend ? (
                      <Link href={collectionEditHref(row.id)} className={actionClass}>
                        {t('actions.edit')}
                      </Link>
                    ) : null}
                    {editable && canVoid ? (
                      <VoidCollectionDialog collectionId={row.id} amount={row.amount} compact />
                    ) : null}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
