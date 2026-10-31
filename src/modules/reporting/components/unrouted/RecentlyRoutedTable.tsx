import { useLocale, useTranslations } from 'next-intl';
import { Bdi, DateText } from '@/components/ui/Bidi';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Locale } from '@/i18n/routing';
import { traceHref } from '@/modules/reporting/figures';
import type { RoutedRow } from '@/modules/reporting/types';
import { RoutingAction } from './RoutingAction';
import { CLIP_ABSOLUTE, actionHeader, routingSummary, sharedColumns } from './UnroutedTable';

export interface RecentlyRoutedTableProps {
  rows: RoutedRow[];
  canRoute: boolean;
}

/** Collections most recently marked as sent to the main account, each with an Undo. */
export function RecentlyRoutedTable({ rows, canRoute }: RecentlyRoutedTableProps) {
  const t = useTranslations('unrouted');
  const locale = useLocale() as Locale;

  const columns: Column<RoutedRow>[] = [
    ...sharedColumns<RoutedRow>(t, locale, (row) =>
      traceHref(
        'routed',
        { branchId: row.branchId, reportId: row.reportId, collectionId: row.collectionId },
        {},
      ),
    ),
    {
      key: 'routedOn',
      header: t('columns.routedOn'),
      render: (row) => <DateText value={row.routedAt} withTime />,
    },
    {
      key: 'routedBy',
      header: t('columns.routedBy'),
      render: (row) =>
        row.routedByName ? (
          <Bdi>{row.routedByName}</Bdi>
        ) : (
          <span className="text-text-muted">{t('routedByUnknown')}</span>
        ),
    },
  ];
  if (canRoute) {
    columns.push({
      key: 'action',
      header: actionHeader(t),
      align: 'end',
      render: (row) => (
        <RoutingAction
          collectionId={row.collectionId}
          mode="undo"
          summary={routingSummary(t, locale, row)}
        />
      ),
    });
  }

  return (
    <div className={CLIP_ABSOLUTE}>
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(row) => row.collectionId}
        caption={t('tables.recent')}
        captionHidden
        empty={<EmptyState title={t('empty.recentTitle')} body={t('empty.recentBody')} />}
      />
    </div>
  );
}
