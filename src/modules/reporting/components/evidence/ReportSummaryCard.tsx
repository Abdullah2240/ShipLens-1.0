import { useId, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bdi, IdText, MoneyText, StatusBadge } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import type { BranchHeader, ReportHeader } from '@/modules/reporting/trace-types';
import { formatDate, formatDateTime, formatInt } from '@/platform/i18n/format';

const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A business date or an instant, isolated with automatic direction: Urdu output starts with
 * an Urdu month name or a day number next to one, and an LTR isolate would scramble it.
 */
export function EvidenceDate({ value, withTime }: { value: string; withTime?: boolean }) {
  const locale: Locale = useLocale() === 'ur' ? 'ur' : 'en';
  let text = value;
  let machine = value;
  try {
    if (!withTime && BUSINESS_DATE.test(value)) {
      text = formatDate(value, locale);
    } else {
      const instant = new Date(value);
      text = withTime ? formatDateTime(instant, locale) : formatDate(instant, locale);
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

function MatchIcon({ holds }: { holds: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {holds ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="M8 4v5M8 11.75v.01" />}
    </svg>
  );
}

function TotalTile({
  kind,
  label,
  hint,
  className = '',
  children,
}: {
  kind: 'frozen' | 'live';
  className?: string;
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div data-total={kind} className={`flex min-w-0 flex-col gap-1 px-5 py-4 ${className}`}>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <div className="text-xl leading-tight font-semibold tracking-tight text-text tabular-nums rtl:tracking-normal">
        {children}
      </div>
      <p className="text-xs text-text-muted">{hint}</p>
    </div>
  );
}

function Person({ name, at }: { name: string | null; at: string | null }) {
  const t = useTranslations('evidence.report');
  if (!name && !at) return <span className="text-text-muted">{t('nobody')}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {name ? <Bdi className="font-medium text-text">{name}</Bdi> : null}
      {at ? (
        <span className="text-xs text-text-muted">
          <EvidenceDate value={at} withTime />
        </span>
      ) : null}
    </span>
  );
}

export interface ReportSummaryCardProps {
  report: ReportHeader;
  branch: BranchHeader;
}

/**
 * The report a figure came from: its status and week, the total frozen at submission next
 * to the live sum of its collections (with a match check), and who submitted and decided it.
 */
export function ReportSummaryCard({ report, branch }: ReportSummaryCardProps) {
  const t = useTranslations('evidence.report');
  const locale = useLocale() as Locale;
  const headingId = useId();
  const reviewedLabel =
    report.status === 'approved'
      ? t('approvedBy')
      : report.status === 'returned'
        ? t('returnedBy')
        : null;
  const holds = report.frozenMatchesLive;

  return (
    <section
      aria-labelledby={headingId}
      data-status={report.status}
      className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-raised shadow-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={headingId} className="text-sm font-semibold text-text">
            {t('title')}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
            <IdText id={branch.branchCode} mono className="font-medium text-text" />
            <span aria-hidden="true">·</span>
            <Bdi>{branch.branchName}</Bdi>
          </p>
        </div>
        <StatusBadge status={report.status} />
      </header>

      <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-4 gap-y-3 px-5 py-4 text-sm">
        <dt className="text-text-muted">{t('week')}</dt>
        <dd className="text-text">
          {t.rich('weekRange', {
            start: () => <EvidenceDate value={report.weekStart} />,
            end: () => <EvidenceDate value={report.weekEnd} />,
          })}
        </dd>
        <dt className="text-text-muted">{t('submittedBy')}</dt>
        <dd>
          <Person name={report.submittedByName} at={report.submittedAt} />
        </dd>
        {reviewedLabel ? (
          <>
            <dt className="text-text-muted">{reviewedLabel}</dt>
            <dd>
              <Person name={report.reviewedByName} at={report.reviewedAt} />
            </dd>
          </>
        ) : null}
      </dl>

      <div className="mx-5 mb-5 overflow-hidden rounded-xl border border-border bg-surface-sunken/50">
        <div className="grid grid-cols-1 sm:grid-cols-2">
          <TotalTile kind="frozen" label={t('frozenTotal')} hint={t('frozenHint')}>
            {report.frozenAmount !== null ? (
              <MoneyText amount={report.frozenAmount} />
            ) : (
              <span className="text-base font-medium text-text-muted">{t('notSubmitted')}</span>
            )}
          </TotalTile>
          <TotalTile
            kind="live"
            label={t('liveTotal')}
            hint={t('liveHint')}
            className="border-t border-border sm:border-t-0 sm:border-s"
          >
            <MoneyText amount={report.liveAmount} />
          </TotalTile>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-5 py-3">
          <span className="text-xs text-text-muted tabular">
            {t('collections', {
              count: report.liveCount,
              total: formatInt(report.liveCount, locale),
            })}
          </span>
          {holds === null ? null : (
            <span
              data-totals={holds ? 'match' : 'differ'}
              data-tone={holds ? 'success' : 'danger'}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-current/15 ring-inset ${
                holds
                  ? 'bg-tone-success-bg text-tone-success-fg'
                  : 'bg-tone-danger-bg text-tone-danger-fg'
              }`}
            >
              <MatchIcon holds={holds} />
              {holds ? t('totalsMatch') : t('totalsDiffer')}
            </span>
          )}
        </div>
      </div>

      {report.returnReason ? (
        <div
          data-return-reason
          className="mx-5 mb-5 rounded-xl border border-tone-warning-fg/25 bg-tone-warning-bg px-4 py-3"
        >
          <p className="text-xs font-semibold text-tone-warning-fg">{t('returnReason')}</p>
          <p className="mt-1 text-sm text-text">
            <Bdi className="break-words">{report.returnReason}</Bdi>
          </p>
        </div>
      ) : null}
    </section>
  );
}
