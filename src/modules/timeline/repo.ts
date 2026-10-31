import { scopeWhere, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMELINE_LIMIT = 500;

export type AuditTimelineRow = {
  id: string;
  occurredAt: string;
  requestId: string | null;
  actorName: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

type RawRow = {
  id: string;
  occurred_at: Date;
  request_id: string | null;
  actor_name: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

async function findBranch(
  db: Queryable,
  scope: Scope,
  table: 'weekly_reports' | 'collections',
  id: string,
): Promise<string> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'branch_id', 2);
  const { rows } = await db.query<{ branch_id: string }>(
    `SELECT branch_id FROM ${table} WHERE id = $1 AND ${where.sql}`,
    [id, ...where.params],
  );
  const row = rows[0];
  if (!row) throw new NotFound();
  return row.branch_id;
}

/** Branch of a report visible under the scope; missing, malformed and out of scope are NotFound. */
export function findReportBranch(db: Queryable, scope: Scope, id: string): Promise<string> {
  return findBranch(db, scope, 'weekly_reports', id);
}

/** Branch of a collection visible under the scope; missing, malformed and out of scope are NotFound. */
export function findCollectionBranch(db: Queryable, scope: Scope, id: string): Promise<string> {
  return findBranch(db, scope, 'collections', id);
}

const SELECT_AUDIT = `SELECT a.id::text AS id, a.occurred_at, a.request_id, u.name AS actor_name,
    a.actor_role, a.action, a.entity_type, a.entity_id, a.before, a.after
  FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id`;

const toRow = (row: RawRow): AuditTimelineRow => ({
  id: row.id,
  occurredAt: row.occurred_at.toISOString(),
  requestId: row.request_id,
  actorName: row.actor_name,
  actorRole: row.actor_role,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  before: row.before,
  after: row.after,
});

/** Every audit row carrying the report id: the report's own events and its collections'. */
export async function selectAuditByReport(
  db: Queryable,
  reportId: string,
): Promise<AuditTimelineRow[]> {
  const { rows } = await db.query<RawRow>(
    `${SELECT_AUDIT} WHERE a.report_id = $1 ORDER BY a.occurred_at, a.id LIMIT ${TIMELINE_LIMIT}`,
    [reportId],
  );
  return rows.map(toRow);
}

export async function selectAuditByCollection(
  db: Queryable,
  collectionId: string,
): Promise<AuditTimelineRow[]> {
  const { rows } = await db.query<RawRow>(
    `${SELECT_AUDIT} WHERE a.entity_type = 'collection' AND a.entity_id = $1
     ORDER BY a.occurred_at, a.id LIMIT ${TIMELINE_LIMIT}`,
    [collectionId],
  );
  return rows.map(toRow);
}
