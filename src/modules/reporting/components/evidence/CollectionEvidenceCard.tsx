import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Bdi, IdText, MoneyText, StatusBadge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { CollectionEvidence } from '@/modules/reporting/trace-types';
import { EvidenceDate } from './ReportSummaryCard';

function Fact({
  name,
  label,
  children,
  wide,
  routed,
}: {
  name: string;
  label: string;
  children: ReactNode;
  wide?: boolean;
  routed?: 'routed' | 'waiting' | 'none';
}) {
  return (
    <div
      data-fact={name}
      data-routed={routed}
      className={`flex min-w-0 flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}
    >
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}

function AtTime({ value }: { value: string }) {
  const t = useTranslations('evidence.level4.facts');
  return (
    <span className="text-xs text-text-muted">
      {t.rich('atTime', { time: () => <EvidenceDate value={value} withTime /> })}
    </span>
  );
}

function RoutedIcon({ routed }: { routed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0 rtl:-scale-x-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {routed ? <path d="M2.5 8h9M8.5 4.5 12 8l-3.5 3.5" /> : <path d="M8 4.5V8l2.5 1.5" />}
      {routed ? null : <circle cx="8" cy="8" r="5.5" />}
    </svg>
  );
}

export interface CollectionEvidenceCardProps {
  evidence: CollectionEvidence;
}

/**
 * Level 4 facts: the collection as recorded, with its amount as the headline figure, its
 * status and lock, where the money is, who logged it and the weekly report it sits in.
 */
export function CollectionEvidenceCard({ evidence }: CollectionEvidenceCardProps) {
  const t = useTranslations('evidence');
  const headingId = useId();
  const { collection, report } = evidence;
  const voided = collection.status === 'voided';
  const routed = collection.routedAt !== null;
  const reportHref = evidence.trail.find((step) => step.kind === 'report')?.href;
  const routing: 'routed' | 'waiting' | 'none' = routed
    ? 'routed'
    : report.status === 'approved' && !voided
      ? 'waiting'
      : 'none';

  const week = t.rich('report.weekRange', {
    start: () => <EvidenceDate value={report.weekStart} />,
    end: () => <EvidenceDate value={report.weekEnd} />,
  });

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-4 border-b border-border bg-surface-sunken/45 px-6 py-6 sm:px-8 lg:border-b-0 lg:border-e">
          <h2 id={headingId} className="text-sm font-semibold text-text-muted">
            {t('level4.factsTitle')}
          </h2>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-text-muted">{t('level4.facts.amount')}</p>
            <p
              data-fact="amount"
              className="text-[2rem] leading-none font-semibold tracking-tight text-text tabular-nums sm:text-[2.5rem] rtl:tracking-normal"
            >
              <MoneyText amount={collection.amount} />
            </p>
          </div>
          <p className="text-xs text-text-muted">
            <IdText id={collection.collectionId} mono />
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 px-6 py-6 sm:grid-cols-2 sm:px-8">
          <Fact name="collectedOn" label={t('level4.facts.collectedOn')}>
            <EvidenceDate value={collection.collectedOn} />
          </Fact>
          <Fact name="status" label={t('level4.facts.status')}>
            <StatusBadge status={collection.status} />
          </Fact>
          <Fact name="purpose" label={t('level4.facts.purpose')} wide>
            <Bdi className="break-words">{collection.purpose}</Bdi>
          </Fact>
          {voided && collection.voidReason ? (
            <Fact name="voidReason" label={t('level4.facts.voidReason')} wide>
              <span className="block rounded-lg border border-tone-danger-fg/25 bg-tone-danger-bg px-3 py-2">
                <Bdi className="break-words">{collection.voidReason}</Bdi>
              </span>
            </Fact>
          ) : null}
          <Fact name="routed" label={t('level4.facts.mainAccount')} routed={routing}>
            {routing === 'none' ? (
              <span className="text-text-muted">{t('level4.facts.notApplicable')}</span>
            ) : (
              <span className="flex flex-col gap-1">
                <span
                  data-tone={routed ? 'info' : 'warning'}
                  className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    routed
                      ? 'bg-tone-info-bg text-tone-info-fg'
                      : 'bg-tone-warning-bg text-tone-warning-fg'
                  }`}
                >
                  <RoutedIcon routed={routed} />
                  {routed ? t('level4.facts.routed') : t('level4.facts.notRouted')}
                </span>
                {routed ? (
                  <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-text-muted">
                    <span>{t('level4.facts.routedBy')}</span>
                    {collection.routedByName ? (
                      <Bdi className="font-medium text-text">{collection.routedByName}</Bdi>
                    ) : null}
                    {collection.routedAt ? <AtTime value={collection.routedAt} /> : null}
                  </span>
                ) : null}
              </span>
            )}
          </Fact>
          <Fact name="createdBy" label={t('level4.facts.createdBy')}>
            <span className="flex flex-col gap-0.5">
              {collection.createdByName ? (
                <Bdi className="font-medium">{collection.createdByName}</Bdi>
              ) : null}
              <AtTime value={collection.createdAt} />
            </span>
          </Fact>
          <Fact name="report" label={t('level4.facts.report')} wide>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {reportHref ? (
                <Link
                  href={reportHref}
                  className="font-medium text-primary underline-offset-[0.2em] hover:text-primary-hover hover:underline"
                >
                  {week}
                </Link>
              ) : (
                <span className="font-medium">{week}</span>
              )}
              <StatusBadge status={report.status} />
            </span>
          </Fact>
        </dl>
      </div>
    </section>
  );
}
