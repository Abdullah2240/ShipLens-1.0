// Share read model (WA-01). Selects only the columns a share may disclose: branch name and
// code, week, status, and the report total and count from v_report_figures. Never collection
// rows, purposes or people.
import { scopeWhere, type Scope } from '@/platform/authz';
import type { ReportStatus } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { isUuid } from './filters';

export interface ShareSummaryRow {
  reportId: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  weekStart: string;
  status: ReportStatus;
  amount: string;
  collectionCount: number;
  amountIsFrozen: boolean;
}

/**
 * The report's share summary inside the scope, or null when the report is missing, out of
 * scope or the id is not a UUID. Submitted and approved reports give their frozen total and
 * count; draft and returned reports give the live sum of active collections.
 */
export async function selectShareSummary(
  db: Queryable,
  scope: Scope,
  reportId: string,
): Promise<ShareSummaryRow | null> {
  if (!isUuid(reportId)) return null;
  const where = scopeWhere(scope, 'rf.branch_id', 2);
  const { rows } = await db.query<{
    report_id: string;
    branch_id: string;
    name: string;
    code: string;
    week_start: string;
    status: ReportStatus;
    amount: string;
    collection_count: number;
    is_frozen: boolean;
  }>(
    `SELECT rf.report_id, rf.branch_id, b.name, b.code, rf.week_start::text AS week_start,
            rf.status, f.is_frozen,
            (CASE WHEN f.is_frozen THEN rf.frozen_amount ELSE rf.live_amount END)::text AS amount,
            (CASE WHEN f.is_frozen THEN rf.frozen_count ELSE rf.live_count END)::integer
              AS collection_count
       FROM v_report_figures rf
       JOIN branches b ON b.id = rf.branch_id
      CROSS JOIN LATERAL (
        SELECT rf.status IN ('submitted', 'approved')
               AND rf.frozen_amount IS NOT NULL AND rf.frozen_count IS NOT NULL AS is_frozen
      ) f
      WHERE rf.report_id = $1::uuid AND ${where.sql}`,
    [reportId.toLowerCase(), ...where.params],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    reportId: r.report_id,
    branchId: r.branch_id,
    branchName: r.name,
    branchCode: r.code,
    weekStart: r.week_start,
    status: r.status,
    amount: r.amount,
    collectionCount: r.collection_count,
    amountIsFrozen: r.is_frozen,
  };
}

/** The report id when the report exists inside the scope, else null. */
export async function selectScopedReportId(
  db: Queryable,
  scope: Scope,
  reportId: string,
): Promise<string | null> {
  if (!isUuid(reportId)) return null;
  const where = scopeWhere(scope, 'r.branch_id', 2);
  const { rows } = await db.query<{ id: string }>(
    `SELECT r.id FROM weekly_reports r WHERE r.id = $1::uuid AND ${where.sql}`,
    [reportId.toLowerCase(), ...where.params],
  );
  return rows[0]?.id ?? null;
}
