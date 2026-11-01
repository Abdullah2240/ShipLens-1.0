import { scopeWhere, type Scope } from '@/platform/authz';
import type { ReportStatus } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import type { CollectionRecord } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RoutingTarget {
  id: string;
  branchId: string;
  reportId: string;
  status: CollectionRecord['status'];
  reportStatus: ReportStatus;
  routedAt: string | null;
}

/**
 * Row-locks the collection (not its report) for a routing change. Missing, malformed and
 * out-of-scope ids are the same NotFound. An approved report never changes status again,
 * so the report status read here stays valid until commit.
 */
export async function lockCollectionForRouting(
  tx: Queryable,
  scope: Scope,
  id: string,
): Promise<RoutingTarget> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'c.branch_id', 2);
  const { rows } = await tx.query<{
    id: string;
    branch_id: string;
    report_id: string;
    status: CollectionRecord['status'];
    report_status: ReportStatus;
    routed_at: Date | null;
  }>(
    `SELECT c.id, c.branch_id, c.report_id, c.status, r.status AS report_status, c.routed_at
       FROM collections c
       JOIN weekly_reports r ON r.id = c.report_id
      WHERE c.id = $1 AND ${where.sql}
      FOR UPDATE OF c`,
    [id, ...where.params],
  );
  const row = rows[0];
  if (!row) throw new NotFound();
  return {
    id: row.id,
    branchId: row.branch_id,
    reportId: row.report_id,
    status: row.status,
    reportStatus: row.report_status,
    routedAt: row.routed_at ? row.routed_at.toISOString() : null,
  };
}

/** Sets routed_at only while it is still empty; null means another writer got there first. */
export async function setRouted(
  tx: Queryable,
  id: string,
  at: Date,
  actorId: string,
): Promise<string | null> {
  const { rows } = await tx.query<{ routed_at: Date }>(
    `UPDATE collections SET routed_at = $2, routed_by = $3, updated_at = $2
      WHERE id = $1 AND routed_at IS NULL
      RETURNING routed_at`,
    [id, at, actorId],
  );
  return rows[0] ? rows[0].routed_at.toISOString() : null;
}

/** Clears routed_at only while it is set; false means there was nothing to clear. */
export async function clearRouted(tx: Queryable, id: string, at: Date): Promise<boolean> {
  const result = await tx.query(
    `UPDATE collections SET routed_at = NULL, routed_by = NULL, updated_at = $2
      WHERE id = $1 AND routed_at IS NOT NULL`,
    [id, at],
  );
  return (result.rowCount ?? 0) > 0;
}
