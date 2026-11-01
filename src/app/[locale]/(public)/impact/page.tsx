import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TrendChart, TrendTable, formatMonth, type TrendPoint } from '@/components/figures';
import { ImpactBranches } from '@/components/public/ImpactBranches';
import { ImpactFigures } from '@/components/public/ImpactFigures';
import { PublicHero } from '@/components/public/PublicHero';
import { publicMetadata } from '@/components/public/seo';
import { DateText } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { getPublicImpact, type PublicImpact } from '@/modules/reporting/service-impact';
import { getPool } from '@/platform/db';
import { formatMoney } from '@/platform/i18n/format';
import { toMinor } from '@/platform/money';

// Approved figures are read on every request through the short impact cache; the build
// has no database.
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

const SERIES_KEY = 'approved';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const [t, common] = await Promise.all([
    getTranslations({ locale, namespace: 'impact.meta' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return publicMetadata({
    locale,
    path: '/impact',
    title: t('title'),
    description: t('description'),
    appName: common('appName'),
  });
}

function peakMonth(monthly: PublicImpact['monthly']) {
  let peak = monthly[0];
  for (const month of monthly) {
    if (peak && toMinor(month.approved) > toMinor(peak.approved)) peak = month;
  }
  return peak;
}

const CHECK_CIRCLE = 'M12 21a9 9 0 100-18 9 9 0 000 18zM8.5 12.2l2.4 2.4 4.6-4.8';

export default async function ImpactPage({ params }: PageProps) {
  const { locale: raw } = await params;
  setRequestLocale(raw);
  const locale: Locale = raw === 'ur' ? 'ur' : 'en';
  const [t, tChart, impact] = await Promise.all([
    getTranslations('impact'),
    getTranslations('dashboard.chart'),
    getPublicImpact(getPool()),
  ]);

  const points: TrendPoint[] = impact.monthly.map((m) => ({
    month: m.month,
    values: { [SERIES_KEY]: m.approved },
  }));
  const series = [{ key: SERIES_KEY, label: t('trend.series'), tone: 'primary' as const }];
  const first = impact.monthly[0];
  const last = impact.monthly.at(-1);
  const peak = peakMonth(impact.monthly);
  const summary =
    first && last && peak
      ? t('trend.summary', {
          first: formatMonth(first.month, locale),
          last: formatMonth(last.month, locale),
          peak: formatMonth(peak.month, locale),
          peakAmount: formatMoney(peak.approved, locale),
        })
      : t('trend.caption');

  return (
    <>
      <PublicHero
        eyebrow={t('hero.eyebrow')}
        title={t('hero.title')}
        lead={t('hero.lead')}
        motif="network"
      >
        <p
          data-impact-as-of
          className="inline-flex w-fit flex-wrap items-center gap-2 rounded-full border border-border bg-surface-raised/80 px-3.5 py-1.5 text-sm text-text-muted"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4 shrink-0 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={CHECK_CIRCLE} />
          </svg>
          {t.rich('asOf', {
            time: () => (
              <DateText value={impact.asOf} withTime className="font-semibold text-text" />
            ),
          })}
        </p>
      </PublicHero>

      <div className="relative -mt-8 md:-mt-12">
        <ImpactFigures
          approvedTotal={impact.approvedTotal}
          approvedReportCount={impact.approvedReportCount}
          monthsCovered={impact.monthsCovered}
          activeBranchCount={impact.activeBranchCount}
          cities={impact.cities}
        />
      </div>

      <section
        aria-labelledby="impact-trend-title"
        className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6 md:py-20"
      >
        <h2
          id="impact-trend-title"
          className="font-display-ur text-2xl font-bold tracking-tight text-text md:text-3xl"
        >
          {t('trend.title')}
        </h2>
        <div className="mt-6 rounded-card border border-border bg-surface-raised p-5 shadow-card sm:p-7">
          <TrendChart
            points={points}
            series={series}
            caption={t('trend.caption')}
            summary={summary}
            height={220}
          />
          {points.length > 0 ? (
            <details className="group mt-5 border-t border-border pt-4">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-md text-sm font-semibold text-primary select-none hover:text-primary-hover">
                <svg
                  viewBox="0 0 16 16"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="2.5" width="12" height="11" rx="2" />
                  <path d="M2 6.5h12M2 10h12M6.5 6.5v7" />
                </svg>
                <span className="group-open:hidden">{tChart('viewTable')}</span>
                <span className="hidden group-open:inline">{tChart('hideTable')}</span>
              </summary>
              <div className="mt-4 overflow-x-auto">
                <TrendTable
                  points={points}
                  series={series}
                  caption={t('trend.caption')}
                  totals={{ [SERIES_KEY]: impact.approvedTotal }}
                />
              </div>
            </details>
          ) : null}
        </div>
      </section>

      <ImpactBranches branches={impact.activeBranches} />

      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 md:grid-cols-12 md:items-start md:px-6 md:py-20">
        <section
          aria-labelledby="impact-method-title"
          className="flex gap-4 rounded-card border border-border bg-surface-raised p-6 shadow-card sm:p-8 md:col-span-7"
        >
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6h16M4 12h10M4 18h7M16.5 16.5l2 2 3.5-4" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2
              id="impact-method-title"
              className="font-display-ur text-2xl font-bold tracking-tight text-text"
            >
              {t('method.title')}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-text-muted">
              {t('method.body')}
            </p>
          </div>
        </section>

        <section
          aria-labelledby="impact-cta-title"
          className="flex flex-col gap-4 md:col-span-5 md:pt-4"
        >
          <h2
            id="impact-cta-title"
            className="font-display-ur text-2xl font-bold tracking-tight text-text"
          >
            {t('cta.title')}
          </h2>
          <p className="text-text-muted">{t('cta.lead')}</p>
          <div className="mt-1 flex flex-wrap gap-3">
            <Link
              prefetch={false}
              href="/get-involved"
              data-impact-cta="getInvolved"
              className="inline-flex h-12 items-center rounded-xl bg-primary px-6 text-base font-semibold text-primary-contrast shadow-card transition-colors hover:bg-primary-hover"
            >
              {t('cta.getInvolved')}
            </Link>
            <Link
              prefetch={false}
              href="/branches"
              data-impact-cta="branches"
              className="inline-flex h-12 items-center rounded-xl border border-border-strong bg-surface-raised px-6 text-base font-semibold text-text transition-colors hover:bg-surface-sunken"
            >
              {t('cta.branches')}
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
