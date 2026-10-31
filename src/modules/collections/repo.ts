import { scopeWhere, type Scope } from '@/platform/authz';
import type { BranchStatus, ReportStatus } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import { sumMoney, type MoneyString } from '@/platform/money';
import type { DateString } from '@/platform/time';
import type { CollectionQuery, CollectionRecord } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: string;
  branch_id: string;
  branch_code: string;
  branch_name: string;
  branch_status: BranchStatus;
  report_id: string;
  report_status: ReportStatus;
  week_start: DateString;
  amount: MoneyString;
  collected_on: DateString;
  purpose: string;
  note: string | null;
  status: CollectionRecord['status'];
  void_reason: string | null;
  voided_at: Date | null;
  routed_at: Date | null;
  created_at: Date;
  created_by_name: string | null;
};

const FROM = `FROM collections c
  JOIN weekly_reports r ON r.id = c.report_id
  JOIN branches b ON b.id = c.branch_id
  LEFT JOIN users u ON u.id = c.created_by`;

const SELECT = `SELECT c.id, c.branch_id, b.code AS branch_code, b.name AS branch_name,
  b.status AS branch_status, c.report_id, r.status AS report_status, r.week_start,
  c.amount::text AS amount, c.collected_on, c.purpose, c.note, c.status, c.void_reason,
  c.voided_at, c.routed_at, c.created_at, u.name AS created_by_name
  ${FROM}`;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

function toRecord(row: Row): CollectionRecord {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    branchName: row.branch_name,
    branchStatus: row.branch_status,
    reportId: row.report_id,
    reportStatus: row.report_status,
    weekStart: row.week_start,
    amount: row.amount,
    collectedOn: row.collected_on,
    purpose: row.purpose,
    note: row.note,
    status: row.status,
    voidReason: row.void_reason,
    voidedAt: iso(row.voided_at),
    routedAt: iso(row.routed_at),
    createdAt: row.created_at.toISOString(),
    createdByName: row.created_by_name,
  };
}

function filters(scope: Scope, q: Omit<CollectionQuery, 'limit'>) {
  const where = scopeWhere(scope, 'c.branch_id', 1);
  const params: unknown[] = [...where.params];
  const clauses = [where.sql];
  const add = (column: string, value: unknown) => {
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  };
  if (q.branchId) add('c.branch_id', q.branchId);
  if (q.reportId) add('c.report_id', q.reportId);
  if (q.weekStart) add('r.week_start', q.weekStart);
  if (q.status) add('c.status', q.status);
  return { sql: clauses.join(' AND '), params };
}

export async function selectCollections(
  db: Queryable,
  scope: Scope,
  q: CollectionQuery,
): Promise<CollectionRecord[]> {
  const where = filters(scope, q);
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE ${where.sql}
     ORDER BY c.collected_on DESC, c.created_at DESC, c.id
     LIMIT $${where.params.length + 1}`,
    [...where.params, q.limit],
  );
  return rows.map(toRecord);
}

/** Row count and active sum over every row matching the filters (the limit does not apply). */
export async function countCollections(
  db: Queryable,
  scope: Scope,
  q: Omit<CollectionQuery, 'limit'>,
): Promise<{ total: number; activeAmount: MoneyString }> {
  const where = filters(scope, q);
  const { rows } = await db.query<{ total: number; active_amount: string }>(
    `SELECT count(*)::int AS total,
       COALESCE(sum(c.amount) FILTER (WHERE c.status = 'active'), 0)::text AS active_amount
     ${FROM} WHERE ${where.sql}`,
    where.params,
  );
  const row = rows[0];
  return { total: row?.total ?? 0, activeAmount: sumMoney([row?.active_amount ?? '0']) };
}

/** Missing, malformed and out-of-scope ids are the same NotFound. */
export async function selectCollectionById(
  db: Queryable,
  scope: Scope,
  id: string,
): Promise<CollectionRecord> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'c.branch_id', 2);
  const { rows } = await db.query<Row>(`${SELECT} WHERE c.id = $1 AND ${where.sql}`, [
    id,
    ...where.params,
  ]);
  if (!rows[0]) throw new NotFound();
  return toRecord(rows[0]);
}

/** Row-locks the collection (not its report or branch) and returns it. */
export async function lockCollection(
  tx: Queryable,
  scope: Scope,
  id: string,
): Promise<CollectionRecord> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'c.branch_id', 2);
  const { rows } = await tx.query<Row>(
    `${SELECT} WHERE c.id = $1 AND ${where.sql} FOR UPDATE OF c`,
    [id, ...where.params],
  );
  if (!rows[0]) throw new NotFound();
  return toRecord(rows[0]);
}

/** Holds the branch row against status changes until commit. */
export async function lockBranchForShare(
  tx: Queryable,
  branchId: string,
): Promise<BranchStatus | null> {
  const { rows } = await tx.query<{ status: BranchStatus }>(
    'SELECT status FROM branches WHERE id = $1 FOR SHARE',
    [branchId],
  );
  return rows[0]?.status ?? null;
}

/** Holds the report row against transitions until commit. */
export async function lockReportForShare(
  tx: Queryable,
  reportId: string,
): Promise<ReportStatus | null> {
  const { rows } = await tx.query<{ status: ReportStatus }>(
    'SELECT status FROM weekly_reports WHERE id = $1 FOR SHARE',
    [reportId],
  );
  return rows[0]?.status ?? null;
}

/**
 * The branch's report for the week, created as a draft when missing. Idempotent and safe
 * under concurrent calls: a racing insert waits on the unique key and then does nothing.
 */
export async function ensureDraftReport(
  tx: Queryable,
  branchId: string,
  weekStart: DateString,
): Promise<{ id: string; status: ReportStatus; created: boolean }> {
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, $2)
     ON CONFLICT (branch_id, week_start) DO NOTHING RETURNING id`,
    [branchId, weekStart],
  );
  const { rows } = await tx.query<{ id: string; status: ReportStatus }>(
    'SELECT id, status FROM weekly_reports WHERE branch_id = $1 AND week_start = $2 FOR SHARE',
    [branchId, weekStart],
  );
  const report = rows[0]!;
  return { id: report.id, status: report.status, created: inserted.rows.length > 0 };
}

export async function insertCollection(
  tx: Queryable,
  row: {
    branchId: string;
    reportId: string;
    amount: MoneyString;
    collectedOn: DateString;
    purpose: string;
    note: string | null;
    createdBy: string;
  },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO collections (branch_id, report_id, amount, collected_on, purpose, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [row.branchId, row.reportId, row.amount, row.collectedOn, row.purpose, row.note, row.createdBy],
  );
  return rows[0]!.id;
}

export type CollectionFieldChanges = {
  amount?: MoneyString;
  collectedOn?: DateString;
  purpose?: string;
  note?: string | null;
};

const COLUMNS = {
  amount: 'amount',
  collectedOn: 'collected_on',
  purpose: 'purpose',
  note: 'note',
} as const;

export async function updateCollectionFields(
  tx: Queryable,
  id: string,
  changes: CollectionFieldChanges,
): Promise<void> {
  const values: unknown[] = [id];
  const assignments: string[] = [];
  for (const key of Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]) {
    if (changes[key] === undefined) continue;
    values.push(changes[key]);
    assignments.push(`${COLUMNS[key]} = $${values.length}`);
  }
  if (assignments.length === 0) return;
  await tx.query(
    `UPDATE collections SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1`,
    values,
  );
}

export async function markVoided(
  tx: Queryable,
  id: string,
  input: { reason: string; voidedAt: Date; voidedBy: string },
): Promise<void> {
  await tx.query(
    `UPDATE collections
        SET status = 'voided', void_reason = $2, voided_at = $3, voided_by = $4, updated_at = now()
      WHERE id = $1 AND status = 'active'`,
    [id, input.reason, input.voidedAt, input.voidedBy],
  );
}

/** The branch status and its report for one week, with live active totals. Writes nothing. */
export async function selectCurrentWeek(
  db: Queryable,
  branchId: string,
  weekStart: DateString,
): Promise<{
  branchStatus: BranchStatus;
  reportId: string | null;
  reportStatus: ReportStatus | null;
  activeTotal: MoneyString;
  activeCount: number;
} | null> {
  const { rows } = await db.query<{
    branch_status: BranchStatus;
    report_id: string | null;
    report_status: ReportStatus | null;
    active_total: string;
    active_count: number;
  }>(
    `SELECT b.status AS branch_status, r.id AS report_id, r.status AS report_status,
       COALESCE((SELECT sum(c.amount) FROM collections c
                  WHERE c.report_id = r.id AND c.status = 'active'), 0)::text AS active_total,
       (SELECT count(*)::int FROM collections c
         WHERE c.report_id = r.id AND c.status = 'active') AS active_count
     FROM branches b
     LEFT JOIN weekly_reports r ON r.branch_id = b.id AND r.week_start = $2
     WHERE b.id = $1`,
    [branchId, weekStart],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    branchStatus: row.branch_status,
    reportId: row.report_id,
    reportStatus: row.report_status,
    activeTotal: sumMoney([row.active_total]),
    activeCount: row.active_count,
  };
}
