import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { Conflict, NotFound, ValidationFailed } from '@/platform/errors';
import {
  branchExists,
  insertTeam,
  renameTeamRow,
  selectBranchOptions,
  selectTeamById,
  selectTeams,
} from './repo-teams';
import type { TeamItem } from './types';

function field(path: string, code: string): ValidationFailed {
  return new ValidationFailed([{ path, code, message: code }]);
}
function duplicate(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'teams_branch_name_key'
  )
    throw new Conflict('duplicate_team');
  throw error;
}
async function targetBranch(db: Queryable, scope: Scope, branchId?: string): Promise<string> {
  if (scope.kind === 'branch') {
    if (branchId && branchId !== scope.branchId) throw new NotFound();
    return scope.branchId;
  }
  if (!branchId) throw field('branchId', 'required');
  if (!(await branchExists(db, scope, branchId))) throw field('branchId', 'invalid_branch');
  return branchId;
}
export async function listTeams(
  db: Queryable,
  actor: Actor,
  opts: { branchId?: string } = {},
): Promise<TeamItem[]> {
  const scope = authorize(actor, 'team.read');
  if (scope.kind === 'branch' && opts.branchId && opts.branchId !== scope.branchId)
    throw new NotFound();
  return selectTeams(db, scope, opts);
}
export async function listBranchOptions(
  db: Queryable,
  actor: Actor,
): Promise<{ id: string; name: string }[]> {
  return selectBranchOptions(db, authorize(actor, 'team.read'));
}
export async function createTeam(
  ctx: CommandContext,
  input: { name: string; branchId?: string },
): Promise<TeamItem> {
  const scope = authorize(ctx.actor!, 'team.manage');
  const branchId = await targetBranch(ctx.pool, scope, input.branchId);
  try {
    return await command(ctx, 'team.create', async (tx, audit) => {
      const created = await insertTeam(tx, scope, branchId, input.name);
      audit({
        action: 'team.create',
        entityType: 'team',
        entityId: created.id,
        branchId,
        after: { name: created.name, branch_id: branchId },
      });
      return created;
    });
  } catch (error) {
    return duplicate(error);
  }
}
export async function renameTeam(
  ctx: CommandContext,
  id: string,
  input: { name: string },
): Promise<TeamItem> {
  const scope = authorize(ctx.actor!, 'team.manage');
  try {
    return await command(ctx, 'team.rename', async (tx, audit) => {
      const before = await selectTeamById(tx, scope, id);
      const after = await renameTeamRow(tx, scope, id, input.name);
      audit({
        action: 'team.rename',
        entityType: 'team',
        entityId: id,
        branchId: before.branchId,
        before: { name: before.name, branch_id: before.branchId },
        after: { name: after.name, branch_id: after.branchId },
      });
      return after;
    });
  } catch (error) {
    return duplicate(error);
  }
}
