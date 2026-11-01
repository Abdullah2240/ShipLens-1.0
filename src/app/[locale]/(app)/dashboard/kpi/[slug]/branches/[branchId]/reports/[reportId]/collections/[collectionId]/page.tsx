import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatMonth } from '@/components/figures';
import { TraceHeader, type ExplainFilterChip } from '@/components/trace';
import { Bdi, IdText, MoneyText } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { figureFromSlug, parseReportingFilters, getCollectionEvidence } from '@/modules/reporting';
import { filterChipTexts } from '@/modules/reporting/components/dashboard/dashboard-view-model';
import { LevelExplain } from '@/modules/reporting/components/drill/LevelExplain';
import { TraceTrail } from '@/modules/reporting/components/drill/TraceTrail';
import { CollectionEvidenceCard } from '@/modules/reporting/components/evidence/CollectionEvidenceCard';
import { EvidenceDate } from '@/modules/reporting/components/evidence/ReportSummaryCard';
import type { TimelineEntry } from '@/modules/timeline';
import { AuditTimeline } from '@/modules/timeline/components/AuditTimeline';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{
  locale: string;
  slug: string;
  branchId: string;
  reportId: string;
  collectionId: string;
}>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'evidence.level4' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('title')} | ${common('appName')}`, robots: { index: false } };
}

function TimelineCard({
  name,
  title,
  hint,
  auditHref,
  auditLabel,
  entries,
}: {
  name: 'collection' | 'report';
  title: string;
  hint: string;
  auditHref: string;
  auditLabel: ReactNode;
  entries: TimelineEntry[];
}) {
  const headingId = `evidence-${name}-audit`;
  return (
    <section
      aria-labelledby={headingId}
      data-timeline={name}
      className="flex min-w-0 flex-col rounded-card border border-border bg-surface-raised shadow-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={headingId} className="text-sm font-semibold text-text">
            {title}
          </h2>
          <p className="text-xs text-text-muted">{hint}</p>
        </div>
        <Link
          href={auditHref}
          data-audit-link={name}
          className="inline-flex items-center gap-1 text-xs font-medium text-text-muted underline-offset-[0.2em] hover:text-primary hover:underline"
        >
          {auditLabel}
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="size-3 shrink-0 rtl:-scale-x-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </Link>
      </header>
      {/* The card heading names the trail; the timeline's own heading stays for screen readers. */}
      <div className="px-5 py-5 [&>section>h3]:sr-only">
        <AuditTimeline entries={entries} headingLevel={3} />
      </div>
    </section>
  );
}

export default async function CollectionLevelPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale: rawLocale, slug, branchId, reportId, collectionId } = await params;
  setRequestLocale(rawLocale);
  const locale = rawLocale as Locale;
  const figure = figureFromSlug(slug);
  if (!figure) notFound();
  const { actor } = await requireActor();
  const filters = parseReportingFilters(await searchParams);

  const evidence = await orNotFound(
    getCollectionEvidence(getPool(), actor, figure, branchId, reportId, collectionId, filters),
  );
  const { branch, report, collection } = evidence;

  const [t, tf, tt] = await Promise.all([
    getTranslations('evidence'),
    getTranslations('dashboard.filters'),
    getTranslations('trace'),
  ]);

  const weekLabel = t.rich('level3.title', {
    week: () => <EvidenceDate value={report.weekStart} />,
  });
  const chips: ExplainFilterChip[] = filterChipTexts(
    { from: evidence.explain.filters.from, to: evidence.explain.filters.to },
    {
      t: (key, values) => tf(key, values),
      allTime: tt('filter.allTime'),
      formatMonth: (month) => formatMonth(month, locale),
    },
  )
    .filter((chip) => chip.kind === 'months')
    .map((chip) => ({ label: chip.label, value: <bdi>{chip.text}</bdi> }));

  return (
    <div className="flex flex-col gap-8">
      <TraceHeader
        trail={<TraceTrail steps={evidence.trail} />}
        eyebrow={t('level4.eyebrow')}
        title={<Bdi>{collection.purpose}</Bdi>}
        value={<MoneyText amount={collection.amount} />}
        meta={
          <div className="flex max-w-2xl flex-col gap-2">
            <p className="flex flex-wrap items-center gap-x-2">
              <IdText id={branch.branchCode} mono className="font-medium text-text" />
              <span aria-hidden="true">·</span>
              <Bdi>{branch.branchName}</Bdi>
              <span aria-hidden="true">·</span>
              <span>{weekLabel}</span>
            </p>
            <p>{t('level4.lead')}</p>
          </div>
        }
        chips={chips}
        actions={
          <LevelExplain
            explain={evidence.explain}
            value={<MoneyText amount={collection.amount} />}
            branchName={branch.branchName}
            reportLabel={weekLabel}
          />
        }
      />

      <CollectionEvidenceCard evidence={evidence} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <TimelineCard
          name="collection"
          title={t('level4.collectionAudit')}
          hint={t('level4.collectionAuditHint')}
          auditHref={`/audit?entity=collection&entityId=${collection.collectionId}`}
          auditLabel={t('level4.openInAuditLog')}
          entries={evidence.collectionTimeline}
        />
        <TimelineCard
          name="report"
          title={t('level4.reportAudit')}
          hint={t('level4.reportAuditHint')}
          auditHref={`/audit?entity=report&entityId=${report.reportId}`}
          auditLabel={t('level4.openInAuditLog')}
          entries={evidence.reportTimeline}
        />
      </div>
    </div>
  );
}
