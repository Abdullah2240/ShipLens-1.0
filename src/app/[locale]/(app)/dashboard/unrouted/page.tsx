import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ExplainDrawer, FigureLink, TraceHeader, type ExplainFilterChip } from '@/components/trace';
import { Bdi, IdText, MoneyText } from '@/components/ui/Bidi';
import { Pager } from '@/components/ui/Pager';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { listBranches } from '@/modules/branches';
import {
  REPORTING_LIMITS,
  getDashboardSummary,
  listRecentlyRouted,
  listUnrouted,
  parsePageQuery,
  parseReportingFilters,
  traceHref,
} from '@/modules/reporting';
import { RecentlyRoutedTable } from '@/modules/reporting/components/unrouted/RecentlyRoutedTable';
import { RoutingStatusProvider } from '@/modules/reporting/components/unrouted/RoutingAction';
import { UnroutedTable } from '@/modules/reporting/components/unrouted/UnroutedTable';
import type { Actor } from '@/platform/authz';
import { PERMISSIONS } from '@/platform/authz/permissions';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';
import { formatDateTime, formatInt, formatMoney } from '@/platform/i18n/format';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

const PATH = '/dashboard/unrouted';
type Tab = 'open' | 'recent';
const TABS: readonly Tab[] = ['open', 'recent'];

type Params = Promise<{ locale: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Canonical list URL: tab (when not the default), branch, page (when not the first). */
function unroutedHref(q: { tab: Tab; branch?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (q.tab !== 'open') params.set('tab', q.tab);
  if (q.branch) params.set('branch', q.branch);
  if (q.page && q.page > 1) params.set('page', String(q.page));
  const search = params.toString();
  return search ? `${PATH}?${search}` : PATH;
}

function exportHref(branch: string | undefined, locale: string): string {
  const params = new URLSearchParams();
  if (branch) params.set('branch', branch);
  params.set('locale', locale);
  return `/api/v1/exports/unrouted?${params.toString()}`;
}

function canRoute(actor: Actor): boolean {
  const grants = PERMISSIONS['collection.mark_routed'] as Partial<Record<string, string>>;
  return Object.hasOwn(grants, actor.role);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'unrouted' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('title')} | ${common('appName')}`, robots: { index: false } };
}

const fieldClass =
  'block h-10 w-full rounded-lg border border-border-strong/50 bg-surface-raised px-3 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const quietLink =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border-strong/50 bg-surface-raised px-4 text-sm font-semibold text-text shadow-xs transition-colors hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export default async function UnroutedPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const { actor } = await requirePageActor();

  const tab: Tab = sp.tab === 'recent' ? 'recent' : 'open';
  // The list is all time; only the branch narrows it, so the total matches the KPI.
  const { branch } = parseReportingFilters({ branch: sp.branch });
  const paging = parsePageQuery({ page: sp.page }, { pageSize: REPORTING_LIMITS.unroutedPageSize });
  const pool = getPool();

  const [t, trace, summary, open, recent, branches] = await orNotFound(
    Promise.all([
      getTranslations('unrouted'),
      getTranslations('trace'),
      getDashboardSummary(pool, actor, { branch }),
      tab === 'open' ? listUnrouted(pool, actor, { branch, ...paging }) : Promise.resolve(null),
      tab === 'recent'
        ? listRecentlyRouted(pool, actor, { branch, ...paging })
        : Promise.resolve(null),
      listBranches(pool, actor),
    ]),
  );

  const figure = summary.figures.not_yet_routed;
  const selected = branch ? branches.find((b) => b.id === branch) : undefined;
  const sortedBranches = [...branches].sort((a, b) => a.code.localeCompare(b.code));
  const chips: ExplainFilterChip[] = selected
    ? [
        {
          label: t('filter.branch'),
          value: (
            <>
              <IdText id={selected.code} /> <Bdi>{selected.name}</Bdi>
            </>
          ),
        },
      ]
    : [];
  const figureLabel = formatMoney(figure.value, locale as Locale);
  const routing = canRoute(actor);
  const list = open ?? recent;

  return (
    <div className="flex flex-col gap-6">
      <TraceHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        value={
          <FigureLink
            href={traceHref('not_yet_routed', {}, { branch })}
            size="xl"
            label={`${trace('figures.not_yet_routed.label')}, ${figureLabel}`}
          >
            <MoneyText amount={figure.value} />
          </FigureLink>
        }
        meta={
          <div className="flex flex-col gap-2">
            <p className="max-w-2xl leading-relaxed">{t('lead')}</p>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-semibold text-text tabular">
                {t('recordCount', {
                  count: figure.recordCount,
                  records: formatInt(figure.recordCount, locale as Locale),
                })}
              </span>
              <span aria-hidden="true" className="text-border-strong">
                ·
              </span>
              <span>
                <bdi>
                  {t('asOf', {
                    time: formatDateTime(new Date(summary.asOf), locale as Locale),
                  })}
                </bdi>
              </span>
            </p>
          </div>
        }
        chips={chips}
        actions={
          <>
            <ExplainDrawer
              figure="not_yet_routed"
              value={<MoneyText amount={figure.value} />}
              recordCount={figure.recordCount}
              asOf={summary.asOf}
              filters={chips}
            />
            {tab === 'open' ? (
              <a href={exportHref(branch, locale)} download className={quietLink}>
                <svg
                  viewBox="0 0 20 20"
                  className="size-4 text-text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10 3v10M6 9l4 4 4-4M4 16h12" />
                </svg>
                {t('export')}
              </a>
            ) : null}
          </>
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label={t('tabs.label')} className="flex gap-1 border-b border-border">
          {TABS.map((key) => {
            const active = key === tab;
            return (
              <Link
                key={key}
                href={unroutedHref({ tab: key, branch })}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 pt-2 pb-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  active
                    ? 'border-primary text-text'
                    : 'border-transparent text-text-muted hover:border-border-strong/50 hover:text-text'
                }`}
              >
                {t(`tabs.${key}`)}
                {key === 'open' ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs tabular ${
                      active ? 'bg-primary/10 text-primary' : 'bg-surface-sunken text-text-muted'
                    }`}
                  >
                    {formatInt(figure.recordCount, locale as Locale)}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <form
          method="get"
          role="search"
          aria-label={t('filter.label')}
          className="flex flex-wrap items-end gap-2"
        >
          {tab === 'recent' ? <input type="hidden" name="tab" value="recent" /> : null}
          <div className="flex min-w-[14rem] flex-1 flex-col gap-1.5 sm:flex-none">
            <label htmlFor="unrouted-branch" className="text-xs font-semibold text-text-muted">
              {t('filter.branch')}
            </label>
            <select
              id="unrouted-branch"
              name="branch"
              defaultValue={branch ?? ''}
              className={fieldClass}
            >
              <option value="">{t('filter.allBranches')}</option>
              {sortedBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {`${b.code} · ${b.name}`}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('filter.apply')}
          </button>
          {branch ? (
            <Link
              href={unroutedHref({ tab })}
              className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('filter.clear')}
            </Link>
          ) : null}
        </form>
      </div>

      <RoutingStatusProvider>
        {open ? (
          <UnroutedTable
            rows={open.items}
            totalAmount={open.totalAmount}
            recordCount={open.total}
            parent={{ value: figure.value, recordCount: figure.recordCount }}
            canRoute={routing}
          />
        ) : null}
        {recent ? <RecentlyRoutedTable rows={recent.items} canRoute={routing} /> : null}
      </RoutingStatusProvider>

      {list ? (
        <Pager
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          hrefFor={(page) => unroutedHref({ tab, branch, page })}
        />
      ) : null}
    </div>
  );
}
