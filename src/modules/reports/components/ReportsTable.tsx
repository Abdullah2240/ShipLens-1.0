import { useLocale, useTranslations } from 'next-intl';
import { Bdi, DataTable, EmptyState, Ltr, StatusBadge, type Column } from '@/components/ui';
import { fillSlots, slot } from '@/components/ui/Bidi';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { daysBetween, pktDate } from '@/platform/time';
import { formatId, formatInt } from '@/platform/i18n/format';
import type { ReportListItem } from '../types';
import { asLocale, reportHref, safeDate, safeDateTime, safeMoney } from './report-format';

/** Branch code isolated in LTR direction, Latin digits. */
export function BranchCode({ code }: { code: string }) {
  return (
    <Ltr className="inline-block rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-xs font-medium text-text-muted tabular">
      {formatId(code)}
    </Ltr>
  );
}

/** "26 Oct 2026 – 1 Nov 2026", PKT business dates. */
export function useWeekLabel() {
  const t = useTranslations('reports.detail');
  const locale = asLocale(useLocale());
  return (start: string, end: string) =>
    t('week', { start: safeDate(start, locale), end: safeDate(end, locale) });
}

function WhoWhen({ name, at, locale }: { name: string | null; at: string | null; locale: Locale }) {
  if (!at) return <span className="text-text-muted">—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {name ? <Bdi className="text-text">{name}</Bdi> : null}
      <Bdi className="text-xs whitespace-nowrap text-text-muted tabular">
        <time dateTime={at}>{safeDateTime(at, locale)}</time>
      </Bdi>
    </span>
  );
}

export function AmountHint({ frozen }: { frozen: boolean }) {
  const t = useTranslations('reports.amount');
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
        frozen ? 'text-tone-info-fg' : 'text-text-muted'
      }`}
    >
      {frozen ? (
        <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
          <rect x="2.5" y="5.5" width="7" height="5" rx="1" stroke="currentColor" />
          <path d="M4 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" />
        </svg>
      ) : (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      )}
      {frozen ? t('frozen') : t('live')}
    </span>
  );
}

export interface ReportsTableProps {
  reports: ReportListItem[];
  /** Adds the branch column (head office). */
  showBranch?: boolean;
  /** PKT Monday of the current week; that row gets a "This week" marker. */
  currentWeek?: string;
}

export function ReportsTable({ reports, showBranch = false, currentWeek }: ReportsTableProps) {
  const t = useTranslations('reports');
  const locale = asLocale(useLocale());
  const weekLabel = useWeekLabel();

  const columns: Column<ReportListItem>[] = [
    {
      key: 'week',
      header: t('columns.week'),
      className: 'min-w-48',
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          <Link
            href={reportHref(row.id)}
            className="font-semibold whitespace-nowrap text-text underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Bdi>{weekLabel(row.weekStart, row.weekEnd)}</Bdi>
          </Link>
          {currentWeek && row.weekStart === currentWeek ? (
            <span className="rounded-full bg-accent-soft px-2 py-px text-[11px] font-semibold text-accent">
              {t('list.thisWeek')}
            </span>
          ) : null}
        </span>
      ),
    },
  ];

  if (showBranch) {
    columns.push({
      key: 'branch',
      header: t('columns.branch'),
      className: 'min-w-44',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-2">
          <Bdi className="text-text">{row.branchName}</Bdi>
          <BranchCode code={row.branchCode} />
        </span>
      ),
    });
  }

  columns.push(
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'amount',
      header: t('columns.amount'),
      align: 'end',
      render: (row) => (
        <span className="flex flex-col items-end gap-0.5">
          <Ltr className="font-semibold whitespace-nowrap text-text tabular">
            {safeMoney(row.amount, locale)}
          </Ltr>
          <AmountHint frozen={row.amountIsFrozen} />
        </span>
      ),
    },
    {
      key: 'collections',
      header: t('columns.collections'),
      align: 'numeric',
      render: (row) => formatInt(row.count, locale),
    },
    {
      key: 'submitted',
      header: t('columns.submitted'),
      render: (row) => <WhoWhen name={row.submittedByName} at={row.submittedAt} locale={locale} />,
    },
    {
      key: 'reviewed',
      header: t('columns.reviewed'),
      render: (row) =>
        row.status === 'approved' || row.status === 'returned' ? (
          <WhoWhen name={row.reviewedByName} at={row.reviewedAt} locale={locale} />
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
  );

  return (
    <DataTable
      columns={columns}
      rows={reports}
      getRowKey={(row) => row.id}
      caption={t('list.caption')}
      captionHidden
      empty={<EmptyState title={t('list.empty')} body={t('list.emptyBody')} />}
    />
  );
}

export interface ReviewQueueListProps {
  reports: ReportListItem[];
  /** PKT business date of today, for the waiting time. */
  today: string;
}

/** Finance review queue: one card per submitted report, oldest submission first. */
export function ReviewQueueList({ reports, today }: ReviewQueueListProps) {
  const t = useTranslations('reports');
  const locale = asLocale(useLocale());
  const weekLabel = useWeekLabel();

  if (reports.length === 0) {
    return <EmptyState title={t('review.empty')} body={t('review.emptyBody')} />;
  }

  return (
    <ol aria-label={t('review.caption')} className="flex flex-col gap-3">
      {reports.map((report, index) => {
        const submittedOn = report.submittedAt ? pktDate(new Date(report.submittedAt)) : today;
        const days = Math.max(0, daysBetween(submittedOn, today));
        const overdue = days >= 3;
        return (
          <li
            key={report.id}
            data-report-id={report.id}
            className="group relative grid gap-4 rounded-card border border-border bg-surface-raised p-4 shadow-card transition-colors focus-within:border-primary hover:border-border-strong sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-5"
          >
            <span
              aria-hidden="true"
              className="hidden size-9 items-center justify-center rounded-full bg-surface-sunken text-sm font-semibold text-text-muted tabular sm:inline-flex"
            >
              {formatInt(index + 1, locale)}
            </span>

            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-text">
                  <Link
                    href={reportHref(report.id)}
                    className="rounded-sm after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
                  >
                    <Bdi>{report.branchName}</Bdi>
                  </Link>
                </h2>
                <BranchCode code={report.branchCode} />
              </div>
              <p className="text-sm text-text-muted">
                <Bdi>{weekLabel(report.weekStart, report.weekEnd)}</Bdi>
              </p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                {report.submittedByName ? (
                  <span>
                    {fillSlots(t('review.submittedBy', { name: slot() }), [
                      <Bdi key="name">{report.submittedByName}</Bdi>,
                    ])}
                  </span>
                ) : null}
                {report.submittedAt ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <time dateTime={report.submittedAt} className="tabular">
                      {fillSlots(t('review.waitingSince', { date: slot() }), [
                        <Bdi key="date">{safeDateTime(report.submittedAt, locale)}</Bdi>,
                      ])}
                    </time>
                  </>
                ) : null}
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1.5">
              <span className="flex flex-col items-start gap-0.5 sm:items-end">
                <Ltr className="text-lg font-semibold text-text tabular">
                  {safeMoney(report.amount, locale)}
                </Ltr>
                <span className="text-xs text-text-muted">
                  {t('detail.collectionCount', {
                    count: report.count,
                    total: formatInt(report.count, locale),
                  })}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    overdue
                      ? 'bg-tone-warning-bg text-tone-warning-fg'
                      : 'bg-tone-info-bg text-tone-info-fg'
                  }`}
                >
                  <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" />
                    <path d="M6 3.5V6l1.5 1" stroke="currentColor" strokeLinecap="round" />
                  </svg>
                  {t('review.waitingDays', { count: days, days: formatInt(days, locale) })}
                </span>
                <span
                  aria-hidden="true"
                  className="hidden items-center gap-1 text-sm font-semibold text-primary group-hover:underline sm:inline-flex"
                >
                  {t('review.open')}
                  <svg
                    viewBox="0 0 16 16"
                    className="size-3.5 rtl:-scale-x-100"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 3.5L10.5 8 6 12.5" />
                  </svg>
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
