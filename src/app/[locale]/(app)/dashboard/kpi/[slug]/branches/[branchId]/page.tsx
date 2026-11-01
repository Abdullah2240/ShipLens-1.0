import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatMonth } from '@/components/figures';
import { TraceHeader } from '@/components/trace';
import { Bdi, IdText, MoneyText, StatusBadge } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  figureFromSlug,
  parseReportingFilters,
  type FigureId,
  getBranchReports,
} from '@/modules/reporting';
import { DrillExportLinks } from '@/modules/reporting/components/drill/BranchFigureTable';
import { LevelExplain } from '@/modules/reporting/components/drill/LevelExplain';
import { ReportFigureTable } from '@/modules/reporting/components/drill/ReportFigureTable';
import { TraceTrail } from '@/modules/reporting/components/drill/TraceTrail';
import {
  chipsFor,
  exportLinks,
  footerRecordCount,
} from '@/modules/reporting/components/drill/drill-view-model';
import { getPool } from '@/platform/db';
import { formatDateTime, formatInt, formatMoney } from '@/platform/i18n/format';
import { getPageActor, orNotFound, requirePageActor } from '@/platform/http/interim-server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; slug: string; branchId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** One read per request, shared by the page and its metadata. Null when signed out. */
const loadLevel = cache(async (figure: FigureId, branchId: string, from?: string, to?: string) => {
  const found = await getPageActor();
  if (!found) return null;
  return getBranchReports(getPool(), found.actor, figure, branchId, { from, to });
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { locale, slug, branchId } = await params;
  const [t, tt, common] = await Promise.all([
    getTranslations({ locale, namespace: 'drilldown' }),
    getTranslations({ locale, namespace: 'trace' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  const figure = figureFromSlug(slug);
  let title = tt('breadcrumb.dashboard');
  if (figure) {
    const filters = parseReportingFilters(await searchParams);
    const level = await loadLevel(figure, branchId, filters.from, filters.to).catch(() => null);
    const label = tt(`figures.${figure}.label`);
    title = level ? t('level2.metaTitle', { figure: label, name: level.branch.branchName }) : label;
  }
  return { title: `${title} | ${common('appName')}`, robots: { index: false } };
}

/** Level 2: the weekly reports behind one branch's value for a figure. */
export default async function BranchReportsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale: rawLocale, slug, branchId } = await params;
  setRequestLocale(rawLocale);
  const locale = rawLocale as Locale;
  await requirePageActor();
  const figure = figureFromSlug(slug);
  if (!figure) notFound();

  const filters = parseReportingFilters(await searchParams);
  const level = await orNotFound(loadLevel(figure, branchId, filters.from, filters.to));
  if (!level) notFound();
  const { branch } = level;

  const [t, tt, td] = await Promise.all([
    getTranslations('drilldown'),
    getTranslations('trace'),
    getTranslations('dashboard'),
  ]);
  const figureLabel = tt(`figures.${figure}.label`);
  const isMoney = level.measure === 'amount';
  const show = (value: string) => (isMoney ? formatMoney(value, locale) : formatInt(value, locale));
  const records = footerRecordCount('reports', level.measure, level.rows, level.recordCount);
  const monthFilters = { from: filters.from, to: filters.to };

  const chips = chipsFor(
    { ...monthFilters, branchId: branch.branchId },
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
    { branch: branch.branchName },
  );
  const figureStep = level.trail.find((step) => step.kind === 'figure');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TraceHeader
        trail={<TraceTrail steps={level.trail} />}
        eyebrow={t('level2.eyebrow')}
        title={t.rich('level2.title', {
          figure: figureLabel,
          name: branch.branchName,
          branch: (chunks) => <Bdi>{chunks}</Bdi>,
        })}
        value={show(level.parentValue)}
        meta={
          <span className="flex max-w-2xl flex-col gap-2.5">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="sr-only">{t('level2.branchCode')}</span>
                <IdText
                  id={branch.branchCode}
                  mono
                  className="rounded-md border border-border bg-surface-raised px-1.5 py-0.5 text-xs text-text"
                />
              </span>
              {branch.city ? <Bdi className="text-sm text-text-muted">{branch.city}</Bdi> : null}
              <StatusBadge status={branch.branchStatus} />
            </span>
            <span className="leading-relaxed">
              {figure === 'reports_awaiting_review'
                ? t('countFigure.awaitingBranchLead')
                : t('level2.lead')}
            </span>
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
              branchName={branch.branchName}
            />
            <DrillExportLinks
              {...exportLinks(
                'reports',
                figure,
                monthFilters,
                { branchId: branch.branchId },
                locale,
              )}
            />
          </>
        }
      />

      <div className="min-w-0">
        <ReportFigureTable level={level} />
      </div>

      {figureStep ? (
        <p className="text-sm print:hidden">
          <Link
            href={figureStep.href}
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
            {t('actions.back', { parent: t('level1.title', { figure: figureLabel }) })}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
