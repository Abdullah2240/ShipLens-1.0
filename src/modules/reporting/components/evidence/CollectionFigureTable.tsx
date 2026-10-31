import { useLocale, useTranslations } from 'next-intl';
import { FigureLink, TraceTable } from '@/components/trace';
import { Bdi, EmptyState, MoneyText, type Column } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import type { CollectionFigureRow, TraceLevel } from '@/modules/reporting/trace-types';
import { formatDate, formatMoney } from '@/platform/i18n/format';
import { EvidenceDate } from './ReportSummaryCard';

// Figures whose collections all sit in approved reports.
const APPROVED_FIGURES = new Set(['approved', 'routed', 'not_yet_routed']);

function RoutedBadge({ routed }: { routed: boolean }) {
  const t = useTranslations('evidence.level3');
  return (
    <span
      data-routed={routed ? 'routed' : 'waiting'}
      data-tone={routed ? 'info' : 'warning'}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
        routed ? 'bg-tone-info-bg text-tone-info-fg' : 'bg-tone-warning-bg text-tone-warning-fg'
      }`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {routed ? t('routedBadge') : t('notRoutedBadge')}
    </span>
  );
}

export interface CollectionFigureTableProps {
  level: TraceLevel<CollectionFigureRow> & { report?: { status: string } };
  /** Status of the report the rows belong to; read from `level.report` when omitted. */
  reportStatus?: string;
}

/**
 * Level 3: the collections that make up one report's figure. Every amount opens its
 * evidence; the footer proves the rows add up to the figure clicked on level 2.
 */
export function CollectionFigureTable({ level, reportStatus }: CollectionFigureTableProps) {
  const t = useTranslations('evidence.level3');
  const locale = useLocale() as Locale;
  const status =
    reportStatus ??
    level.report?.status ??
    (APPROVED_FIGURES.has(level.figure) ? 'approved' : undefined);
  const approved = status === 'approved';

  const columns: Column<CollectionFigureRow>[] = [
    {
      key: 'collectedOn',
      header: t('columns.collectedOn'),
      render: (row) => <EvidenceDate value={row.collectedOn} />,
      className: 'whitespace-nowrap text-text-muted',
    },
    {
      key: 'purpose',
      header: t('columns.purpose'),
      render: (row) => <Bdi className="break-words text-text">{row.purpose}</Bdi>,
      className: 'min-w-[10rem]',
    },
    {
      key: 'amount',
      header: t('columns.amount'),
      align: 'numeric',
      render: (row) => (
        <FigureLink
          href={row.href}
          size="sm"
          label={t('amountLink', {
            amount: formatMoney(row.amount, locale),
            date: formatDate(row.collectedOn, locale),
          })}
        >
          {formatMoney(row.amount, locale)}
        </FigureLink>
      ),
      className: 'whitespace-nowrap',
    },
    {
      key: 'routed',
      header: t('columns.routed'),
      render: (row) =>
        approved ? (
          <RoutedBadge routed={row.routedAt !== null} />
        ) : (
          <span aria-hidden="true" className="text-text-muted">
            —
          </span>
        ),
    },
  ];

  return (
    <TraceTable
      columns={columns}
      rows={level.rows}
      getRowKey={(row) => row.collectionId}
      caption={t('caption')}
      captionHidden
      measure="amount"
      total={<MoneyText amount={level.total} />}
      recordCount={level.recordCount}
      matchesParent={level.matchesParent}
      parentLabel={t('parentLabel', { amount: formatMoney(level.parentValue, locale) })}
      truncated={level.truncated ?? undefined}
      totalColumnKey="amount"
      empty={<EmptyState title={t('empty.title')} body={t('empty.body')} />}
    />
  );
}
