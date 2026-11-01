// Verification queries.
//
// Two kinds of caller:
// - The public lookup has no actor and therefore no Scope. It is safe without one because it
//   only ever returns the public projection of an APPROVED report found by its code: branch
//   name and city, week, frozen totals and approval time. No person, user id, note, purpose,
//   return reason or collection line is selected, so none can leak.
// - The authorised lookup receives the Scope from authorize() and narrows by branch with
//   scopeWhere; another branch's report is the same NotFound as a missing one.
// The audit queries read only chain positions, hashes and the frozen report figures of the
// report's own events.
import { scopeWhere, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import { APPROVAL_AUDIT_ACTION, TOTALS_AUDIT_ACTIONS } from './config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicReportRow {
  code: string;
  report_id: string;
  branch_name: string;
  branch_city: string | null;
  week_start: string;
  total_amount: string | null;
  collection_count: number | null;
  reviewed_at: Date | null;
}

export interface ApprovalAnchorRow {
  id: string;
  chain_seq: string;
  hash: string;
  status: string | null;
}

export interface TotalsEvidenceRow {
  /** Submit or resubmit events before the anchor; 0 means the report is unanchored. */
  submit_events: number;
  total_amount: string | null;
  collection_count: string | null;
}

/** The public projection of an approved report by its stored (normalised) code. */
export async function selectPublicByCode(
  db: Queryable,
  code: string,
): Promise<PublicReportRow | null> {
  const { rows } = await db.query<PublicReportRow>(
    `SELECT v.code,
            r.id::text AS report_id,
            b.name AS branch_name,
            b.city AS branch_city,
            r.week_start::text AS week_start,
            r.total_amount::text AS total_amount,
            r.collection_count,
            r.reviewed_at
       FROM report_verifications v
       JOIN weekly_reports r ON r.id = v.report_id AND r.status = 'approved'
       JOIN branches b ON b.id = r.branch_id
      WHERE v.code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

/** The latest approval audit event of the report: the anchor and source of the seal. */
export async function selectApprovalAnchor(
  db: Queryable,
  reportId: string,
): Promise<ApprovalAnchorRow | null> {
  const { rows } = await db.query<ApprovalAnchorRow>(
    `SELECT id::text, chain_seq::text, hash, after->>'status' AS status
       FROM audit_events
      WHERE entity_type = 'report' AND entity_id = $1 AND action = $2
      ORDER BY audit_events.chain_seq DESC
      LIMIT 1`,
    [reportId, APPROVAL_AUDIT_ACTION],
  );
  return rows[0] ?? null;
}

/**
 * The totals frozen at submission, from the events before the anchor. Snapshots hold
 * changed fields only, so a resubmit with unchanged totals records neither; each field is
 * read from the latest submit or resubmit event that records it.
 */
export async function selectTotalsEvidence(
  db: Queryable,
  reportId: string,
  beforeSeq: string,
): Promise<TotalsEvidenceRow> {
  const events = `FROM audit_events
      WHERE entity_type = 'report' AND entity_id = $1 AND action = ANY($2::text[])
        AND audit_events.chain_seq < $3::bigint`;
  const { rows } = await db.query<TotalsEvidenceRow>(
    `SELECT (SELECT count(*)::int ${events}) AS submit_events,
            (SELECT after->>'total_amount' ${events} AND after ? 'total_amount'
              ORDER BY audit_events.chain_seq DESC LIMIT 1) AS total_amount,
            (SELECT after->>'collection_count' ${events} AND after ? 'collection_count'
              ORDER BY audit_events.chain_seq DESC LIMIT 1) AS collection_count`,
    [reportId, [...TOTALS_AUDIT_ACTIONS], beforeSeq],
  );
  return rows[0]!;
}

/** The code of an approved report in scope; anything else is the same NotFound. */
export async function selectCodeForReport(
  db: Queryable,
  scope: Scope,
  reportId: string,
): Promise<string> {
  // A malformed id cannot exist, so it gets the same answer as any other missing record.
  if (!UUID.test(reportId)) throw new NotFound();
  const where = scopeWhere(scope, 'r.branch_id', 2);
  const { rows } = await db.query<{ code: string }>(
    `SELECT v.code
       FROM weekly_reports r
       JOIN report_verifications v ON v.report_id = r.id
      WHERE r.id = $1 AND r.status = 'approved' AND ${where.sql}`,
    [reportId, ...where.params],
  );
  if (!rows[0]) throw new NotFound();
  return rows[0].code;
}
