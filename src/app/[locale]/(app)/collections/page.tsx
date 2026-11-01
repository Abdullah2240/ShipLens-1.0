import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listBranches } from '@/modules/branches';
import {
  ACCEPTING_BRANCH_STATUSES,
  getCurrentWeek,
  isDateString,
  listCollections,
  parseCollectionQuery,
} from '@/modules/collections';
import { collectionCapabilities } from '@/modules/collections/capabilities';
import { CollectionFiltersForm } from '@/modules/collections/components/CollectionFiltersForm';
import { CollectionForm } from '@/modules/collections/components/CollectionForm';
import {
  COLLECTIONS_PATH,
  CollectionsTable,
} from '@/modules/collections/components/CollectionsTable';
import { CurrentWeekCard } from '@/modules/collections/components/CurrentWeekCard';
import { LOCK_DAYS } from '@/platform/config/constants';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatInt, formatMoney } from '@/platform/i18n/format';
import { addDays, pktDate, pktWeekStart, systemClock } from '@/platform/time';

// Reads the session, the clock and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PAGE_STEP = 100;
const MAX_LIMIT = 500;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'collections' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('page.title')} | ${common('appName')}`, robots: { index: false } };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** "Show more" keeps the filters and raises the limit by one step. */
function moreHref(sp: Record<string, string | undefined>, limit: number): string {
  const params = new URLSearchParams();
  for (const key of ['branchId', 'status', 'weekStart'] as const) {
    const value = sp[key];
    if (value) params.set(key, value);
  }
  params.set('limit', String(limit));
  return `${COLLECTIONS_PATH}?${params.toString()}`;
}

export default async function CollectionsPage({
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
  const caps = collectionCapabilities(actor.role);
  if (!caps.canLog && !caps.canSeeAll) notFound();

  // Any date picked in the week filter means "the week containing it".
  const rawWeek = first(sp.weekStart);
  const weekStart = isDateString(rawWeek) ? pktWeekStart(rawWeek) : undefined;
  const filters = {
    branchId: caps.canSeeAll ? first(sp.branchId) : undefined,
    status: first(sp.status),
    weekStart,
  };
  const query = parseCollectionQuery({ ...filters, limit: first(sp.limit) });

  const t = await getTranslations('collections');
  const today = pktDate(systemClock.now());
  const pool = getPool();

  const [result, week, branches] = await Promise.all([
    orNotFound(listCollections(pool, actor, systemClock, query)),
    caps.canLog ? orNotFound(getCurrentWeek(pool, actor, systemClock)) : Promise.resolve(null),
    caps.canSeeAll ? orNotFound(listBranches(pool, actor)) : Promise.resolve([]),
  ]);

  const accepting =
    week !== null && (ACCEPTING_BRANCH_STATUSES as readonly string[]).includes(week.branchStatus);
  const hasMore = result.total > result.items.length;
  const shown = locale as Locale;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-text">{t('page.title')}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-muted">
          {caps.canSeeAll ? t('page.headOfficeSubtitle') : t('page.subtitle')}
        </p>
      </header>

      {week ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
          <CurrentWeekCard week={week} />
          {caps.canLog && accepting ? (
            <section
              aria-labelledby="log-collection-title"
              className="flex flex-col rounded-card border border-border bg-surface-raised shadow-card"
            >
              <h2
                id="log-collection-title"
                className="border-b border-border px-5 py-3.5 text-sm font-semibold text-text sm:px-6"
              >
                {t('form.title')}
              </h2>
              <div className="p-5 sm:p-6">
                <CollectionForm mode="create" today={today} minDate={addDays(today, -LOCK_DAYS)} />
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {caps.canSeeAll ? (
        <CollectionFiltersForm
          branches={branches.map(({ id, code, name }) => ({ id, code, name }))}
          values={{ branchId: query.branchId, status: query.status, weekStart: query.weekStart }}
        />
      ) : null}

      <section aria-labelledby="collections-list-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="collections-list-title" className="text-base font-semibold text-text">
            {t('page.caption')}
          </h2>
          <p className="flex flex-wrap items-baseline gap-x-3 text-sm text-text-muted">
            <span role="status">
              {t('page.count', { count: result.total, total: formatInt(result.total, shown) })}
            </span>
            <span aria-hidden="true">·</span>
            <span data-testid="list-active-total" className="tabular">
              {t('page.activeTotal', { amount: formatMoney(result.totalActiveAmount, shown) })}
            </span>
          </p>
        </div>

        <CollectionsTable
          items={result.items}
          showBranch={caps.canSeeAll}
          canAmend={caps.canAmend}
          canVoid={caps.canVoid}
        />

        {hasMore ? (
          <div className="flex justify-center">
            <Link
              href={moreHref(
                {
                  branchId: query.branchId,
                  status: query.status,
                  weekStart: query.weekStart,
                },
                Math.min(MAX_LIMIT, query.limit + PAGE_STEP),
              )}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong/50 bg-surface-raised px-5 text-sm font-semibold text-text shadow-xs transition-colors hover:border-border-strong hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('page.showMore')}
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
