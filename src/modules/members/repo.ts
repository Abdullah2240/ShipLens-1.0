import { scopeWhere, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import type { MemberQuery, MemberPatch } from './schema';
import { buildMemberQuery } from './search';
import type { MemberListItem } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = {
  id: string;
  member_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  team_id: string | null;
  team_name: string | null;
  member_role: string;
  status: MemberListItem['status'];
  branch_id: string;
  branch_name: string;
  joined_on: string | null;
};
export function mapMember(row: Row): MemberListItem {
  return {
    id: row.id,
    memberCode: row.member_code,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    teamId: row.team_id,
    teamName: row.team_name,
    memberRole: row.member_role,
    status: row.status,
    branchId: row.branch_id,
    branchName: row.branch_name,
    joinedOn: row.joined_on,
  };
}
const SELECT = `SELECT m.id, m.member_code, m.full_name, m.email, m.phone, m.team_id, t.name AS team_name, m.member_role, m.status, m.branch_id, b.name AS branch_name, m.joined_on FROM members m JOIN branches b ON b.id=m.branch_id LEFT JOIN teams t ON t.id=m.team_id`;
export async function selectMembers(
  db: Queryable,
  scope: Scope,
  q: MemberQuery,
): Promise<MemberListItem[]> {
  const sql = buildMemberQuery(scope, q);
  const { rows } = await db.query<Row>(sql.listSql, sql.listParams);
  return rows.map(mapMember);
}
export async function countMembers(db: Queryable, scope: Scope, q: MemberQuery): Promise<number> {
  const sql = buildMemberQuery(scope, q);
  const { rows } = await db.query<{ total: number }>(sql.countSql, sql.countParams);
  return rows[0]?.total ?? 0;
}
export async function selectMemberById(
  db: Queryable,
  scope: Scope,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<MemberListItem> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 'm.branch_id', 2);
  const { rows } = await db.query<Row>(
    `${SELECT} WHERE m.id=$1 AND ${where.sql}${opts.forUpdate ? ' FOR UPDATE OF m' : ''}`,
    [id, ...where.params],
  );
  if (!rows[0]) throw new NotFound();
  return mapMember(rows[0]);
}
export async function updateMemberRow(
  db: Queryable,
  scope: Scope,
  id: string,
  set: MemberPatch,
): Promise<void> {
  const columns = { teamId: 'team_id', memberRole: 'member_role', status: 'status' } as const;
  const entries = (Object.keys(columns) as (keyof typeof columns)[]).filter(
    (key) => set[key] !== undefined,
  );
  const values: unknown[] = entries.map((key) => set[key]);
  const assignments = entries.map((key, i) => `${columns[key]}=$${i + 1}`);
  const where = scopeWhere(scope, 'branch_id', values.length + 2);
  await db.query(
    `UPDATE members SET ${assignments.join(', ')}, updated_at=now() WHERE id=$${values.length + 1} AND ${where.sql}`,
    [...values, id, ...where.params],
  );
}
export async function teamBelongsToBranch(
  db: Queryable,
  scope: Scope,
  teamId: string,
  branchId: string,
): Promise<boolean> {
  if (!UUID.test(teamId)) return false;
  const where = scopeWhere(scope, 'branch_id', 3);
  const { rows } = await db.query(
    `SELECT id FROM teams WHERE id=$1 AND branch_id=$2 AND ${where.sql}`,
    [teamId, branchId, ...where.params],
  );
  return rows.length > 0;
}
