import { scopeWhere, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import type { AuditFacets, AuditListItem, AuditQuery } from './types';

const FACET_LIMIT = 500;
const PKT = `'Asia/Karachi'`;

type RawRow = {
  id: string;
  occurred_at: Date;
  request_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  branch_code: string | null;
  report_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

const toItem = (row: RawRow): AuditListItem => ({
  id: row.id,
  occurredAt: row.occurred_at.toISOString(),
  requestId: row.request_id,
  actorId: row.actor_id,
  actorName: row.actor_name,
  actorRole: row.actor_role,
  action: row.action,
  entityType: row.entity_type,
  entityId: row.entity_id,
  branchId: row.branch_id,
  branchCode: row.branch_code,
  reportId: row.report_id,
  before: row.before,
  after: row.after,
});

/** Parameterised WHERE builder: every value goes through a placeholder. */
class Where {
  readonly parts: string[] = [];
  readonly params: unknown[] = [];

  add(build: (placeholder: string) => string, value: unknown): void {
    this.params.push(value);
    this.parts.push(build(`$${this.params.length}`));
  }

  scope(scope: Scope, column: string): void {
    const clause = scopeWhere(scope, column, this.params.length + 1);
    this.params.push(...clause.params);
    this.parts.push(clause.sql);
  }

  restrict(entityTypes: readonly string[] | null): void {
    if (entityTypes) this.add((p) => `a.entity_type = ANY(${p}::text[])`, [...entityTypes]);
  }

  sql(): string {
    return this.parts.length ? this.parts.join(' AND ') : 'TRUE';
  }
}

/** Newest first by id, one extra row beyond the limit to decide whether another page exists. */
export async function selectAuditEvents(
  db: Queryable,
  scope: Scope,
  q: AuditQuery & { entityTypes: readonly string[] | null },
): Promise<{ items: AuditListItem[]; hasMore: boolean }> {
  const w = new Where();
  w.scope(scope, 'a.branch_id');
  w.restrict(q.entityTypes);
  if (q.from) {
    w.add((p) => `a.occurred_at >= ((${p}::date)::timestamp AT TIME ZONE ${PKT})`, q.from);
  }
  if (q.to) {
    w.add((p) => `a.occurred_at < ((${p}::date + 1)::timestamp AT TIME ZONE ${PKT})`, q.to);
  }
  if (q.actor) w.add((p) => `a.actor_id = ${p}::uuid`, q.actor);
  if (q.action) w.add((p) => `a.action = ${p}`, q.action);
  if (q.entity) w.add((p) => `a.entity_type = ${p}`, q.entity);
  if (q.entityId) w.add((p) => `a.entity_id = ${p}`, q.entityId);
  if (q.branch) w.add((p) => `a.branch_id = ${p}::uuid`, q.branch);
  if (q.before) w.add((p) => `a.id < ${p}::bigint`, q.before);

  const limit = q.limit;
  const { rows } = await db.query<RawRow>(
    `SELECT a.id::text AS id, a.occurred_at, a.request_id, a.actor_id, u.name AS actor_name,
        a.actor_role, a.action, a.entity_type, a.entity_id, a.branch_id, b.code AS branch_code,
        a.report_id, a.before, a.after
     FROM audit_events a
     LEFT JOIN users u ON u.id = a.actor_id
     LEFT JOIN branches b ON b.id = a.branch_id
     WHERE ${w.sql()}
     ORDER BY a.id DESC
     LIMIT $${w.params.length + 1}`,
    [...w.params, limit + 1],
  );
  return { items: rows.slice(0, limit).map(toItem), hasMore: rows.length > limit };
}

/** Distinct actions, entity types, actors and branches visible under the restriction. */
export async function selectAuditFacets(
  db: Queryable,
  scope: Scope,
  entityTypes: readonly string[] | null,
): Promise<Omit<AuditFacets, 'restricted'>> {
  const w = new Where();
  w.scope(scope, 'a.branch_id');
  w.restrict(entityTypes);
  const where = w.sql();
  const params = w.params;

  const [actions, types, actors, branches] = await Promise.all([
    db.query<{ action: string }>(
      `SELECT DISTINCT a.action COLLATE "C" AS action FROM audit_events a WHERE ${where}
       ORDER BY 1 LIMIT ${FACET_LIMIT}`,
      params,
    ),
    db.query<{ entity_type: string }>(
      `SELECT DISTINCT a.entity_type COLLATE "C" AS entity_type FROM audit_events a WHERE ${where}
       ORDER BY 1 LIMIT ${FACET_LIMIT}`,
      params,
    ),
    db.query<{ id: string; name: string; role: string }>(
      `SELECT u.id, u.name, u.role FROM users u
       WHERE u.id IN (SELECT a.actor_id FROM audit_events a WHERE ${where} AND a.actor_id IS NOT NULL)
       ORDER BY u.name, u.id LIMIT ${FACET_LIMIT}`,
      params,
    ),
    db.query<{ id: string; code: string; name: string }>(
      `SELECT b.id, b.code, b.name FROM branches b
       WHERE b.id IN (SELECT a.branch_id FROM audit_events a WHERE ${where} AND a.branch_id IS NOT NULL)
       ORDER BY b.code COLLATE "C", b.id LIMIT ${FACET_LIMIT}`,
      params,
    ),
  ]);

  return {
    actions: actions.rows.map((r) => r.action),
    entityTypes: types.rows.map((r) => r.entity_type),
    actors: actors.rows.map((r) => ({ id: r.id, name: r.name, role: r.role })),
    branches: branches.rows.map((r) => ({ id: r.id, code: r.code, name: r.name })),
  };
}
