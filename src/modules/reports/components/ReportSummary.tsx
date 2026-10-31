import { useId, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { StatusBadge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { formatInt } from '@/platform/i18n/format';
import type { ReportDetail, ReportEventItem, ReportStatus } from '../types';
import { asLocale, REPORTS_PATH, safeDateTime, safeMoney } from './report-format';
import { BranchCode, useWeekLabel } from './ReportsTable';

type StepKey = 'draft' | 'submitted' | 'returned' | 'resubmitted' | 'approved';
type StepState = 'complete' | 'current' | 'upcoming';

const STEP_LABEL: Record<StepKey, string> = {
  draft: 'stepDraft',
  submitted: 'stepSubmitted',
  returned: 'stepReturned',
  resubmitted: 'stepResubmitted',
  approved: 'stepApproved',
};

/**
 * The steps to show and the current one. Returned (and the resubmission after it) appear
 * only once a return has happened; repeated cycles collapse into one pair.
 */
export function lifecycleSteps(
  status: ReportStatus,
  events: Pick<ReportEventItem, 'type'>[],
): { key: StepKey; state: StepState }[] {
  const wasReturned = status === 'returned' || events.some((e) => e.type === 'returned');
  const keys: StepKey[] = wasReturned
    ? ['draft', 'submitted', 'returned', 'resubmitted', 'approved']
    : ['draft', 'submitted', 'approved'];
  let current: StepKey;
  if (status === 'draft') current = 'draft';
  else if (status === 'returned') current = 'returned';
  else if (status === 'approved') current = 'approved';
  else current = wasReturned ? 'resubmitted' : 'submitted';
  const at = keys.indexOf(current);
  return keys.map((key, i) => ({
    key,
    state: i < at ? 'complete' : i === at ? 'current' : 'upcoming',
  }));
}

function StepMarker({ state, warn }: { state: StepState; warn: boolean }) {
  if (state === 'complete') {
    return (
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast">
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden="true">
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (state === 'current') {
    return (
      <span
        className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full ring-4 ${
          warn ? 'bg-tone-warning-fg ring-tone-warning-bg' : 'bg-primary ring-primary/15'
        }`}
      >
        <span aria-hidden="true" className="size-2 rounded-full bg-surface-raised" />
      </span>
    );
  }
  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-border-strong/50 bg-surface-raised" />
  );
}

/** Horizontal on wide screens, vertical on phones. `aria-current="step"` marks the status. */
export function LifecycleStepper({
  status,
  events,
}: {
  status: ReportStatus;
  events: Pick<ReportEventItem, 'type'>[];
}) {
  const t = useTranslations('reports.detail');
  const steps = lifecycleSteps(status, events);
  const approved = status === 'approved';

  return (
    <ol
      aria-label={t('lifecycle')}
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0"
    >
      {steps.map((step, i) => {
        // An approved report's final step is done, not in progress.
        const state: StepState = approved && step.state === 'current' ? 'complete' : step.state;
        const warn = step.key === 'returned';
        return (
          <li
            key={step.key}
            data-step={step.key}
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className="flex items-center gap-2.5 sm:flex-1 sm:last:flex-none"
          >
            <StepMarker state={state} warn={warn && step.state === 'current'} />
            <span
              className={`text-sm whitespace-nowrap ${
                step.state === 'current'
                  ? 'font-semibold text-text'
                  : state === 'complete'
                    ? 'font-medium text-text'
                    : 'text-text-muted'
              }`}
            >
              {t(STEP_LABEL[step.key])}
              {state === 'complete' ? (
                <span className="sr-only"> ({t('stepComplete')})</span>
              ) : null}
            </span>
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`mx-3 hidden h-0.5 min-w-6 flex-1 rounded-full sm:block ${
                  state === 'complete' ? 'bg-primary/60' : 'bg-border'
                }`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Callout({
  tone,
  title,
  icon,
  children,
}: {
  tone: 'warning' | 'success';
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  const toneClass =
    tone === 'warning'
      ? 'border-tone-warning-fg/35 bg-tone-warning-bg'
      : 'border-tone-success-fg/30 bg-tone-success-bg';
  const fg = tone === 'warning' ? 'text-tone-warning-fg' : 'text-tone-success-fg';
  return (
    <section
      aria-labelledby={headingId}
      data-callout={tone}
      className={`flex gap-3 rounded-card border p-4 sm:p-5 ${toneClass}`}
    >
      <span className={`mt-0.5 shrink-0 ${fg}`} aria-hidden="true">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 id={headingId} className={`text-sm font-semibold ${fg}`}>
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

const ReturnIcon = (
  <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="M10 2.75l8 14.5H2l8-14.5z" strokeLinejoin="round" />
    <path d="M10 8v4" strokeLinecap="round" />
    <circle cx="10" cy="14.6" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

const LockIcon = (
  <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7">
    <rect x="4" y="9" width="12" height="8.5" rx="1.8" />
    <path d="M6.75 9V6.5a3.25 3.25 0 016.5 0V9" strokeLinecap="round" />
  </svg>
);

export interface ReportSummaryProps {
  report: ReportDetail;
}

/** Header (branch, week, status), lifecycle stepper, return reason and locked banner. */
export function ReportSummary({ report }: ReportSummaryProps) {
  const t = useTranslations('reports.detail');
  const locale = asLocale(useLocale());
  const weekLabel = useWeekLabel();
  const canResubmit = report.allowedActions.includes('submit');

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={REPORTS_PATH}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-text-muted transition-colors hover:text-text focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <svg
          viewBox="0 0 20 20"
          className="size-4 rtl:-scale-x-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 5l-5 5 5 5" />
        </svg>
        {t('back')}
      </Link>

      <header className="flex flex-col gap-5 rounded-card border border-border bg-surface-raised p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">
            {t('eyebrow')}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-text">{report.branchName}</h1>
            <BranchCode code={report.branchCode} />
            <span data-testid="report-status">
              <StatusBadge status={report.status} />
            </span>
          </div>
          <p className="text-sm text-text-muted">
            <time dateTime={report.weekStart}>{weekLabel(report.weekStart, report.weekEnd)}</time>
          </p>
        </div>
        <div className="border-t border-border pt-5">
          <LifecycleStepper status={report.status} events={report.events} />
        </div>
      </header>

      {report.status === 'returned' && report.returnReason ? (
        <Callout tone="warning" title={t('returnReasonTitle')} icon={ReturnIcon}>
          <blockquote
            dir="auto"
            className="border-s-2 border-tone-warning-fg/40 ps-3 text-base leading-relaxed whitespace-pre-line text-text"
          >
            {report.returnReason}
          </blockquote>
          {report.reviewedAt ? (
            <p className="text-xs text-tone-warning-fg">
              {t('returnReasonBy', {
                name: report.reviewedByName ?? '—',
                date: safeDateTime(report.reviewedAt, locale),
              })}
            </p>
          ) : null}
          {canResubmit ? (
            <p className="text-sm font-medium text-text">{t('returnReasonNext')}</p>
          ) : null}
        </Callout>
      ) : null}

      {report.status === 'approved' ? (
        <Callout tone="success" title={t('lockedTitle')} icon={LockIcon}>
          <p className="text-sm text-text">{t('lockedBody')}</p>
          {report.reviewedAt ? (
            <p className="text-xs text-tone-success-fg">
              {t('lockedBy', {
                name: report.reviewedByName ?? '—',
                date: safeDateTime(report.reviewedAt, locale),
              })}
            </p>
          ) : null}
        </Callout>
      ) : null}
    </div>
  );
}

export interface ReportTotalsProps {
  report: Pick<
    ReportDetail,
    'status' | 'liveAmount' | 'liveCount' | 'frozenAmount' | 'frozenCount' | 'amountIsFrozen'
  >;
  /** A short next-step note under the figures. */
  note?: string;
}

/** The report total in large tabular figures, labelled live or frozen at submission. */
export function ReportTotals({ report, note }: ReportTotalsProps) {
  const t = useTranslations('reports.detail');
  const locale = asLocale(useLocale());
  const headingId = useId();
  const frozen = report.status === 'submitted' || report.status === 'approved';
  const amount = frozen ? (report.frozenAmount ?? report.liveAmount) : report.liveAmount;
  const count = frozen ? (report.frozenCount ?? report.liveCount) : report.liveCount;
  const showLastSubmitted =
    report.status === 'returned' &&
    report.frozenAmount !== null &&
    report.frozenAmount !== undefined;

  return (
    <section
      aria-labelledby={headingId}
      data-totals={frozen ? 'frozen' : 'live'}
      className="flex flex-col gap-4 rounded-card border border-border bg-surface-raised p-5 shadow-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-sm font-semibold text-text-muted">
          {t('totals')}
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            frozen ? 'bg-tone-info-bg text-tone-info-fg' : 'bg-tone-neutral-bg text-tone-neutral-fg'
          }`}
        >
          {frozen ? (
            <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden="true">
              <rect x="2.5" y="5.5" width="7" height="5" rx="1" stroke="currentColor" />
              <path d="M4 5.5V4a2 2 0 014 0v1.5" stroke="currentColor" />
            </svg>
          ) : (
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-40 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-current" />
            </span>
          )}
          {frozen ? t('frozenTotal') : t('liveTotal')}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <p
          data-testid="report-total"
          className="text-3xl font-semibold tracking-tight text-text tabular"
        >
          <span dir="ltr">{safeMoney(amount, locale)}</span>
        </p>
        <p className="text-sm text-text-muted">
          {t('collectionCount', { count, total: formatInt(count, locale) })}
        </p>
      </div>
      <p className="text-xs leading-relaxed text-text-muted">
        {frozen ? t('frozenTotalHint') : t('liveTotalHint')}
      </p>
      {showLastSubmitted ? (
        <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-text-muted">
          {t('lastSubmitted', { amount: safeMoney(report.frozenAmount ?? '0', locale) })}
        </p>
      ) : null}
      {note ? (
        <p className="border-t border-border pt-3 text-sm text-text" data-testid="report-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}
