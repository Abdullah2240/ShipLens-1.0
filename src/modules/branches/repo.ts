import { scopeWhere, type Scope } from '@/platform/authz';
import type { BranchStatus } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import { BRANCH_TRANSITIONS } from './transitions';
import type { BranchDetail, BranchLead, BranchListItem, LeadCandidate, LeadRole } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Active users holding a branch role on the branch.
const LEAD_FILTER = `u.is_active AND u.role IN ('branch_lead', 'hr_lead')`;
const LEAD_COUNT = `(SELECT count(*)::int FROM users u WHERE u.branch_id = b.id AND ${LEAD_FILTER})`;
// Reports that keep a branch from closing: under review or sent back, or a draft that
// still holds at least one active collection.
const OPEN_REPORTS = `(SELECT count(*)::int FROM weekly_reports r
  WHERE r.branch_id = b.id
    AND (r.status IN ('submitted', 'returned')
      OR (r.status = 'draft'
        AND EXISTS (SELECT 1 FROM collections c WHERE c.report_id = r.id AND c.status = 'active'))))`;

type ListRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  status: BranchStatus;
  lead_count: number;
  created_at: Date;
};
type DetailRow = ListRow & { summary: string | null; updated_at: Date; open_report_count: number };

export type LockedBranch = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  summary: string | null;
  status: BranchStatus;
};

export type AssignableUser = {
  id: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
};

const toListItem = (row: ListRow): BranchListItem => ({
  id: row.id,
  code: row.code,
  name: row.name,
  city: row.city,
  status: row.status,
  leadCount: row.lead_count,
  createdAt: row.created_at.toISOString(),
});

export async function selectBranches(
  db: Queryable,
  scope: Scope,
  q: { status?: BranchStatus } = {},
): Promise<BranchListItem[]> {
  const where = scopeWhere(scope, 'b.id', 1);
  const params = [...where.params];
  let predicate = where.sql;
  if (q.status) {
    params.push(q.status);
    predicate += ` AND b.status = $${params.length}`;
  }
  const { rows } = await db.query<ListRow>(
    `SELECT b.id, b.code, b.name, b.city, b.status, b.created_at, ${LEAD_COUNT} AS lead_count
     FROM branches b WHERE ${predicate} ORDER BY lower(b.name), b.id`,
    params,
  );
  return rows.map(toListItem);
}

async function selectLeads(db: Queryable, branchId: string): Promise<BranchLead[]> {
  const { rows } = await db.query<{ id: string; name: string; email: string; role: LeadRole }>(
    `SELECT u.id, u.name, u.email, u.role FROM users u
     WHERE u.branch_id = $1 AND ${LEAD_FILTER} ORDER BY u.role, lower(u.name), u.id`,
    [branchId],
  );
  return rows.map((row) => ({ userId: row.id, name: row.name, email: row.email, role: row.role }));
}

/** Missing, malformed and out-of-scope ids are the same NotFound. */
export async function selectBranchDetail(
  db: Queryable,
  scope: Scope,
  id: string,
): Promise<BranchDetail> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'b.id', 2);
  const { rows } = await db.query<DetailRow>(
    `SELECT b.id, b.code, b.name, b.city, b.summary, b.status, b.created_at, b.updated_at,
       ${LEAD_COUNT} AS lead_count, ${OPEN_REPORTS} AS open_report_count
     FROM branches b WHERE b.id = $1 AND ${where.sql}`,
    [id, ...where.params],
  );
  const row = rows[0];
  if (!row) throw new NotFound();
  return {
    ...toListItem(row),
    summary: row.summary,
    updatedAt: row.updated_at.toISOString(),
    leads: await selectLeads(db, row.id),
    allowedTransitions: [...BRANCH_TRANSITIONS[row.status]],
    openReportCount: row.open_report_count,
  };
}

export async function nextBranchCode(tx: Queryable): Promise<string> {
  const { rows } = await tx.query<{ n: string }>(`SELECT nextval('branch_code_seq')::text AS n`);
  return rows[0]!.n;
}

/** Serialises name checks so two creates cannot both pass the uniqueness test. */
export async function lockBranchNames(tx: Queryable): Promise<void> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('branch-name'))`);
}

export async function branchNameTaken(
  tx: Queryable,
  name: string,
  exceptId?: string,
): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM branches WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid) LIMIT 1`,
    [name, exceptId ?? null],
  );
  return rows.length > 0;
}

export async function insertBranch(
  tx: Queryable,
  input: { code: string; name: string; city: string | null; summary: string | null },
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO branches (code, name, city, summary, status) VALUES ($1, $2, $3, $4, 'forming')
     RETURNING id`,
    [input.code, input.name, input.city, input.summary],
  );
  return rows[0]!.id;
}

export async function lockBranch(tx: Queryable, scope: Scope, id: string): Promise<LockedBranch> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'b.id', 2);
  const { rows } = await tx.query<LockedBranch>(
    `SELECT b.id, b.code, b.name, b.city, b.summary, b.status FROM branches b
     WHERE b.id = $1 AND ${where.sql} FOR UPDATE`,
    [id, ...where.params],
  );
  if (!rows[0]) throw new NotFound();
  return rows[0];
}

export async function updateBranchFields(
  tx: Queryable,
  scope: Scope,
  id: string,
  fields: { name?: string; city?: string | null; summary?: string | null },
): Promise<void> {
  const assignments: string[] = [];
  const values: unknown[] = [id];
  for (const key of ['name', 'city', 'summary'] as const) {
    if (fields[key] === undefined) continue;
    values.push(fields[key]);
    assignments.push(`${key} = $${values.length}`);
  }
  if (assignments.length === 0) return;
  const where = scopeWhere(scope, 'id', values.length + 1);
  await tx.query(
    `UPDATE branches SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1 AND ${where.sql}`,
    [...values, ...where.params],
  );
}

/** Conditional status move; returns the number of rows changed (0 or 1). */
export async function updateBranchStatus(
  tx: Queryable,
  scope: Scope,
  id: string,
  from: BranchStatus,
  to: BranchStatus,
): Promise<number> {
  const where = scopeWhere(scope, 'id', 4);
  const result = await tx.query(
    `UPDATE branches SET status = $3, updated_at = now() WHERE id = $1 AND status = $2 AND ${where.sql}`,
    [id, from, to, ...where.params],
  );
  return result.rowCount ?? 0;
}

export async function branchVisible(db: Queryable, scope: Scope, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const where = scopeWhere(scope, 'b.id', 2);
  const { rows } = await db.query(`SELECT 1 FROM branches b WHERE b.id = $1 AND ${where.sql}`, [
    id,
    ...where.params,
  ]);
  return rows.length > 0;
}

export async function countOpenReports(tx: Queryable, branchId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT ${OPEN_REPORTS} AS n FROM branches b WHERE b.id = $1`,
    [branchId],
  );
  return rows[0]?.n ?? 0;
}

export async function lockUserForAssignment(
  db: Queryable,
  userId: string,
  opts: { forUpdate?: boolean } = { forUpdate: true },
): Promise<AssignableUser | null> {
  if (!UUID.test(userId)) return null;
  const { rows } = await db.query<{
    id: string;
    role: string;
    branch_id: string | null;
    is_active: boolean;
  }>(
    `SELECT id, role, branch_id, is_active FROM users WHERE id = $1${opts.forUpdate ? ' FOR UPDATE' : ''}`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, role: row.role, branchId: row.branch_id, isActive: row.is_active };
}

export async function setUserBranch(
  tx: Queryable,
  userId: string,
  branchId: string,
): Promise<void> {
  await tx.query('UPDATE users SET branch_id = $2, updated_at = now() WHERE id = $1', [
    userId,
    branchId,
  ]);
}

export async function selectLeadCandidates(db: Queryable): Promise<LeadCandidate[]> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    email: string;
    role: LeadRole;
    branch_id: string | null;
    branch_name: string | null;
  }>(
    `SELECT u.id, u.name, u.email, u.role, u.branch_id, b.name AS branch_name
     FROM users u LEFT JOIN branches b ON b.id = u.branch_id
     WHERE ${LEAD_FILTER} ORDER BY u.role, lower(u.name), u.id`,
  );
  return rows.map((row) => ({
    userId: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    branchId: row.branch_id,
    branchName: row.branch_name,
  }));
}
