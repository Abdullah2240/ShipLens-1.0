import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { formatMonth } from '@/components/figures';
import { FilterChips, MonthRangeFilter } from '@/components/trace';
import { Bdi, IdText } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import { getBranch } from '@/modules/branches';
import { getDashboardSummary, getMonthlyTrend, parseReportingFilters } from '@/modules/reporting';
import { CountFigures } from '@/modules/reporting/components/dashboard/CountFigures';
import { DashboardActions } from '@/modules/reporting/components/dashboard/DashboardActions';
import { MoneyFlow } from '@/modules/reporting/components/dashboard/MoneyFlow';
import { TrendSection } from '@/modules/reporting/components/dashboard/TrendSection';
import {
  buildDashboardModel,
  filterChipTexts,
} from '@/modules/reporting/components/dashboard/dashboard-view-model';
import { getPool } from '@/platform/db';
import { formatDateTime } from '@/platform/i18n/format';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('metaTitle')} | ${common('appName')}`, robots: { index: false } };
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale: rawLocale } = await params;
  setRequestLocale(rawLocale);
  const locale = rawLocale as Locale;
  const { actor } = await requireActor();
  const filters = parseReportingFilters(await searchParams);
  const pool = getPool();
  const ranged = Boolean(filters.from || filters.to);

  const [summary, trend, options] = await orNotFound(
    Promise.all([
      getDashboardSummary(pool, actor, filters),
      getMonthlyTrend(pool, actor, filters),
      // The month picker offers every month with data, not only the filtered range.
      ranged ? getMonthlyTrend(pool, actor, { branch: filters.branch }) : null,
    ]),
  );
  const branchName = filters.branch
    ? await getBranch(pool, actor, filters.branch).then(
        (branch) => branch.name,
        () => null,
      )
    : null;

  const model = buildDashboardModel(summary, trend, summary.filters);
  const monthOptions = (options ?? trend).months.map((m) => m.month);
  const [t, tf, tt] = await Promise.all([
    getTranslations('dashboard'),
    getTranslations('dashboard.filters'),
    getTranslations('trace'),
  ]);

  const chips = filterChipTexts(model.filters, {
    t: (key, values) => tf(key, values),
    allTime: tt('filter.allTime'),
    formatMonth: (month) => formatMonth(month, locale),
    branchName,
  }).map((chip) => ({
    label: chip.label,
    value: chip.isId ? (
      <IdText id={chip.text} mono />
    ) : chip.kind === 'branch' ? (
      <Bdi>{chip.text}</Bdi>
    ) : (
      <bdi>{chip.text}</bdi>
    ),
  }));
  const empty = model.collected.recordCount === 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-2xl min-w-0 flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-balance text-text sm:text-[2.125rem] rtl:tracking-normal">
            {t('title')}
          </h1>
          <p className="text-sm leading-relaxed text-text-muted sm:text-base">{t('subtitle')}</p>
          <p className="mt-1 inline-flex items-center gap-2 text-xs text-text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-tone-success-fg" />
            <span>
              {t.rich('asOf', {
                time: () => (
                  <time dateTime={summary.asOf} className="font-medium text-text tabular">
                    <bdi>{formatDateTime(new Date(summary.asOf), locale)}</bdi>
                  </time>
                ),
              })}
            </span>
          </p>
        </div>
        <DashboardActions exportHref={model.exportHref} printHref={model.printHref} />
      </header>

      <section
        aria-label={t('filters.title')}
        className="flex flex-col gap-4 rounded-card border border-border bg-surface-raised/60 px-5 py-4 lg:flex-row lg:items-end lg:justify-between print:hidden"
      >
        <MonthRangeFilter months={monthOptions} from={filters.from} to={filters.to} />
        {chips.length > 0 ? <FilterChips chips={chips} label={t('filters.title')} /> : null}
      </section>

      {empty ? (
        <div
          role="status"
          className="rounded-card border border-dashed border-border-strong/50 bg-surface-raised px-6 py-5"
        >
          <p className="text-sm font-semibold text-text">{t('empty.title')}</p>
          <p className="mt-1 text-sm text-text-muted">{t('empty.body')}</p>
        </div>
      ) : null}

      <MoneyFlow model={model} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <CountFigures model={model} />
        <TrendSection model={model} />
      </div>
    </div>
  );
}
