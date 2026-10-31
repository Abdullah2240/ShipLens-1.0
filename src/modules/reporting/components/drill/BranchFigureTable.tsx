import { useLocale, useTranslations } from 'next-intl';
import { FigureLink, TraceTable } from '@/components/trace';
import { Bdi, EmptyState, IdText, StatusBadge, type Column } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { BranchFigureRow, TraceLevel } from '@/modules/reporting/trace-types';
import { formatInt, formatMoney } from '@/platform/i18n/format';
import { footerRecordCount } from './drill-view-model';

export interface BranchFigureTableProps {
  level: TraceLevel<BranchFigureRow>;
}

/** Branch cell: the typed name, then its code in a quieter mono face. */
export function BranchCell({ code, name }: { code: string; name: string }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <Bdi className="font-medium whitespace-nowrap text-text">{name}</Bdi>
      <IdText id={code} mono className="text-xs text-text-muted" />
    </span>
  );
}

/**
 * Level 1: a figure split by branch. Money figures list reports, collections and the
 * amount (a link to the branch's reports); reports awaiting review list the count per
 * branch; active branches link to each branch's approved figure. The footer total is
 * checked against the dashboard figure.
 */
export function BranchFigureTable({ level }: BranchFigureTableProps) {
  const t = useTranslations('drilldown');
  const tt = useTranslations('trace');
  const locale = useLocale() as Locale;
  const figureLabel = tt(`figures.${level.figure}.label`);
  const isMoney = level.measure === 'amount';
  const isActive = level.figure === 'active_branches';
  const show = (value: string) => (isMoney ? formatMoney(value, locale) : formatInt(value, locale));

  const branch: Column<BranchFigureRow> = {
    key: 'branch',
    header: t('level1.columns.branch'),
    render: (row) => <BranchCell code={row.branchCode} name={row.branchName} />,
  };
  const status: Column<BranchFigureRow> = {
    key: 'status',
    header: t('level1.columns.status'),
    render: (row) => <StatusBadge status={row.branchStatus} />,
  };
  const reports: Column<BranchFigureRow> = {
    key: 'reports',
    header: isActive ? t('countFigure.approvedReports') : t('level1.columns.reports'),
    align: 'numeric',
    className: 'text-text-muted',
    render: (row) => formatInt(row.reportCount, locale),
  };
  const records: Column<BranchFigureRow> = {
    key: 'records',
    header: t('level1.columns.records'),
    align: 'numeric',
    className: 'text-text-muted',
    render: (row) => formatInt(row.recordCount, locale),
  };

  let value: Column<BranchFigureRow>;
  if (isActive) {
    value = {
      key: 'value',
      header: t('countFigure.branchesLabel'),
      align: 'end',
      render: (row) => (
        <Link
          href={row.href}
          aria-label={t('countFigure.approvedLink', { branch: row.branchName })}
          className="inline-flex items-center gap-1 rounded-md text-sm font-semibold text-primary decoration-primary/40 underline-offset-[0.2em] hover:underline"
        >
          {t('countFigure.viewApproved')}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3.5 shrink-0 rtl:-scale-x-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </Link>
      ),
    };
  } else {
    value = {
      key: 'value',
      header: isMoney ? t('level1.columns.value') : t('countFigure.reportsLabel'),
      align: 'numeric',
      render: (row) => (
        <FigureLink
          href={row.href}
          label={
            isMoney
              ? t('level1.valueLink', { branch: row.branchName, value: show(row.value) })
              : t('countFigure.countLink', { branch: row.branchName, count: show(row.value) })
          }
        >
          {show(row.value)}
        </FigureLink>
      ),
    };
  }

  const columns = isMoney
    ? [branch, status, reports, records, value]
    : isActive
      ? [branch, status, reports, value]
      : [branch, status, value];

  return (
    <TraceTable
      columns={columns}
      rows={level.rows}
      getRowKey={(row) => row.branchId}
      caption={t('level1.title', { figure: figureLabel })}
      captionHidden
      empty={<EmptyState title={t('level1.empty.title')} body={t('level1.empty.body')} />}
      measure={level.measure}
      total={show(level.total)}
      recordCount={footerRecordCount('branches', level.measure, level.rows, level.recordCount)}
      matchesParent={level.matchesParent}
      parentLabel={tt(`figures.${level.figure}.short`)}
      truncated={level.truncated ?? undefined}
      totalColumnKey="value"
    />
  );
}

/** CSV links with the level's scope; plain downloads, never prefixed with a locale. */
export function DrillExportLinks({
  reports,
  collections,
}: {
  reports?: string;
  collections: string;
}) {
  const t = useTranslations('drilldown.actions');
  const links = [
    ...(reports ? [{ href: reports, label: t('exportReports'), kind: 'reports' }] : []),
    { href: collections, label: t('exportCollections'), kind: 'collections' },
  ];

  return (
    <ul aria-label={t('exportLabel')} className="flex flex-wrap items-center gap-2">
      {links.map((link) => (
        <li key={link.kind}>
          <a
            href={link.href}
            download
            data-export={link.kind}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 text-sm font-medium text-text shadow-[0_1px_0_var(--color-border)] transition-colors hover:border-border-strong/60 hover:bg-surface-sunken/60"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="size-4 text-text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13.25h10" />
            </svg>
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}
