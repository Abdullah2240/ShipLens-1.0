// Canonical figure queries. Every money number reads v_kpi_collections filtered by the
// figure's predicate column from FIGURES; every report total reads v_report_figures.
// Sums are formatted in SQL as two-decimal strings and never parsed in JavaScript.
import { scopeWhere, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { FIGURES, MONEY_FIGURES, isMoneyFigure } from './figures';
import { isUuid, monthBounds } from './filters';
import type { CountFigureId, MoneyFigureId, PageQuery, ReportingFilters } from './types';

export type KpiFilters = ReportingFilters & { branchId?: string; reportId?: string };

export interface FigureTotals {
  asOf: string;
  money: Record<MoneyFigureId, { value: string; recordCount: number }>;
  counts: Record<CountFigureId, number>;
}

export interface BranchFigureRow {
  branchId: string;
  branchCode: string;
  branchName: string;
  branchStatus: string;
  value: string;
  recordCount: number;
  reportCount: number;
}

export interface ReportFigureRow {
  reportId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  weekStart: string;
  status: string;
  value: string;
  recordCount: number;
  frozenAmount: string | null;
  frozenCount: number | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface CollectionFigureRow {
  collectionId: string;
  branchId: string;
  reportId: string;
  collectedOn: string;
  purpose: string;
  amount: string;
  routedAt: string | null;
  reportStatus: string;
}

export interface ActiveBranchRow {
  branchId: string;
  branchCode: string;
  branchName: string;
  city: string | null;
}

export interface SubmittedReportCountRow {
  branchId: string;
  branchCode: string;
  branchName: string;
  count: number;
  value: string;
}

export interface ReportFigure {
  reportId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  weekStart: string;
  status: string;
  liveAmount: string;
  liveCount: number;
  frozenAmount: string | null;
  frozenCount: number | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

export interface TrendRow {
  month: string;
  collected: string;
  approved: string;
  pendingApproval: string;
  inProgress: string;
  notYetRouted: string;
  routed: string;
}

export interface UnroutedRepoRow {
  collectionId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  reportId: string;
  weekStart: string;
  collectedOn: string;
  purpose: string;
  amount: string;
  approvedAt: string;
}

export interface RoutedRepoRow extends UnroutedRepoRow {
  routedAt: string;
  routedByName: string | null;
}

const SUM = (expr: string) => `COALESCE(SUM(${expr}), 0)::numeric(14,2)::text`;
const SUM_WHERE = (predicate: string) =>
  `COALESCE(SUM(k.amount) FILTER (WHERE ${predicate}), 0)::numeric(14,2)::text`;
const PREDICATE_COLUMN = /^is_[a-z_]+$/;

/** Positional parameter collector so fragments can be composed in any order. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown, cast?: string): string {
    this.values.push(value);
    return `$${this.values.length}${cast ? `::${cast}` : ''}`;
  }
  scope(scope: Scope, column: string): string {
    const where = scopeWhere(scope, column, this.values.length + 1);
    this.values.push(...where.params);
    return where.sql;
  }
}

/** The view predicate for a money figure, qualified with the view alias. Never from input. */
export function figurePredicate(figure: MoneyFigureId, alias = 'k'): string {
  if (!isMoneyFigure(figure)) throw new Error(`not a money figure: ${String(figure)}`);
  const column = FIGURES[figure].predicate;
  if (column === 'TRUE') return 'TRUE';
  if (!column || !PREDICATE_COLUMN.test(column)) throw new Error('invalid figure predicate');
  return `${alias}.${column}`;
}

function uuidEquals(p: Params, column: string, value: string | undefined): string | null {
  if (value === undefined) return null;
  return isUuid(value) ? `${column} = ${p.add(value.toLowerCase(), 'uuid')}` : 'FALSE';
}

/** Scope, month bounds on `dateColumn`, and branch filters, as AND-ed SQL. */
function filterWhere(
  p: Params,
  scope: Scope,
  f: KpiFilters,
  columns: { branch: string; date: string | null; report?: string },
): string {
  const parts = [p.scope(scope, columns.branch)];
  if (columns.date) {
    const { fromDate, toDate } = monthBounds(f);
    if (fromDate) parts.push(`${columns.date} >= ${p.add(fromDate, 'date')}`);
    if (toDate) parts.push(`${columns.date} <= ${p.add(toDate, 'date')}`);
  }
  for (const part of [
    uuidEquals(p, columns.branch, f.branch),
    uuidEquals(p, columns.branch, f.branchId),
    columns.report ? uuidEquals(p, columns.report, f.reportId) : null,
  ]) {
    if (part) parts.push(part);
  }
  return parts.join(' AND ');
}

/** WHERE clause for v_kpi_collections k: figure predicate (if any), scope and filters. */
function kpiWhere(p: Params, scope: Scope, f: KpiFilters, figure: MoneyFigureId | null): string {
  const filters = filterWhere(p, scope, f, {
    branch: 'k.branch_id',
    date: 'k.collected_on',
    report: 'k.report_id',
  });
  return figure ? `${figurePredicate(figure)} AND ${filters}` : filters;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function pageWindow(q: PageQuery): { limit: number; offset: number } {
  const pageSize = Math.max(1, Math.trunc(q.pageSize));
  const page = Math.max(1, Math.trunc(q.page));
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

export async function selectAsOf(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ as_of: Date }>('SELECT now() AS as_of');
  return rows[0]!.as_of.toISOString();
}

async function countActiveBranches(db: Queryable, scope: Scope, f: ReportingFilters) {
  const p = new Params();
  const where = filterWhere(p, scope, { branch: f.branch }, { branch: 'b.id', date: null });
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM branches b WHERE b.status = 'active' AND ${where}`,
    p.values,
  );
  return rows[0]?.n ?? 0;
}

async function countSubmittedReports(db: Queryable, scope: Scope, f: ReportingFilters) {
  const p = new Params();
  const where = filterWhere(p, scope, f, { branch: 'rf.branch_id', date: 'rf.week_start' });
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM v_report_figures rf WHERE rf.status = 'submitted' AND ${where}`,
    p.values,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Every figure for the filters. Money figures come from one pass over v_kpi_collections.
 * active_branches ignores the month filter (it is "as of now"); reports_awaiting_review
 * applies it to week_start. Run inside one snapshot together with any related reads.
 */
export async function selectFigureTotals(
  db: Queryable,
  scope: Scope,
  f: ReportingFilters,
): Promise<FigureTotals> {
  const p = new Params();
  const where = kpiWhere(p, scope, { from: f.from, to: f.to, branch: f.branch }, null);
  const columns = MONEY_FIGURES.map((id) => {
    const predicate = figurePredicate(id);
    return `${SUM_WHERE(predicate)} AS ${id}_value,
            (COUNT(*) FILTER (WHERE ${predicate}))::int AS ${id}_count`;
  });
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT now() AS as_of, ${columns.join(', ')} FROM v_kpi_collections k WHERE ${where}`,
    p.values,
  );
  const row = rows[0]!;
  const money = {} as FigureTotals['money'];
  for (const id of MONEY_FIGURES) {
    money[id] = { value: row[`${id}_value`] as string, recordCount: row[`${id}_count`] as number };
  }
  const activeBranches = await countActiveBranches(db, scope, f);
  const awaiting = await countSubmittedReports(db, scope, f);
  return {
    asOf: (row.as_of as Date).toISOString(),
    money,
    counts: { active_branches: activeBranches, reports_awaiting_review: awaiting },
  };
}

/** Branches contributing to a money figure (value > 0), largest first, then by code. */
export async function selectFigureByBranch(
  db: Queryable,
  scope: Scope,
  figure: MoneyFigureId,
  f: ReportingFilters,
): Promise<BranchFigureRow[]> {
  const p = new Params();
  const where = kpiWhere(p, scope, { from: f.from, to: f.to, branch: f.branch }, figure);
  const { rows } = await db.query<{
    branch_id: string;
    code: string;
    name: string;
    status: string;
    value: string;
    record_count: number;
    report_count: number;
  }>(
    `SELECT b.id AS branch_id, b.code, b.name, b.status,
            ${SUM('k.amount')} AS value,
            count(*)::int AS record_count,
            count(DISTINCT k.report_id)::int AS report_count
       FROM v_kpi_collections k
       JOIN branches b ON b.id = k.branch_id
      WHERE ${where}
      GROUP BY b.id, b.code, b.name, b.status
     HAVING SUM(k.amount) > 0
      ORDER BY SUM(k.amount) DESC, b.code, b.id`,
    p.values,
  );
  return rows.map((r) => ({
    branchId: r.branch_id,
    branchCode: r.code,
    branchName: r.name,
    branchStatus: r.status,
    value: r.value,
    recordCount: r.record_count,
    reportCount: r.report_count,
  }));
}

/** Reports with at least one collection contributing to the figure, newest week first. */
export async function selectFigureReports(
  db: Queryable,
  scope: Scope,
  figure: MoneyFigureId,
  f: ReportingFilters & { branchId?: string },
): Promise<ReportFigureRow[]> {
  const p = new Params();
  const where = kpiWhere(
    p,
    scope,
    { from: f.from, to: f.to, branch: f.branch, branchId: f.branchId },
    figure,
  );
  const { rows } = await db.query<{
    report_id: string;
    branch_id: string;
    code: string;
    name: string;
    week_start: string;
    status: string;
    value: string;
    record_count: number;
    frozen_amount: string | null;
    frozen_count: number | null;
    submitted_at: Date | null;
    reviewed_at: Date | null;
  }>(
    `SELECT k.report_id, k.branch_id, b.code, b.name, k.week_start::text AS week_start,
            k.report_status AS status,
            ${SUM('k.amount')} AS value,
            count(*)::int AS record_count,
            r.total_amount::text AS frozen_amount, r.collection_count AS frozen_count,
            r.submitted_at, r.reviewed_at
       FROM v_kpi_collections k
       JOIN branches b ON b.id = k.branch_id
       JOIN weekly_reports r ON r.id = k.report_id
      WHERE ${where}
      GROUP BY k.report_id, k.branch_id, b.code, b.name, k.week_start, k.report_status,
               r.total_amount, r.collection_count, r.submitted_at, r.reviewed_at
      ORDER BY k.week_start DESC, b.code, k.report_id`,
    p.values,
  );
  return rows.map((r) => ({
    reportId: r.report_id,
    branchId: r.branch_id,
    branchCode: r.code,
    branchName: r.name,
    weekStart: r.week_start,
    status: r.status,
    value: r.value,
    recordCount: r.record_count,
    frozenAmount: r.frozen_amount,
    frozenCount: r.frozen_count,
    submittedAt: iso(r.submitted_at),
    reviewedAt: iso(r.reviewed_at),
  }));
}

/**
 * The exact rows a money figure is summed from, by collected_on then id. `total` and
 * `recordCount` always cover every matching row, even when `limit` cuts the list.
 */
export async function selectFigureCollections(
  db: Queryable,
  scope: Scope,
  figure: MoneyFigureId,
  f: KpiFilters,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: CollectionFigureRow[]; total: string; recordCount: number }> {
  const p = new Params();
  const where = kpiWhere(p, scope, f, figure);
  const totals = await db.query<{ total: string; record_count: number }>(
    `SELECT ${SUM('k.amount')} AS total, count(*)::int AS record_count
       FROM v_kpi_collections k WHERE ${where}`,
    p.values,
  );
  let paging = '';
  const values = [...p.values];
  if (opts.limit !== undefined) {
    values.push(Math.max(0, Math.trunc(opts.limit)));
    paging += ` LIMIT $${values.length}`;
  }
  if (opts.offset !== undefined) {
    values.push(Math.max(0, Math.trunc(opts.offset)));
    paging += ` OFFSET $${values.length}`;
  }
  const { rows } = await db.query<{
    collection_id: string;
    branch_id: string;
    report_id: string;
    collected_on: string;
    purpose: string;
    amount: string;
    routed_at: Date | null;
    report_status: string;
  }>(
    `SELECT k.collection_id, k.branch_id, k.report_id, k.collected_on::text AS collected_on, c.purpose,
            k.amount::text AS amount, k.routed_at, k.report_status
       FROM v_kpi_collections k
       JOIN collections c ON c.id = k.collection_id
      WHERE ${where}
      ORDER BY k.collected_on, k.collection_id${paging}`,
    values,
  );
  return {
    rows: rows.map((r) => ({
      collectionId: r.collection_id,
      branchId: r.branch_id,
      reportId: r.report_id,
      collectedOn: r.collected_on,
      purpose: r.purpose,
      amount: r.amount,
      routedAt: iso(r.routed_at),
      reportStatus: r.report_status,
    })),
    total: totals.rows[0]!.total,
    recordCount: totals.rows[0]!.record_count,
  };
}

/** Active branches in scope (branch filter applies, month filter does not), by code. */
export async function selectActiveBranches(
  db: Queryable,
  scope: Scope,
  f: ReportingFilters,
): Promise<ActiveBranchRow[]> {
  const p = new Params();
  const where = filterWhere(p, scope, { branch: f.branch }, { branch: 'b.id', date: null });
  const { rows } = await db.query<{ id: string; code: string; name: string; city: string | null }>(
    `SELECT b.id, b.code, b.name, b.city FROM branches b
      WHERE b.status = 'active' AND ${where}
      ORDER BY b.code, b.id`,
    p.values,
  );
  return rows.map((r) => ({
    branchId: r.id,
    branchCode: r.code,
    branchName: r.name,
    city: r.city,
  }));
}

/**
 * Submitted reports per branch (month filter on week_start). `value` is the live total of
 * those reports' active collections. Branches with none are omitted.
 */
export async function selectSubmittedReportCounts(
  db: Queryable,
  scope: Scope,
  f: ReportingFilters,
): Promise<SubmittedReportCountRow[]> {
  const p = new Params();
  const where = filterWhere(p, scope, f, { branch: 'rf.branch_id', date: 'rf.week_start' });
  const { rows } = await db.query<{
    id: string;
    code: string;
    name: string;
    n: number;
    value: string;
  }>(
    `SELECT b.id, b.code, b.name, count(*)::int AS n, ${SUM('rf.live_amount')} AS value
       FROM v_report_figures rf
       JOIN branches b ON b.id = rf.branch_id
      WHERE rf.status = 'submitted' AND ${where}
      GROUP BY b.id, b.code, b.name
      ORDER BY count(*) DESC, b.code, b.id`,
    p.values,
  );
  return rows.map((r) => ({
    branchId: r.id,
    branchCode: r.code,
    branchName: r.name,
    count: r.n,
    value: r.value,
  }));
}

/** One report's frozen and live totals; null when missing or out of scope. */
export async function selectReportFigure(
  db: Queryable,
  scope: Scope,
  reportId: string,
): Promise<ReportFigure | null> {
  if (!isUuid(reportId)) return null;
  const p = new Params();
  const id = p.add(reportId.toLowerCase(), 'uuid');
  const where = p.scope(scope, 'rf.branch_id');
  const { rows } = await db.query<{
    report_id: string;
    branch_id: string;
    code: string;
    name: string;
    week_start: string;
    status: string;
    live_amount: string;
    live_count: number;
    frozen_amount: string | null;
    frozen_count: number | null;
    submitted_at: Date | null;
    reviewed_at: Date | null;
  }>(
    `SELECT rf.report_id, rf.branch_id, b.code, b.name, rf.week_start::text AS week_start, rf.status,
            rf.live_amount::text AS live_amount, rf.live_count,
            rf.frozen_amount::text AS frozen_amount, rf.frozen_count,
            rf.submitted_at, rf.reviewed_at
       FROM v_report_figures rf
       JOIN branches b ON b.id = rf.branch_id
      WHERE rf.report_id = ${id} AND ${where}`,
    p.values,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    reportId: r.report_id,
    branchId: r.branch_id,
    branchCode: r.code,
    branchName: r.name,
    weekStart: r.week_start,
    status: r.status,
    liveAmount: r.live_amount,
    liveCount: r.live_count,
    frozenAmount: r.frozen_amount,
    frozenCount: r.frozen_count,
    submittedAt: iso(r.submitted_at),
    reviewedAt: iso(r.reviewed_at),
  };
}

/** Every money figure per PKT month of collected_on; only months that have rows. */
export async function selectTrend(
  db: Queryable,
  scope: Scope,
  f: ReportingFilters,
): Promise<TrendRow[]> {
  const p = new Params();
  const where = kpiWhere(p, scope, { from: f.from, to: f.to, branch: f.branch }, null);
  const series: [keyof Omit<TrendRow, 'month'>, MoneyFigureId][] = [
    ['collected', 'collected'],
    ['approved', 'approved'],
    ['pendingApproval', 'pending_approval'],
    ['inProgress', 'in_progress'],
    ['notYetRouted', 'not_yet_routed'],
    ['routed', 'routed'],
  ];
  const columns = series.map(([key, id]) => `${SUM_WHERE(figurePredicate(id))} AS "${key}"`);
  const { rows } = await db.query<TrendRow>(
    `SELECT k.month, ${columns.join(', ')}
       FROM v_kpi_collections k
      WHERE ${where}
      GROUP BY k.month
      ORDER BY k.month`,
    p.values,
  );
  return rows.map((r) => ({
    month: r.month,
    collected: r.collected,
    approved: r.approved,
    pendingApproval: r.pendingApproval,
    inProgress: r.inProgress,
    notYetRouted: r.notYetRouted,
    routed: r.routed,
  }));
}

type ListRow = {
  collection_id: string;
  branch_id: string;
  code: string;
  name: string;
  report_id: string;
  week_start: string;
  collected_on: string;
  purpose: string;
  amount: string;
  approved_at: Date;
};

function mapListRow(r: ListRow): UnroutedRepoRow {
  return {
    collectionId: r.collection_id,
    branchId: r.branch_id,
    branchCode: r.code,
    branchName: r.name,
    reportId: r.report_id,
    weekStart: r.week_start,
    collectedOn: r.collected_on,
    purpose: r.purpose,
    amount: r.amount,
    approvedAt: r.approved_at.toISOString(),
  };
}

// An approved report always has reviewed_at (set on approve); updated_at only guards
// against a row written outside the services.
const LIST_COLUMNS = `k.collection_id, k.branch_id, b.code, b.name, k.report_id,
  k.week_start::text AS week_start, k.collected_on::text AS collected_on, c.purpose, k.amount::text AS amount,
  COALESCE(r.reviewed_at, r.updated_at) AS approved_at`;
const LIST_JOINS = `JOIN branches b ON b.id = k.branch_id
  JOIN collections c ON c.id = k.collection_id
  JOIN weekly_reports r ON r.id = k.report_id`;

/** Approved, active, unrouted collections, oldest approval first. */
export async function selectUnrouted(
  db: Queryable,
  scope: Scope,
  f: ReportingFilters & PageQuery,
): Promise<{ rows: UnroutedRepoRow[]; total: number; totalAmount: string }> {
  const p = new Params();
  const where = kpiWhere(p, scope, { from: f.from, to: f.to, branch: f.branch }, 'not_yet_routed');
  const totals = await db.query<{ total: number; total_amount: string }>(
    `SELECT count(*)::int AS total, ${SUM('k.amount')} AS total_amount
       FROM v_kpi_collections k WHERE ${where}`,
    p.values,
  );
  const { limit, offset } = pageWindow(f);
  const n = p.values.length;
  const { rows } = await db.query<ListRow>(
    `SELECT ${LIST_COLUMNS}
       FROM v_kpi_collections k ${LIST_JOINS}
      WHERE ${where}
      ORDER BY approved_at ASC, k.collected_on ASC, k.collection_id ASC
      LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...p.values, limit, offset],
  );
  return {
    rows: rows.map(mapListRow),
    total: totals.rows[0]!.total,
    totalAmount: totals.rows[0]!.total_amount,
  };
}

/** Routed collections, most recently routed first, with the router's name. */
export async function selectRecentlyRouted(
  db: Queryable,
  scope: Scope,
  f: ReportingFilters & PageQuery,
): Promise<{ rows: RoutedRepoRow[]; total: number }> {
  const p = new Params();
  const where = kpiWhere(p, scope, { from: f.from, to: f.to, branch: f.branch }, 'routed');
  const totals = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM v_kpi_collections k WHERE ${where}`,
    p.values,
  );
  const { limit, offset } = pageWindow(f);
  const n = p.values.length;
  const { rows } = await db.query<ListRow & { routed_at: Date; routed_by_name: string | null }>(
    `SELECT ${LIST_COLUMNS}, k.routed_at, u.name AS routed_by_name
       FROM v_kpi_collections k ${LIST_JOINS}
       LEFT JOIN users u ON u.id = c.routed_by
      WHERE ${where}
      ORDER BY k.routed_at DESC, k.collection_id DESC
      LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...p.values, limit, offset],
  );
  return {
    rows: rows.map((r) => ({
      ...mapListRow(r),
      routedAt: r.routed_at.toISOString(),
      routedByName: r.routed_by_name,
    })),
    total: totals.rows[0]!.total,
  };
}
