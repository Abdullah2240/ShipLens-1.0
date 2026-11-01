import { scopeWhere, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import type { TeamItem } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type TeamRow = {
  id: string;
  name: string;
  branch_id: string;
  branch_name: string;
  member_count: number;
};
const map = (row: TeamRow): TeamItem => ({
  id: row.id,
  name: row.name,
  branchId: row.branch_id,
  branchName: row.branch_name,
  memberCount: row.member_count,
});
const SELECT = `SELECT t.id, t.name, t.branch_id, b.name AS branch_name, count(m.id)::int AS member_count FROM teams t JOIN branches b ON b.id=t.branch_id LEFT JOIN members m ON m.team_id=t.id`;
export async function selectTeams(
  db: Queryable,
  scope: Scope,
  opts: { branchId?: string } = {},
): Promise<TeamItem[]> {
  const where = scopeWhere(scope, 't.branch_id', 1);
  const params = [...where.params];
  let predicate = where.sql;
  if (opts.branchId) {
    params.push(opts.branchId);
    predicate += ` AND t.branch_id=$${params.length}`;
  }
  const { rows } = await db.query<TeamRow>(
    `${SELECT} WHERE ${predicate} GROUP BY t.id,b.name ORDER BY lower(t.name),t.id`,
    params,
  );
  return rows.map(map);
}
export async function selectTeamById(db: Queryable, scope: Scope, id: string): Promise<TeamItem> {
  if (!UUID.test(id)) throw new NotFound();
  const where = scopeWhere(scope, 't.branch_id', 2);
  const { rows } = await db.query<TeamRow>(
    `${SELECT} WHERE t.id=$1 AND ${where.sql} GROUP BY t.id,b.name`,
    [id, ...where.params],
  );
  if (!rows[0]) throw new NotFound();
  return map(rows[0]);
}
export async function insertTeam(
  db: Queryable,
  scope: Scope,
  branchId: string,
  name: string,
): Promise<TeamItem> {
  const where = scopeWhere(scope, 'b.id', 3);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO teams (branch_id,name) SELECT b.id,$2 FROM branches b WHERE b.id=$1 AND ${where.sql} RETURNING id`,
    [branchId, name, ...where.params],
  );
  if (!rows[0]) throw new NotFound();
  return selectTeamById(db, scope, rows[0].id);
}
export async function renameTeamRow(
  db: Queryable,
  scope: Scope,
  id: string,
  name: string,
): Promise<TeamItem> {
  const where = scopeWhere(scope, 'branch_id', 3);
  await db.query(`UPDATE teams SET name=$2 WHERE id=$1 AND ${where.sql}`, [
    id,
    name,
    ...where.params,
  ]);
  return selectTeamById(db, scope, id);
}
export async function branchExists(
  db: Queryable,
  scope: Scope,
  branchId: string,
): Promise<boolean> {
  if (!UUID.test(branchId)) return false;
  const where = scopeWhere(scope, 'b.id', 2);
  const { rows } = await db.query(`SELECT b.id FROM branches b WHERE b.id=$1 AND ${where.sql}`, [
    branchId,
    ...where.params,
  ]);
  return rows.length > 0;
}
export async function selectBranchOptions(
  db: Queryable,
  scope: Scope,
): Promise<{ id: string; name: string }[]> {
  const where = scopeWhere(scope, 'b.id', 1);
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT b.id,b.name FROM branches b WHERE ${where.sql} ORDER BY lower(b.name),b.id`,
    where.params,
  );
  return rows;
}
