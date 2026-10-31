import { scopeWhere, type Scope } from '@/platform/authz';
import type { ApplicationStatus } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import type { ApplicationDetail, ApplicationListItem, ApplicationListQuery } from './review-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ListRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  branch_id: string;
  branch_name: string;
  status: ApplicationStatus;
  created_at: Date;
  decided_at: Date | null;
};
type DetailRow = ListRow & {
  message: string | null;
  decision_note: string | null;
  decided_by_name: string | null;
  member_id: string | null;
  member_code: string | null;
};

function mapListItem(row: ListRow): ApplicationListItem {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    branchId: row.branch_id,
    branchName: row.branch_name,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
  };
}

function mapDetail(row: DetailRow): ApplicationDetail {
  return {
    ...mapListItem(row),
    message: row.message,
    decisionNote: row.decision_note,
    decidedByName: row.decided_by_name,
    memberId: row.member_id,
    memberCode: row.member_code,
  };
}

function listFilter(scope: Scope, q: Pick<ApplicationListQuery, 'status'>) {
  const where = scopeWhere(scope, 'a.branch_id', 1);
  const params: unknown[] = [...where.params];
  let sql = where.sql;
  if (q.status) {
    params.push(q.status);
    sql += ` AND a.status = $${params.length}`;
  }
  return { sql, params };
}

export async function selectApplications(
  db: Queryable,
  scope: Scope,
  q: ApplicationListQuery,
): Promise<ApplicationListItem[]> {
  const filter = listFilter(scope, q);
  const n = filter.params.length;
  const { rows } = await db.query<ListRow>(
    `SELECT a.id, a.full_name, a.email, a.phone, a.branch_id, b.name AS branch_name, a.status,
            a.created_at, a.decided_at
       FROM applications a JOIN branches b ON b.id = a.branch_id
      WHERE ${filter.sql}
      ORDER BY a.created_at DESC, a.id
      LIMIT $${n + 1} OFFSET $${n + 2}`,
    [...filter.params, q.pageSize, (q.page - 1) * q.pageSize],
  );
  return rows.map(mapListItem);
}

export async function countApplications(
  db: Queryable,
  scope: Scope,
  q: Pick<ApplicationListQuery, 'status'>,
): Promise<number> {
  const filter = listFilter(scope, q);
  const { rows } = await db.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM applications a WHERE ${filter.sql}`,
    filter.params,
  );
  return rows[0]?.total ?? 0;
}

export async function selectApplicationById(
  db: Queryable,
  scope: Scope,
  id: string,
): Promise<ApplicationDetail> {
  // A malformed id cannot exist, so it gets the same answer as any other missing record.
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'a.branch_id', 2);
  const { rows } = await db.query<DetailRow>(
    `SELECT a.id, a.full_name, a.email, a.phone, a.branch_id, b.name AS branch_name, a.status,
            a.created_at, a.decided_at, a.message, a.decision_note, u.name AS decided_by_name,
            m.id AS member_id, m.member_code
       FROM applications a
       JOIN branches b ON b.id = a.branch_id
       LEFT JOIN users u ON u.id = a.decided_by
       LEFT JOIN members m ON m.application_id = a.id
      WHERE a.id = $1 AND ${where.sql}`,
    [id, ...where.params],
  );
  if (!rows[0]) throw new NotFound();
  return mapDetail(rows[0]);
}

export type LockedApplication = {
  id: string;
  branch_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: ApplicationStatus;
  decision_note: string | null;
};

/** Locks the application row for the rest of the transaction. Missing and out of scope are the same NotFound. */
export async function lockApplication(
  tx: Queryable,
  scope: Scope,
  id: string,
): Promise<LockedApplication> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'a.branch_id', 2);
  const { rows } = await tx.query<LockedApplication>(
    `SELECT a.id, a.branch_id, a.full_name, a.email, a.phone, a.status, a.decision_note
       FROM applications a
      WHERE a.id = $1 AND ${where.sql}
        FOR UPDATE OF a`,
    [id, ...where.params],
  );
  if (!rows[0]) throw new NotFound();
  return rows[0];
}

export async function nextMemberSequence(tx: Queryable): Promise<string> {
  const { rows } = await tx.query<{ n: string }>("SELECT nextval('member_id_seq')::text AS n");
  return rows[0]!.n;
}

export type InsertedMember = {
  id: string;
  member_code: string;
  branch_id: string;
  member_role: string;
  status: string;
};

export async function insertMemberFromApplication(
  tx: Queryable,
  app: LockedApplication,
  memberCode: string,
  joinedOn: string,
): Promise<InsertedMember> {
  const { rows } = await tx.query<InsertedMember>(
    `INSERT INTO members (member_code, branch_id, application_id, full_name, email, phone, joined_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, member_code, branch_id, member_role, status`,
    [memberCode, app.branch_id, app.id, app.full_name, app.email, app.phone, joinedOn],
  );
  return rows[0]!;
}

export async function markApplicationDecided(
  tx: Queryable,
  id: string,
  status: Exclude<ApplicationStatus, 'pending'>,
  actorId: string,
  decidedAt: Date,
  note: string | null,
): Promise<void> {
  await tx.query(
    `UPDATE applications
        SET status = $2, decided_by = $3, decided_at = $4, decision_note = $5
      WHERE id = $1 AND status = 'pending'`,
    [id, status, actorId, decidedAt, note],
  );
}
