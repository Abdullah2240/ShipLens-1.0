import { scopeWhere, type Scope } from '@/platform/authz';
import type { MemberQuery } from './schema';

export const MEMBER_SEARCH_EXPR =
  "lower(m.full_name || ' ' || m.member_code || ' ' || coalesce(m.email, '') || ' ' || coalesce(m.phone, ''))";

export function buildMemberQuery(
  scope: Scope,
  q: MemberQuery,
): { listSql: string; countSql: string; listParams: unknown[]; countParams: unknown[] } {
  const scoped = scopeWhere(scope, 'm.branch_id', 1);
  const params: unknown[] = [...scoped.params];
  const predicates = [scoped.sql];
  const tokens = q.q?.toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 5) ?? [];
  for (const token of tokens) {
    params.push(`%${token.slice(0, 64).replace(/[\\%_]/g, '\\$&')}%`);
    predicates.push(`${MEMBER_SEARCH_EXPR} LIKE $${params.length} ESCAPE '\\'`);
  }
  for (const [column, value] of [
    ['m.team_id', q.teamId],
    ['m.member_role', q.role],
    ['m.status', q.status],
  ] as const) {
    if (value !== undefined) {
      params.push(value);
      predicates.push(`${column} = $${params.length}`);
    }
  }
  const from =
    'FROM members m JOIN branches b ON b.id = m.branch_id LEFT JOIN teams t ON t.id = m.team_id';
  const where = `WHERE ${predicates.join(' AND ')}`;
  return {
    listSql: `SELECT m.id, m.member_code, m.full_name, m.email, m.phone, m.team_id, t.name AS team_name, m.member_role, m.status, m.branch_id, b.name AS branch_name, m.joined_on ${from} ${where} ORDER BY lower(m.full_name), m.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    countSql: `SELECT count(*)::int AS total ${from} ${where}`,
    listParams: [...params, q.pageSize, (q.page - 1) * q.pageSize],
    countParams: params,
  };
}
