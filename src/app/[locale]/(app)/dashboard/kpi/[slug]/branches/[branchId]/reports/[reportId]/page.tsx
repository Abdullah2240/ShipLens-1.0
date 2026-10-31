import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatMonth } from '@/components/figures';
import { TraceHeader, type ExplainFilterChip } from '@/components/trace';
import { Bdi, IdText, MoneyText } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { FIGURES, figureFromSlug, isMoneyFigure, parseReportingFilters } from '@/modules/reporting';
import { getReportCollections } from '@/modules/reporting/service-trace';
import { filterChipTexts } from '@/modules/reporting/components/dashboard/dashboard-view-model';
import { LevelExplain } from '@/modules/reporting/components/drill/LevelExplain';
import { TraceTrail } from '@/modules/reporting/components/drill/TraceTrail';
import { CollectionFigureTable } from '@/modules/reporting/components/evidence/CollectionFigureTable';
import { ReportEventsList } from '@/modules/reporting/components/evidence/ReportEventsList';
import {
  EvidenceDate,
  ReportSummaryCard,
} from '@/modules/reporting/components/evidence/ReportSummaryCard';
import type { FigureId, ReportingFilters } from '@/modules/reporting/types';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string; branchId: string; reportId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'trace.levels' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('collections')} | ${common('appName')}`, robots: { index: false } };
}

/** CSV of the collections on screen; count figures export their collection predicate. */
function collectionsExportHref(
  figure: FigureId,
  filters: ReportingFilters,
  ids: { branchId: string; reportId: string },
  locale: string,
): string | null {
  const money = isMoneyFigure(figure) ? figure : FIGURES[figure].collectionPredicate;
  if (!money) return null;
  const params = new URLSearchParams();
  params.set('figure', FIGURES[money].slug);
  params.set('reportId', ids.reportId);
  params.set('branch', ids.branchId);
  // Count figures list every collection of the report (the month filter applied on L2).
  if (money === figure) {
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
  }
  params.set('locale', locale);
  return `/api/v1/exports/collections?${params.toString()}`;
}

const ACTION_LINK =
  'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-sm font-medium text-text shadow-card transition-colors hover:border-border-strong hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function Glyph({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-4 shrink-0 text-text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

export default async function ReportLevelPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale: rawLocale, slug, branchId, reportId } = await params;
  setRequestLocale(rawLocale);
  const locale = rawLocale as Locale;
  const figure = figureFromSlug(slug);
  if (!figure) notFound();
  const { actor } = await requirePageActor();
  const filters = parseReportingFilters(await searchParams);

  const level = await orNotFound(
    getReportCollections(getPool(), actor, figure, branchId, reportId, filters),
  );
  const { branch, report } = level;

  const [t, tf, tt] = await Promise.all([
    getTranslations('evidence'),
    getTranslations('dashboard.filters'),
    getTranslations('trace'),
  ]);

  const weekLabel = t.rich('level3.title', {
    week: () => <EvidenceDate value={report.weekStart} />,
  });
  // Branch and report are in the title; only a month range needs a chip.
  const chips: ExplainFilterChip[] = filterChipTexts(
    { from: level.explain.filters.from, to: level.explain.filters.to },
    {
      t: (key, values) => tf(key, values),
      allTime: tt('filter.allTime'),
      formatMonth: (month) => formatMonth(month, locale),
    },
  )
    .filter((chip) => chip.kind === 'months')
    .map((chip) => ({ label: chip.label, value: <bdi>{chip.text}</bdi> }));
  const exportHref = collectionsExportHref(
    figure,
    filters,
    { branchId: branch.branchId, reportId: report.reportId },
    locale,
  );

  return (
    <div className="flex flex-col gap-8">
      <TraceHeader
        trail={<TraceTrail steps={level.trail} />}
        eyebrow={t('level3.eyebrow')}
        title={weekLabel}
        value={<MoneyText amount={level.parentValue} />}
        meta={
          <div className="flex max-w-2xl flex-col gap-2">
            <p className="flex flex-wrap items-center gap-x-2">
              <IdText id={branch.branchCode} mono className="font-medium text-text" />
              <span aria-hidden="true">·</span>
              <Bdi>{branch.branchName}</Bdi>
            </p>
            <p>{t('level3.lead')}</p>
          </div>
        }
        chips={chips}
        actions={
          <>
            <LevelExplain
              explain={level.explain}
              value={<MoneyText amount={level.total} />}
              branchName={branch.branchName}
              reportLabel={weekLabel}
            />
            {exportHref ? (
              <a href={exportHref} download className={ACTION_LINK} data-action="export">
                <Glyph path="M8 2.5v7.5M4.75 6.75 8 10l3.25-3.25M3 12.5h10" />
                {t('level3.export')}
              </a>
            ) : null}
            <Link
              href={`/dashboard/print/reports/${report.reportId}`}
              className={ACTION_LINK}
              data-action="print"
            >
              <Glyph path="M4.5 6V2.5h7V6M4.5 11.5h-2v-5h11v5h-2M4.5 9.5h7v4h-7z" />
              {t('level3.print')}
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <ReportSummaryCard report={report} branch={branch} />
          <ReportEventsList events={level.reportEvents} />
        </div>
        <section aria-labelledby="level3-collections" className="flex min-w-0 flex-col gap-3">
          <h2 id="level3-collections" className="text-sm font-semibold text-text">
            {t('level3.collectionsTitle')}
          </h2>
          <CollectionFigureTable level={level} />
        </section>
      </div>
    </div>
  );
}
