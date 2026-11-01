import { useLocale, useTranslations } from 'next-intl';
import { FigureLink, TraceTable } from '@/components/trace';
import { EmptyState, MoneyText, StatusBadge, type Column } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import type { BranchHeader, ReportFigureRow, TraceLevel } from '@/modules/reporting/trace-types';
import { formatDate, formatInt, formatMoney } from '@/platform/i18n/format';
import { sumMoney } from '@/platform/money';
import { TableFrame } from './BranchFigureTable';
import { footerRecordCount, frozenNoteKind } from './drill-view-model';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A PKT date with automatic direction. Urdu dates start with an Urdu month name, so an
 * LTR isolate would scramble them; `<bdi>` keeps each language's own order.
 */
export function AutoDate({ value }: { value: string }) {
  const locale: Locale = useLocale() === 'ur' ? 'ur' : 'en';
  let text = value;
  let machine = value;
  try {
    if (BUSINESS_DATE.test(value)) {
      text = formatDate(value, locale);
    } else {
      const instant = new Date(value);
      text = formatDate(instant, locale);
      machine = instant.toISOString();
    }
  } catch {
    // An unparseable value is shown as stored.
  }
  return (
    <bdi className="tabular whitespace-nowrap">
      <time dateTime={machine}>{text}</time>
    </bdi>
  );
}

function NotYet() {
  const t = useTranslations('drilldown.level2');
  return (
    <span className="text-text-muted">
      <span aria-hidden="true">–</span>
      <span className="sr-only">{t('notYet')}</span>
    </span>
  );
}

export interface ReportFigureTableProps {
  level: TraceLevel<ReportFigureRow> & { branch: BranchHeader };
}

/**
 * Level 2: the weekly reports behind one branch's value. Each amount opens the report's
 * collections. For reports awaiting review the footer counts the reports and totals their
 * amounts; for money figures it totals the amounts against the branch's level-1 value.
 */
export function ReportFigureTable({ level }: ReportFigureTableProps) {
  const t = useTranslations('drilldown.level2');
  const tt = useTranslations('trace');
  const locale = useLocale() as Locale;
  const figureLabel = tt(`figures.${level.figure}.label`);
  const isMoney = level.measure === 'amount';

  const columns: Column<ReportFigureRow>[] = [
    {
      key: 'week',
      header: t('columns.week'),
      className: 'font-medium text-text',
      render: (row) => (
        <span className="whitespace-nowrap">
          {t.rich('weekRange', {
            start: () => <AutoDate value={row.weekStart} />,
            end: () => <AutoDate value={row.weekEnd} />,
          })}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'records',
      header: t('columns.records'),
      align: 'numeric',
      className: 'text-text-muted',
      render: (row) => formatInt(row.recordCount, locale),
    },
    {
      key: 'frozen',
      header: t('columns.frozen'),
      align: 'end',
      className: 'tabular text-text-muted',
      render: (row) => {
        if (row.frozenAmount === null) return <NotYet />;
        const note = frozenNoteKind(row);
        return (
          <span className="inline-flex flex-col items-end gap-0.5">
            <MoneyText amount={row.frozenAmount} />
            {note ? (
              <span data-frozen-note={note} className="text-xs whitespace-nowrap text-text-muted">
                <bdi>{t(`frozenNote.${note}`)}</bdi>
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'submitted',
      header: t('columns.submitted'),
      className: 'text-text-muted',
      render: (row) => (row.submittedAt ? <AutoDate value={row.submittedAt} /> : <NotYet />),
    },
    {
      key: 'approved',
      header: t('columns.approved'),
      className: 'text-text-muted',
      render: (row) =>
        row.status === 'approved' && row.reviewedAt ? (
          <AutoDate value={row.reviewedAt} />
        ) : (
          <NotYet />
        ),
    },
    {
      key: 'value',
      header: t('columns.value'),
      align: 'numeric',
      render: (row) => {
        const value = formatMoney(row.value, locale);
        return (
          <FigureLink
            href={row.href}
            label={t('valueLink', { week: formatDate(row.weekStart, locale), value })}
          >
            {value}
          </FigureLink>
        );
      },
    },
  ];

  // A count figure counts reports; its total cell still carries their amounts, which
  // the service checked against the branch's awaiting amount.
  const total = isMoney ? level.total : sumMoney(level.rows.map((r) => r.value));
  const recordCount = footerRecordCount('reports', level.measure, level.rows, level.recordCount);

  return (
    <div className="flex flex-col gap-3">
      <TableFrame>
        <TraceTable
          columns={columns}
          rows={level.rows}
          getRowKey={(row) => row.reportId}
          caption={t('tableLabel', { figure: figureLabel, name: level.branch.branchName })}
          captionHidden
          empty={<EmptyState title={t('empty.title')} body={t('empty.body')} />}
          measure="amount"
          total={formatMoney(total, locale)}
          recordCount={recordCount}
          matchesParent={level.matchesParent}
          parentLabel={level.branch.branchCode}
          truncated={level.truncated ?? undefined}
          totalColumnKey="value"
        />
      </TableFrame>
      {level.rows.length > 0 ? (
        <p className="max-w-3xl px-1 text-xs leading-relaxed text-text-muted">{t('frozenHint')}</p>
      ) : null}
    </div>
  );
}
