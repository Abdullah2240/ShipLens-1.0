import { useLocale, useTranslations } from 'next-intl';
import { Bdi, EmptyState, Ltr, StatusBadge } from '@/components/ui';
import { fillSlots, slot } from '@/components/ui/Bidi';
import { Link } from '@/i18n/navigation';
import type { ReportCollectionRow } from '../types';
import { Panel } from './Panel';
import { AmountHint } from './ReportsTable';
import { asLocale, collectionHref, safeDate, safeMoney } from './report-format';

export interface ReportCollectionsTableProps {
  collections: ReportCollectionRow[];
  /** The report total on display: live while open, frozen once submitted. */
  total: string;
  totalIsFrozen: boolean;
}

/** The collections inside one report; voided rows stay visible but muted, with their reason. */
export function ReportCollectionsTable({
  collections,
  total,
  totalIsFrozen,
}: ReportCollectionsTableProps) {
  const t = useTranslations('reports');
  const locale = asLocale(useLocale());
  const caption = t('detail.collections');

  if (collections.length === 0) {
    return (
      <Panel title={caption}>
        <EmptyState title={t('detail.collectionsEmpty')} body={t('detail.collectionsEmptyBody')} />
      </Panel>
    );
  }

  const cell = 'px-5 py-3 align-top';

  return (
    <Panel title={caption} flush>
      <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-sunken text-xs tracking-wide text-text-muted uppercase">
            <tr>
              <th scope="col" className="px-5 py-2.5 text-start font-semibold">
                {t('collectionsColumns.date')}
              </th>
              <th scope="col" className="px-5 py-2.5 text-start font-semibold">
                {t('collectionsColumns.purpose')}
              </th>
              <th scope="col" className="px-5 py-2.5 text-end font-semibold">
                {t('collectionsColumns.amount')}
              </th>
              <th scope="col" className="px-5 py-2.5 text-start font-semibold">
                {t('collectionsColumns.status')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {collections.map((row) => {
              const voided = row.status === 'voided';
              return (
                <tr
                  key={row.id}
                  data-collection-status={row.status}
                  className={voided ? 'bg-surface-sunken/40' : 'hover:bg-surface-sunken/60'}
                >
                  <td className={`${cell} whitespace-nowrap`}>
                    <Link
                      href={collectionHref(row.id)}
                      className={`font-medium underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                        voided ? 'text-text-muted' : 'text-text'
                      }`}
                    >
                      <Bdi className="tabular">
                        <time dateTime={row.collectedOn}>{safeDate(row.collectedOn, locale)}</time>
                      </Bdi>
                    </Link>
                  </td>
                  <td className={`${cell} min-w-48`}>
                    <span
                      dir="auto"
                      className={voided ? 'text-text-muted line-through' : 'text-text'}
                    >
                      {row.purpose}
                    </span>
                    {voided && row.voidReason ? (
                      <span dir="auto" className="mt-1 block text-xs text-tone-danger-fg">
                        {fillSlots(t('detail.voidedBecause', { reason: slot() }), [
                          <Bdi key="reason">{row.voidReason}</Bdi>,
                        ])}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${cell} text-end whitespace-nowrap`}>
                    <Ltr
                      className={`tabular ${voided ? 'text-text-muted line-through' : 'font-medium text-text'}`}
                    >
                      {safeMoney(row.amount, locale)}
                    </Ltr>
                  </td>
                  <td className={cell}>
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-border bg-surface-sunken">
            <tr>
              <th scope="row" colSpan={2} className="px-5 py-3 text-start font-semibold text-text">
                <span className="flex flex-wrap items-center gap-2">
                  {t('detail.totals')}
                  <AmountHint frozen={totalIsFrozen} />
                </span>
              </th>
              <td className="px-5 py-3 text-end whitespace-nowrap">
                <span data-testid="collections-total" className="font-semibold text-text tabular">
                  <Ltr>{safeMoney(total, locale)}</Ltr>
                </span>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </Panel>
  );
}
