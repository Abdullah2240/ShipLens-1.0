import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatMonth } from '@/components/figures';
import { MonthRangeFilter, TraceHeader } from '@/components/trace';
import { MoneyText } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getBranch } from '@/modules/branches';
import {
  figureFromSlug,
  getMonthlyTrend,
  parseReportingFilters,
  getFigureByBranch,
} from '@/modules/reporting';
import {
  BranchFigureTable,
  DrillExportLinks,
} from '@/modules/reporting/components/drill/BranchFigureTable';
import { LevelExplain } from '@/modules/reporting/components/drill/LevelExplain';
import { TraceTrail } from '@/modules/reporting/components/drill/TraceTrail';
import {
  chipsFor,
  exportLinks,
  footerRecordCount,
} from '@/modules/reporting/components/drill/drill-view-model';
import { getPool } from '@/platform/db';
import { formatDateTime, formatInt, formatMoney } from '@/platform/i18n/format';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const [t, tt, common] = await Promise.all([
    getTranslations({ locale, namespace: 'drilldown' }),
    getTranslations({ locale, namespace: 'trace' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  const figure = figureFromSlug(slug);
  const title = figure
    ? t('level1.title', { figure: tt(`figures.${figure}.label`) })
    : tt('breadcrumb.dashboard');
  return { title: `${title} | ${common('appName')}`, robots: { index: false } };
}

/** Level 1: one dashboard figure split by branch. */
export default async function FigureByBranchPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale: rawLocale, slug } = await params;
  setRequestLocale(rawLocale);
  const locale = rawLocale as Locale;
  const { actor } = await requirePageActor();
  const figure = figureFromSlug(slug);
  if (!figure) notFound();

  const filters = parseReportingFilters(await searchParams);
  const pool = getPool();
  const [level, trend] = await orNotFound(
    Promise.all([
      getFigureByBranch(pool, actor, figure, filters),
      // The month picker offers every month with data, not only the filtered range.
      getMonthlyTrend(pool, actor, { branch: filters.branch }),
    ]),
  );

  const branchName = filters.branch
    ? (level.rows.find((r) => r.branchId === filters.branch)?.branchName ??
      (await getBranch(pool, actor, filters.branch).then(
        (branch) => branch.name,
        () => undefined,
      )))
    : undefined;

  const [t, tt, td] = await Promise.all([
    getTranslations('drilldown'),
    getTranslations('trace'),
    getTranslations('dashboard'),
  ]);
  const figureLabel = tt(`figures.${figure}.label`);
  const isMoney = level.measure === 'amount';
  const show = (value: string) => (isMoney ? formatMoney(value, locale) : formatInt(value, locale));
  const records = footerRecordCount('branches', level.measure, level.rows, level.recordCount);
  const lead =
    figure === 'reports_awaiting_review'
      ? t('countFigure.awaitingLead')
      : figure === 'active_branches'
        ? t('countFigure.activeLead')
        : t('level1.lead');

  const chips = chipsFor(
    filters,
    {
      from: t('chips.from'),
      to: t('chips.to'),
      branch: t('chips.branch'),
      allTime: tt('filter.allTime'),
      period: t('chips.period'),
      earliest: t('chips.earliest'),
      latest: t('chips.latest'),
      formatMonth: (month) => formatMonth(month, locale),
    },
    { branch: branchName },
  );
  const dashboardStep = level.trail.find((step) => step.kind === 'dashboard');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TraceHeader
        trail={<TraceTrail steps={level.trail} />}
        eyebrow={t('level1.eyebrow')}
        title={t('level1.title', { figure: figureLabel })}
        value={show(level.parentValue)}
        meta={
          <span className="flex max-w-2xl flex-col gap-2">
            <span className="leading-relaxed">{lead}</span>
            <span className="inline-flex items-center gap-2 text-xs">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-tone-success-fg" />
              <span>
                {td.rich('asOf', {
                  time: () => (
                    <time dateTime={level.asOf} className="font-medium text-text tabular">
                      <bdi>{formatDateTime(new Date(level.asOf), locale)}</bdi>
                    </time>
                  ),
                })}
              </span>
            </span>
          </span>
        }
        chips={chips}
        actions={
          <>
            <LevelExplain
              explain={{ ...level.explain, recordCount: records }}
              value={
                isMoney ? (
                  <MoneyText amount={level.total} />
                ) : (
                  <span className="tabular">{formatInt(level.total, locale)}</span>
                )
              }
              branchName={branchName}
            />
            <DrillExportLinks {...exportLinks('branches', figure, filters, {}, locale)} />
          </>
        }
      />

      <section
        aria-label={td('filters.title')}
        className="flex flex-col gap-4 rounded-card border border-border bg-surface-raised/60 px-5 py-4 print:hidden"
      >
        <MonthRangeFilter
          months={trend.months.map((m) => m.month)}
          from={filters.from}
          to={filters.to}
        />
      </section>

      <div className="min-w-0">
        <BranchFigureTable level={level} />
      </div>

      {dashboardStep ? (
        <p className="text-sm print:hidden">
          <Link
            href={dashboardStep.href}
            className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
          >
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
              <path d="M10 3.5 5.5 8 10 12.5" />
            </svg>
            {t('actions.back', { parent: tt('breadcrumb.dashboard') })}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
