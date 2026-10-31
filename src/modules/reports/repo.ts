import { scopeWhere, type Scope } from '@/platform/authz';
import type { BranchStatus, ReportStatus } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import { fromMinor, toMinor, type MoneyString } from '@/platform/money';
import type { DateString } from '@/platform/time';
import type { ReportCollectionRow, ReportEventItem, ReportEventType, ReportQuery } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A report row with its branch, user names and the live sum of its active collections. */
export interface ReportRecord {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  branchStatus: BranchStatus;
  weekStart: DateString;
  status: ReportStatus;
  totalAmount: MoneyString | null;
  collectionCount: number | null;
  liveAmount: MoneyString;
  liveCount: number;
  submittedAt: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  returnReason: string | null;
  version: number;
}

type RecordRow = {
  id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  branch_status: BranchStatus;
  week_start: string;
  status: ReportStatus;
  total_amount: string | null;
  collection_count: number | null;
  live_amount: string;
  live_count: number;
  submitted_at: Date | null;
  submitted_by: string | null;
  submitted_by_name: string | null;
  reviewed_at: Date | null;
  reviewed_by_name: string | null;
  return_reason: string | null;
  version: number;
};

// Live totals are summed from active collections with a lateral subquery; sum() on
// numeric(14,2) is exact and returned as text.
const RECORD_SELECT = `
  SELECT r.id, r.branch_id, b.code AS branch_code, b.name AS branch_name, b.status AS branch_status,
    r.week_start::text AS week_start, r.status, r.total_amount::text AS total_amount,
    r.collection_count, live.amount AS live_amount, live.count AS live_count,
    r.submitted_at, r.submitted_by, su.name AS submitted_by_name,
    r.reviewed_at, ru.name AS reviewed_by_name, r.return_reason, r.version
  FROM weekly_reports r
  JOIN branches b ON b.id = r.branch_id
  LEFT JOIN users su ON su.id = r.submitted_by
  LEFT JOIN users ru ON ru.id = r.reviewed_by
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(c.amount), 0)::text AS amount, count(*)::int AS count
    FROM collections c WHERE c.report_id = r.id AND c.status = 'active'
  ) live`;

const ORDER = `ORDER BY r.week_start DESC, lower(b.name), b.name, r.id`;

/** Canonical two-decimal money string from a SQL numeric text. */
const money = (value: string): MoneyString => fromMinor(toMinor(value));
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toRecord(row: RecordRow): ReportRecord {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    branchStatus: row.branch_status,
    weekStart: row.week_start,
    status: row.status,
    totalAmount: row.total_amount === null ? null : money(row.total_amount),
    collectionCount: row.collection_count,
    liveAmount: money(row.live_amount),
    liveCount: row.live_count,
    submittedAt: iso(row.submitted_at),
    submittedBy: row.submitted_by,
    submittedByName: row.submitted_by_name,
    reviewedAt: iso(row.reviewed_at),
    reviewedByName: row.reviewed_by_name,
    returnReason: row.return_reason,
    version: row.version,
  };
}

function listFilter(scope: Scope, q: Omit<ReportQuery, 'limit'>) {
  const where = scopeWhere(scope, 'r.branch_id', 1);
  const params = [...where.params];
  const parts = [where.sql];
  if (q.status) {
    params.push(q.status);
    parts.push(`r.status = $${params.length}`);
  }
  if (q.branchId) {
    params.push(q.branchId);
    parts.push(`r.branch_id = $${params.length}::uuid`);
  }
  if (q.weekStart) {
    params.push(q.weekStart);
    parts.push(`r.week_start = $${params.length}::date`);
  }
  return { sql: parts.join(' AND '), params };
}

export async function selectReports(
  db: Queryable,
  scope: Scope,
  q: ReportQuery,
): Promise<ReportRecord[]> {
  const filter = listFilter(scope, q);
  const params = [...filter.params, q.limit];
  const { rows } = await db.query<RecordRow>(
    `${RECORD_SELECT} WHERE ${filter.sql} ${ORDER} LIMIT $${params.length}`,
    params,
  );
  return rows.map(toRecord);
}

export async function countReports(
  db: Queryable,
  scope: Scope,
  q: Omit<ReportQuery, 'limit'>,
): Promise<number> {
  const filter = listFilter(scope, q);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM weekly_reports r WHERE ${filter.sql}`,
    filter.params,
  );
  return rows[0]?.n ?? 0;
}

/** Submitted reports of every branch, oldest submission first. */
export async function selectReviewQueue(db: Queryable): Promise<ReportRecord[]> {
  const { rows } = await db.query<RecordRow>(
    `${RECORD_SELECT} WHERE r.status = 'submitted' ORDER BY r.submitted_at, r.id`,
  );
  return rows.map(toRecord);
}

/** Missing, malformed and out-of-scope ids are the same NotFound. */
export async function selectReportDetail(
  db: Queryable,
  scope: Scope,
  id: string,
): Promise<ReportRecord> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'r.branch_id', 2);
  const { rows } = await db.query<RecordRow>(`${RECORD_SELECT} WHERE r.id = $1 AND ${where.sql}`, [
    id,
    ...where.params,
  ]);
  if (!rows[0]) throw new NotFound();
  return toRecord(rows[0]);
}

export async function selectReportCollections(
  db: Queryable,
  reportId: string,
): Promise<ReportCollectionRow[]> {
  const { rows } = await db.query<{
    id: string;
    collected_on: string;
    amount: string;
    purpose: string;
    status: 'active' | 'voided';
    void_reason: string | null;
    routed_at: Date | null;
    created_by_name: string | null;
  }>(
    `SELECT c.id, c.collected_on::text AS collected_on, c.amount::text AS amount, c.purpose,
       c.status, c.void_reason, c.routed_at, u.name AS created_by_name
     FROM collections c LEFT JOIN users u ON u.id = c.created_by
     WHERE c.report_id = $1
     ORDER BY c.collected_on, c.created_at, c.id`,
    [reportId],
  );
  return rows.map((row) => ({
    id: row.id,
    collectedOn: row.collected_on,
    amount: money(row.amount),
    purpose: row.purpose,
    status: row.status,
    voidReason: row.void_reason,
    routedAt: iso(row.routed_at),
    createdByName: row.created_by_name,
  }));
}

export async function selectReportEvents(
  db: Queryable,
  reportId: string,
): Promise<ReportEventItem[]> {
  const { rows } = await db.query<{
    id: string;
    event_type: ReportEventType;
    from_status: ReportStatus | null;
    to_status: ReportStatus | null;
    actor_name: string | null;
    reason: string | null;
    occurred_at: Date;
  }>(
    `SELECT e.id::text AS id, e.event_type, e.from_status, e.to_status, u.name AS actor_name,
       e.reason, e.occurred_at
     FROM report_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.report_id = $1 ORDER BY e.id`,
    [reportId],
  );
  return rows.map((row) => ({
    id: row.id,
    type: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorName: row.actor_name,
    reason: row.reason,
    occurredAt: row.occurred_at.toISOString(),
  }));
}

/** In-scope `active` branches that have no report for the week, in id order. */
export async function selectActiveBranchesMissingWeek(
  db: Queryable,
  scope: Scope,
  weekStart: DateString,
): Promise<string[]> {
  const where = scopeWhere(scope, 'b.id', 2);
  const { rows } = await db.query<{ id: string }>(
    `SELECT b.id FROM branches b
     WHERE b.status = 'active' AND ${where.sql}
       AND NOT EXISTS (
         SELECT 1 FROM weekly_reports r WHERE r.branch_id = b.id AND r.week_start = $1::date)
     ORDER BY b.id`,
    [weekStart, ...where.params],
  );
  return rows.map((row) => row.id);
}

/** Inserts the draft unless the branch already has a report for the week; returns the new id. */
export async function insertDraftIfMissing(
  tx: Queryable,
  branchId: string,
  weekStart: DateString,
): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, $2::date)
     ON CONFLICT (branch_id, week_start) DO NOTHING RETURNING id`,
    [branchId, weekStart],
  );
  return rows[0]?.id ?? null;
}

export interface LockedReport {
  id: string;
  branchId: string;
  status: ReportStatus;
  totalAmount: MoneyString | null;
  collectionCount: number | null;
  submittedBy: string | null;
  returnReason: string | null;
  version: number;
  branchStatus: BranchStatus;
}

/** Locks the report row under the scope for the rest of the transaction. */
export async function lockReport(tx: Queryable, scope: Scope, id: string): Promise<LockedReport> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'r.branch_id', 2);
  const { rows } = await tx.query<{
    id: string;
    branch_id: string;
    status: ReportStatus;
    total_amount: string | null;
    collection_count: number | null;
    submitted_by: string | null;
    return_reason: string | null;
    version: number;
    branch_status: BranchStatus;
  }>(
    `SELECT r.id, r.branch_id, r.status, r.total_amount::text AS total_amount, r.collection_count,
       r.submitted_by, r.return_reason, r.version, b.status AS branch_status
     FROM weekly_reports r JOIN branches b ON b.id = r.branch_id
     WHERE r.id = $1 AND ${where.sql}
     FOR UPDATE OF r`,
    [id, ...where.params],
  );
  const row = rows[0];
  if (!row) throw new NotFound();
  return {
    id: row.id,
    branchId: row.branch_id,
    status: row.status,
    totalAmount: row.total_amount === null ? null : money(row.total_amount),
    collectionCount: row.collection_count,
    submittedBy: row.submitted_by,
    returnReason: row.return_reason,
    version: row.version,
    branchStatus: row.branch_status,
  };
}

export async function liveTotals(
  tx: Queryable,
  reportId: string,
): Promise<{ amount: MoneyString; count: number }> {
  const { rows } = await tx.query<{ amount: string; count: number }>(
    `SELECT coalesce(sum(amount), 0)::text AS amount, count(*)::int AS count
     FROM collections WHERE report_id = $1 AND status = 'active'`,
    [reportId],
  );
  return { amount: money(rows[0]!.amount), count: rows[0]!.count };
}

export interface TransitionSet {
  status: ReportStatus;
  totalAmount?: MoneyString;
  collectionCount?: number;
  submittedAt?: Date;
  submittedBy?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  returnReason?: string;
}

const SET_COLUMNS: readonly [keyof TransitionSet, string][] = [
  ['status', 'status'],
  ['totalAmount', 'total_amount'],
  ['collectionCount', 'collection_count'],
  ['submittedAt', 'submitted_at'],
  ['submittedBy', 'submitted_by'],
  ['reviewedAt', 'reviewed_at'],
  ['reviewedBy', 'reviewed_by'],
  ['returnReason', 'return_reason'],
];

/**
 * Conditional status move: changes the row only while it is still in `from` and in scope.
 * Bumps the version. Returns the new version, or null when no row matched.
 */
export async function applyTransition(
  tx: Queryable,
  scope: Scope,
  id: string,
  from: ReportStatus,
  set: TransitionSet,
): Promise<{ version: number } | null> {
  const values: unknown[] = [id, from];
  const assignments: string[] = [];
  for (const [key, column] of SET_COLUMNS) {
    if (set[key] === undefined) continue;
    values.push(set[key]);
    assignments.push(`${column} = $${values.length}`);
  }
  const where = scopeWhere(scope, 'branch_id', values.length + 1);
  const { rows } = await tx.query<{ version: number }>(
    `UPDATE weekly_reports
        SET ${assignments.join(', ')}, version = version + 1, updated_at = now()
      WHERE id = $1 AND status = $2 AND ${where.sql}
      RETURNING version`,
    [...values, ...where.params],
  );
  return rows[0] ?? null;
}

export async function insertReportEvent(
  tx: Queryable,
  event: {
    reportId: string;
    type: ReportEventType;
    fromStatus: ReportStatus;
    toStatus: ReportStatus;
    actorId: string;
    reason: string | null;
    occurredAt: Date;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO report_events (report_id, event_type, from_status, to_status, actor_id, reason, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      event.reportId,
      event.type,
      event.fromStatus,
      event.toStatus,
      event.actorId,
      event.reason,
      event.occurredAt,
    ],
  );
}
