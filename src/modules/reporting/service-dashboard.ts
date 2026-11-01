import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { addMoney, compareMoney, sumMoney } from '@/platform/money';
import { daysBetween, pktDate, pktMonth, systemClock, type Clock } from '@/platform/time';
import { COUNT_FIGURES, FIGURES, MONEY_FIGURES, REPORTING_LIMITS } from './figures';
import { monthsBetween, normaliseFilters } from './filters';
import {
  selectAsOf,
  selectFigureTotals,
  selectRecentlyRouted,
  selectTrend,
  selectUnrouted,
  type FigureTotals,
} from './repo-kpi';
import type {
  DashboardSummary,
  FigureId,
  FigureValue,
  Page,
  PageQuery,
  ReportingFilters,
  RoutedRow,
  TrendMonth,
  TrendSeries,
  UnroutedPage,
} from './types';

type Connectable = Queryable & {
  connect(): Promise<Queryable & { release(err?: Error | boolean): void }>;
  totalCount: number;
};

function isPool(db: Queryable): db is Connectable {
  return (
    typeof (db as Partial<Connectable>).connect === 'function' &&
    typeof (db as Partial<Connectable>).totalCount === 'number'
  );
}

/**
 * Runs related reads in one READ ONLY REPEATABLE READ snapshot so rows, totals and asOf
 * agree. Given a client that is already checked out (for example inside a command
 * transaction), the reads run on it directly and share its transaction.
 */
export async function withReadSnapshot<T>(
  db: Queryable,
  fn: (q: Queryable) => Promise<T>,
): Promise<T> {
  if (!isPool(db)) return fn(db);
  const client = await db.connect();
  let failed = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    failed = true;
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release(failed);
  }
}

function clampPage(q: Partial<PageQuery>): PageQuery {
  const page = Number.isInteger(q.page) && q.page! >= 1 ? q.page! : 1;
  const pageSize =
    Number.isInteger(q.pageSize) && q.pageSize! >= 1
      ? q.pageSize!
      : REPORTING_LIMITS.unroutedPageSize;
  return {
    page: Math.min(page, 1_000_000),
    pageSize: Math.min(pageSize, REPORTING_LIMITS.maxPageSize),
  };
}

function moneyIdentities(money: FigureTotals['money']): DashboardSummary['identities'] {
  const parts = (ids: (keyof FigureTotals['money'])[]) => ({
    value: ids.reduce((acc, id) => addMoney(acc, money[id].value), '0.00'),
    count: ids.reduce((acc, id) => acc + money[id].recordCount, 0),
  });
  const statusParts = parts(['approved', 'pending_approval', 'in_progress']);
  const routingParts = parts(['routed', 'not_yet_routed']);
  return {
    collected:
      compareMoney(money.collected.value, statusParts.value) === 0 &&
      money.collected.recordCount === statusParts.count,
    approved:
      compareMoney(money.approved.value, routingParts.value) === 0 &&
      money.approved.recordCount === routingParts.count,
  };
}

/** Every dashboard figure for the filters, from one snapshot, with the two identities. */
export async function getDashboardSummary(
  db: Queryable,
  actor: Actor,
  filters: ReportingFilters,
): Promise<DashboardSummary> {
  const scope = authorize(actor, 'dashboard.read');
  const f = normaliseFilters(filters);
  const totals = await withReadSnapshot(db, (q) => selectFigureTotals(q, scope, f));
  const figures = {} as Record<FigureId, FigureValue>;
  for (const id of MONEY_FIGURES) {
    figures[id] = { figure: id, measure: FIGURES[id].measure, ...totals.money[id] };
  }
  for (const id of COUNT_FIGURES) {
    const count = totals.counts[id];
    figures[id] = {
      figure: id,
      measure: FIGURES[id].measure,
      value: String(count),
      recordCount: count,
    };
  }
  return { asOf: totals.asOf, filters: f, figures, identities: moneyIdentities(totals.money) };
}

const ZERO_MONTH: Omit<TrendMonth, 'month'> = {
  collected: '0.00',
  approved: '0.00',
  pendingApproval: '0.00',
  inProgress: '0.00',
  notYetRouted: '0.00',
  routed: '0.00',
};
const SERIES = Object.keys(ZERO_MONTH) as (keyof typeof ZERO_MONTH)[];

function earliest(...months: (string | undefined)[]): string {
  return months.filter((m): m is string => Boolean(m)).sort()[0]!;
}
function latest(...months: (string | undefined)[]): string {
  return months
    .filter((m): m is string => Boolean(m))
    .sort()
    .at(-1)!;
}

/**
 * Monthly series by PKT month of collected_on, gap-filled with zero months from `from`
 * (or the first data month) to `to` (or the current PKT month). The range always covers
 * every data month, so each series total equals the summary figure for the same filters.
 */
export async function getMonthlyTrend(
  db: Queryable,
  actor: Actor,
  filters: ReportingFilters,
  clock: Clock = systemClock,
): Promise<TrendSeries> {
  const scope = authorize(actor, 'dashboard.read');
  const f = normaliseFilters(filters);
  const { asOf, rows } = await withReadSnapshot(db, async (q) => ({
    asOf: await selectAsOf(q),
    rows: await selectTrend(q, scope, f),
  }));
  const currentMonth = pktMonth(pktDate(clock.now()));
  const firstData = rows[0]?.month;
  const lastData = rows.at(-1)?.month;
  const start = f.from ?? earliest(firstData, f.to ? undefined : currentMonth, f.to);
  const end = f.to ?? latest(currentMonth, lastData, start);
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const months: TrendMonth[] = monthsBetween(start, latest(start, end)).map((month) => {
    const row = byMonth.get(month);
    return row ? { ...row } : { month, ...ZERO_MONTH };
  });
  const totals = { ...ZERO_MONTH };
  for (const key of SERIES) totals[key] = sumMoney(months.map((m) => m[key]));
  return { asOf, filters: f, months, totals };
}

/** Approved, active, unrouted collections, oldest approval first, with days waiting. */
export async function listUnrouted(
  db: Queryable,
  actor: Actor,
  q: ReportingFilters & Partial<PageQuery>,
  clock: Clock = systemClock,
): Promise<UnroutedPage> {
  const scope = authorize(actor, 'dashboard.read');
  const f = normaliseFilters(q);
  const paging = clampPage(q);
  const { asOf, result } = await withReadSnapshot(db, async (tx) => ({
    asOf: await selectAsOf(tx),
    result: await selectUnrouted(tx, scope, { ...f, ...paging }),
  }));
  const today = pktDate(clock.now());
  return {
    items: result.rows.map((row) => ({
      ...row,
      daysWaiting: daysBetween(pktDate(new Date(row.approvedAt)), today),
    })),
    total: result.total,
    page: paging.page,
    pageSize: paging.pageSize,
    totalAmount: result.totalAmount,
    asOf,
  };
}

/** Routed collections, most recently routed first. */
export async function listRecentlyRouted(
  db: Queryable,
  actor: Actor,
  q: { branch?: string } & Partial<PageQuery>,
): Promise<Page<RoutedRow>> {
  const scope = authorize(actor, 'dashboard.read');
  const f = normaliseFilters({ branch: q.branch });
  const paging = clampPage(q);
  const result = await withReadSnapshot(db, (tx) =>
    selectRecentlyRouted(tx, scope, { branch: f.branch, ...paging }),
  );
  return { items: result.rows, total: result.total, page: paging.page, pageSize: paging.pageSize };
}
