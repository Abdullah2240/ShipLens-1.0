import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { ValidationFailed } from '@/platform/errors';
import {
  countMembers,
  selectMemberById,
  selectMembers,
  teamBelongsToBranch,
  updateMemberRow,
} from './repo';
import type { MemberPatch, MemberQuery } from './schema';
import type { MemberListItem, Page } from './types';

function snapshot(row: MemberListItem) {
  return {
    member_code: row.memberCode,
    branch_id: row.branchId,
    team_id: row.teamId,
    member_role: row.memberRole,
    status: row.status,
  };
}
function changed(row: MemberListItem, patch: MemberPatch) {
  return (Object.keys(patch) as (keyof MemberPatch)[]).some((key) => patch[key] !== row[key]);
}
function invalidTeam(): ValidationFailed {
  return new ValidationFailed([{ path: 'teamId', code: 'invalid_team', message: 'invalid_team' }]);
}

export async function listMembers(
  db: Queryable,
  actor: Actor,
  q: MemberQuery,
): Promise<Page<MemberListItem>> {
  const scope = authorize(actor, 'member.read');
  const [items, total] = await Promise.all([
    selectMembers(db, scope, q),
    countMembers(db, scope, q),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}
export async function getMember(db: Queryable, actor: Actor, id: string): Promise<MemberListItem> {
  return selectMemberById(db, authorize(actor, 'member.read'), id);
}
export async function updateMember(
  ctx: CommandContext,
  id: string,
  patch: MemberPatch,
): Promise<MemberListItem> {
  const scope = authorize(ctx.actor!, 'member.update');
  const current = await selectMemberById(ctx.pool, scope, id);
  if (patch.teamId && !(await teamBelongsToBranch(ctx.pool, scope, patch.teamId, current.branchId)))
    throw invalidTeam();
  if (!changed(current, patch)) return current;
  return command(ctx, 'member.update', async (tx, audit) => {
    const locked = await selectMemberById(tx, scope, id, { forUpdate: true });
    if (patch.teamId && !(await teamBelongsToBranch(tx, scope, patch.teamId, locked.branchId)))
      throw invalidTeam();
    await updateMemberRow(tx, scope, id, patch);
    const updated = await selectMemberById(tx, scope, id);
    audit({
      action: 'member.update',
      entityType: 'member',
      entityId: id,
      branchId: locked.branchId,
      before: snapshot(locked),
      after: snapshot(updated),
    });
    return updated;
  });
}
