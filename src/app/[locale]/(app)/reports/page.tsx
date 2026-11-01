import { randomUUID } from 'node:crypto';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { listBranches } from '@/modules/branches';
import {
  ensureCurrentWeekDrafts,
  listReports,
  listReviewQueue,
  parseReportQuery,
} from '@/modules/reports';
import { reportCapabilities } from '@/modules/reports/capabilities';
import { ReportFilters } from '@/modules/reports/components/ReportFilters';
import { ReportsTable } from '@/modules/reports/components/ReportsTable';
import {
  REPORT_PAGE_STEP,
  REVIEW_QUEUE_PATH,
  reportsHref,
} from '@/modules/reports/components/report-format';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';
import { formatInt } from '@/platform/i18n/format';
import { pktDate, pktWeekStart, systemClock } from '@/platform/time';

// Reads the session and the reports on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'reports' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('list.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { actor } = await requireActor();
  const caps = reportCapabilities(actor.role);
  const pool = getPool();

  // The current week's draft is always there before the list is read.
  await orNotFound(
    ensureCurrentWeekDrafts({ actor, requestId: randomUUID(), clock: systemClock, pool }),
  );

  const query = parseReportQuery(sp);
  const [t, result, branches, queue] = await Promise.all([
    getTranslations('reports'),
    orNotFound(listReports(pool, actor, query)),
    caps.canSeeAll ? orNotFound(listBranches(pool, actor)) : Promise.resolve(undefined),
    caps.canReview ? orNotFound(listReviewQueue(pool, actor)) : Promise.resolve(undefined),
  ]);
  const currentWeek = pktWeekStart(pktDate(systemClock.now()));
  const shown = result.items.length;
  const formatLocale = locale === 'ur' ? 'ur' : 'en';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-text">{t('list.title')}</h1>
          <p className="text-sm leading-relaxed text-text-muted">
            {caps.canSeeAll ? t('list.headOfficeSubtitle') : t('list.subtitle')}
          </p>
        </div>
        {queue ? (
          <Link
            href={REVIEW_QUEUE_PATH}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('list.reviewQueueLink')}
            <span className="rounded-full bg-primary-contrast/20 px-2 py-px text-xs tabular">
              {t('list.reviewQueueWaiting', { total: formatInt(queue.length, formatLocale) })}
            </span>
          </Link>
        ) : null}
      </header>

      {caps.canSeeAll ? (
        <ReportFilters
          values={query}
          branches={(branches ?? []).map(({ id, name, code }) => ({ id, name, code }))}
          total={result.total}
          shown={shown}
        />
      ) : null}

      <ReportsTable reports={result.items} showBranch={caps.canSeeAll} currentWeek={currentWeek} />

      {shown < result.total ? (
        <div className="flex justify-center">
          <Link
            href={reportsHref(query, query.limit + REPORT_PAGE_STEP)}
            scroll={false}
            className="inline-flex h-10 items-center rounded-lg border border-border-strong/60 bg-surface-raised px-4 text-sm font-semibold text-text shadow-xs transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('list.showMore')}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
