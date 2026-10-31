// Drill-down queries that repo-kpi.ts does not already provide. Figure membership always
// reads v_kpi_collections or v_report_figures with the same predicates and filters as the
// canonical queries, so a level can never show a row its parent did not count.
import { scopeWhere, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import { isUuid, monthBounds } from './filters';
import { figurePredicate } from './repo-kpi';
import type { BranchHeader, CollectionDetail, ReportEventRow } from './trace-types';
import type { MoneyFigureId, ReportingFilters } from './types';

/** Positional parameter collector, same contract as the one in repo-kpi.ts. */
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

/** Month bounds on `column`, AND-ed; empty list when unbounded. */
function monthWhere(p: Params, f: ReportingFilters, column: string): string[] {
  const { fromDate, toDate } = monthBounds(f);
  const parts: string[] = [];
  if (fromDate) parts.push(`${column} >= ${p.add(fromDate, 'date')}`);
  if (toDate) parts.push(`${column} <= ${p.add(toDate, 'date')}`);
  return parts;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

type BranchRaw = { id: string; code: string; name: string; status: string; city: string | null };

const toBranchHeader = (r: BranchRaw): BranchHeader => ({
  branchId: r.id,
  branchCode: r.code,
  branchName: r.name,
  branchStatus: r.status,
  city: r.city,
});

/** One branch in scope; malformed, missing and out of scope are the same NotFound. */
export async function selectBranchHeader(
  db: Queryable,
  scope: Scope,
  id: string,
): Promise<BranchHeader> {
  if (!isUuid(id)) throw new NotFound();
  const p = new Params();
  const idParam = p.add(id.toLowerCase(), 'uuid');
  const where = p.scope(scope, 'b.id');
  const { rows } = await db.query<BranchRaw>(
    `SELECT b.id, b.code, b.name, b.status, b.city FROM branches b
      WHERE b.id = ${idParam} AND ${where}`,
    p.values,
  );
  const row = rows[0];
  if (!row) throw new NotFound();
  return toBranchHeader(row);
}

/** Branches in scope by id; ids that are malformed, missing or out of scope are absent. */
export async function selectBranchHeaders(
  db: Queryable,
  scope: Scope,
  ids: readonly string[],
): Promise<Map<string, BranchHeader>> {
  const valid = [...new Set(ids.filter(isUuid).map((id) => id.toLowerCase()))];
  if (valid.length === 0) return new Map();
  const p = new Params();
  const idsParam = p.add(valid, 'uuid[]');
  const where = p.scope(scope, 'b.id');
  const { rows } = await db.query<BranchRaw>(
    `SELECT b.id, b.code, b.name, b.status, b.city FROM branches b
      WHERE b.id = ANY(${idsParam}) AND ${where}`,
    p.values,
  );
  return new Map(rows.map((r) => [r.id, toBranchHeader(r)]));
}

export interface SubmittedReportRow {
  reportId: string;
  weekStart: string;
  status: string;
  liveAmount: string;
  liveCount: number;
  frozenAmount: string | null;
  frozenCount: number | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

/**
 * Submitted reports of one branch: the rows behind reports_awaiting_review. Same source
 * and filters as its count (v_report_figures, status submitted, month filter on
 * week_start), newest week first.
 */
export async function selectSubmittedReports(
  db: Queryable,
  scope: Scope,
  f: ReportingFilters & { branchId: string },
): Promise<SubmittedReportRow[]> {
  if (!isUuid(f.branchId)) return [];
  const p = new Params();
  const parts = [
    `rf.status = 'submitted'`,
    p.scope(scope, 'rf.branch_id'),
    ...monthWhere(p, f, 'rf.week_start'),
    `rf.branch_id = ${p.add(f.branchId.toLowerCase(), 'uuid')}`,
  ];
  const { rows } = await db.query<{
    report_id: string;
    week_start: string;
    status: string;
    live_amount: string;
    live_count: number;
    frozen_amount: string | null;
    frozen_count: number | null;
    submitted_at: Date | null;
    reviewed_at: Date | null;
  }>(
    `SELECT rf.report_id, rf.week_start::text AS week_start, rf.status,
            rf.live_amount::text AS live_amount, rf.live_count,
            rf.frozen_amount::text AS frozen_amount, rf.frozen_count,
            rf.submitted_at, rf.reviewed_at
       FROM v_report_figures rf
      WHERE ${parts.join(' AND ')}
      ORDER BY rf.week_start DESC, rf.report_id`,
    p.values,
  );
  return rows.map((r) => ({
    reportId: r.report_id,
    weekStart: r.week_start,
    status: r.status,
    liveAmount: r.live_amount,
    liveCount: r.live_count,
    frozenAmount: r.frozen_amount,
    frozenCount: r.frozen_count,
    submittedAt: iso(r.submitted_at),
    reviewedAt: iso(r.reviewed_at),
  }));
}

/**
 * True when the collection is one of the rows the money figure sums for this branch,
 * report and month filter: the same view, predicate and bounds as selectFigureCollections.
 */
export async function collectionContributes(
  db: Queryable,
  scope: Scope,
  figure: MoneyFigureId,
  f: ReportingFilters & { branchId: string; reportId: string; collectionId: string },
): Promise<boolean> {
  if (!isUuid(f.branchId) || !isUuid(f.reportId) || !isUuid(f.collectionId)) return false;
  const p = new Params();
  const parts = [
    figurePredicate(figure),
    p.scope(scope, 'k.branch_id'),
    ...monthWhere(p, f, 'k.collected_on'),
    `k.branch_id = ${p.add(f.branchId.toLowerCase(), 'uuid')}`,
    `k.report_id = ${p.add(f.reportId.toLowerCase(), 'uuid')}`,
    `k.collection_id = ${p.add(f.collectionId.toLowerCase(), 'uuid')}`,
  ];
  const { rows } = await db.query<{ hit: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM v_kpi_collections k WHERE ${parts.join(' AND ')}) AS hit`,
    p.values,
  );
  return rows[0]?.hit === true;
}

/** Submitter and reviewer names and the return reason of a report; null when missing. */
export async function selectReportHeaderPeople(
  db: Queryable,
  reportId: string,
): Promise<{
  submittedByName: string | null;
  reviewedByName: string | null;
  returnReason: string | null;
} | null> {
  if (!isUuid(reportId)) return null;
  const { rows } = await db.query<{
    submitted_by_name: string | null;
    reviewed_by_name: string | null;
    return_reason: string | null;
  }>(
    `SELECT su.name AS submitted_by_name, ru.name AS reviewed_by_name, r.return_reason
       FROM weekly_reports r
       LEFT JOIN users su ON su.id = r.submitted_by
       LEFT JOIN users ru ON ru.id = r.reviewed_by
      WHERE r.id = $1::uuid`,
    [reportId.toLowerCase()],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    submittedByName: r.submitted_by_name,
    reviewedByName: r.reviewed_by_name,
    returnReason: r.return_reason,
  };
}

/** Status changes of a report in the order they happened (by id). */
export async function selectReportEvents(
  db: Queryable,
  reportId: string,
): Promise<ReportEventRow[]> {
  if (!isUuid(reportId)) return [];
  const { rows } = await db.query<{
    id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    actor_name: string | null;
    reason: string | null;
    occurred_at: Date;
  }>(
    `SELECT e.id::text AS id, e.event_type, e.from_status, e.to_status, u.name AS actor_name,
            e.reason, e.occurred_at
       FROM report_events e
       LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.report_id = $1::uuid
      ORDER BY e.id`,
    [reportId.toLowerCase()],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.event_type,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    actorName: r.actor_name,
    reason: r.reason,
    occurredAt: r.occurred_at.toISOString(),
  }));
}

/** One collection in scope with the names behind it; null when malformed, missing or out of scope. */
export async function selectCollectionDetail(
  db: Queryable,
  scope: Scope,
  id: string,
): Promise<(CollectionDetail & { branchId: string; reportId: string }) | null> {
  if (!isUuid(id)) return null;
  const p = new Params();
  const idParam = p.add(id.toLowerCase(), 'uuid');
  const where = p.scope(scope, 'c.branch_id');
  const { rows } = await db.query<{
    id: string;
    branch_id: string;
    report_id: string;
    amount: string;
    collected_on: string;
    purpose: string;
    status: string;
    void_reason: string | null;
    routed_at: Date | null;
    routed_by_name: string | null;
    created_at: Date;
    created_by_name: string | null;
  }>(
    `SELECT c.id, c.branch_id, c.report_id, c.amount::text AS amount,
            c.collected_on::text AS collected_on, c.purpose, c.status, c.void_reason,
            c.routed_at, ru.name AS routed_by_name, c.created_at, cu.name AS created_by_name
       FROM collections c
       LEFT JOIN users ru ON ru.id = c.routed_by
       LEFT JOIN users cu ON cu.id = c.created_by
      WHERE c.id = ${idParam} AND ${where}`,
    p.values,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    collectionId: r.id,
    branchId: r.branch_id,
    reportId: r.report_id,
    amount: r.amount,
    collectedOn: r.collected_on,
    purpose: r.purpose,
    status: r.status,
    voidReason: r.void_reason,
    routedAt: iso(r.routed_at),
    routedByName: r.routed_by_name,
    createdAt: r.created_at.toISOString(),
    createdByName: r.created_by_name,
  };
}
