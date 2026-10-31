import { useLocale, useTranslations } from 'next-intl';
import { FigureLink } from '@/components/trace/FigureLink';
import { TraceTable } from '@/components/trace/TraceTable';
import { Bdi, DateText, IdText, MoneyText } from '@/components/ui/Bidi';
import type { Column } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Locale } from '@/i18n/routing';
import { traceHref } from '@/modules/reporting/figures';
import type { UnroutedRow } from '@/modules/reporting/types';
import { compareMoney } from '@/platform/money';
import { formatDate, formatInt, formatMoney } from '@/platform/i18n/format';
import { RoutingAction } from './RoutingAction';

type RowBase = Pick<
  UnroutedRow,
  'branchCode' | 'branchName' | 'weekStart' | 'collectedOn' | 'purpose' | 'amount'
>;
type Translate = (key: string, values?: Record<string, string | number>) => string;

/** "BR002, 12 Oct 2026, PKR 12,500.00": names the collection in actions and messages. */
export function routingSummary(t: Translate, locale: Locale, row: RowBase): string {
  return t('summary', {
    code: row.branchCode,
    date: formatDate(row.collectedOn, locale),
    amount: formatMoney(row.amount, locale),
  });
}

/** The columns both routing tables share, in order: branch, week, collected on, purpose, amount. */
export function sharedColumns<T extends RowBase>(
  t: Translate,
  locale: Locale,
  evidenceHref: (row: T) => string,
): Column<T>[] {
  return [
    {
      key: 'branch',
      header: t('columns.branch'),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <IdText id={row.branchCode} mono className="font-semibold text-text" />
          <Bdi className="text-xs text-text-muted">{row.branchName}</Bdi>
        </span>
      ),
    },
    {
      key: 'week',
      header: t('columns.week'),
      render: (row) => <DateText value={row.weekStart} className="text-text-muted" />,
    },
    {
      key: 'collectedOn',
      header: t('columns.collectedOn'),
      render: (row) => <DateText value={row.collectedOn} />,
    },
    {
      key: 'purpose',
      header: t('columns.purpose'),
      render: (row) => <Bdi className="line-clamp-2 max-w-[16rem]">{row.purpose}</Bdi>,
    },
    {
      key: 'amount',
      header: t('columns.amount'),
      align: 'numeric',
      className: 'whitespace-nowrap',
      render: (row) => (
        <FigureLink
          href={evidenceHref(row)}
          size="sm"
          label={t('amountLink', {
            amount: formatMoney(row.amount, locale),
            code: row.branchCode,
            date: formatDate(row.collectedOn, locale),
          })}
        >
          <MoneyText amount={row.amount} />
        </FigureLink>
      ),
    },
  ];
}

export function actionHeader(t: Translate) {
  return <span className="sr-only">{t('columns.action')}</span>;
}

export interface UnroutedTableProps {
  rows: UnroutedRow[];
  /** Sum of every unrouted collection behind the list (all pages). */
  totalAmount: string;
  recordCount: number;
  /** The Not yet routed figure for the same filters, or null when it is not known. */
  parent: { value: string; recordCount: number } | null;
  canRoute: boolean;
}

/** Approved collections not yet sent to the main account, oldest approval first. */
export function UnroutedTable({
  rows,
  totalAmount,
  recordCount,
  parent,
  canRoute,
}: UnroutedTableProps) {
  const t = useTranslations('unrouted');
  const trace = useTranslations('trace');
  const locale = useLocale() as Locale;

  const columns: Column<UnroutedRow>[] = [
    ...sharedColumns<UnroutedRow>(t, locale, (row) =>
      traceHref(
        'not_yet_routed',
        { branchId: row.branchId, reportId: row.reportId, collectionId: row.collectionId },
        {},
      ),
    ),
    {
      key: 'approvedOn',
      header: t('columns.approvedOn'),
      render: (row) => <DateText value={row.approvedAt} />,
    },
    {
      key: 'waiting',
      header: t('columns.waiting'),
      align: 'end',
      className: 'whitespace-nowrap text-text-muted tabular',
      render: (row) =>
        t('waitingDays', { count: row.daysWaiting, days: formatInt(row.daysWaiting, locale) }),
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
          mode="mark"
          summary={routingSummary(t, locale, row)}
        />
      ),
    });
  }

  const matchesParent = parent
    ? compareMoney(totalAmount, parent.value) === 0 && recordCount === parent.recordCount
    : null;

  return (
    <TraceTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.collectionId}
      caption={t('tables.open')}
      captionHidden
      measure="amount"
      totalColumnKey="amount"
      total={formatMoney(totalAmount, locale)}
      recordCount={recordCount}
      matchesParent={matchesParent}
      parentLabel={trace('figures.not_yet_routed.label')}
      empty={<EmptyState title={t('empty.openTitle')} body={t('empty.openBody')} />}
    />
  );
}
