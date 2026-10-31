import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor } from '@/platform/authz';
import type { Action } from '@/platform/authz/permissions';
import type { BranchStatus } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { Conflict, NotFound, Unauthenticated, ValidationFailed } from '@/platform/errors';
import {
  branchNameTaken,
  branchVisible,
  countOpenReports,
  insertBranch,
  lockBranch,
  lockBranchNames,
  lockUserForAssignment,
  nextBranchCode,
  selectBranchDetail,
  selectBranches,
  selectLeadCandidates,
  setUserBranch,
  updateBranchFields,
  updateBranchStatus,
  type AssignableUser,
  type LockedBranch,
} from './repo';
import type { BranchCreateInput, BranchPatch } from './schema';
import { BRANCH_READ_ONLY, canTransitionBranch, formatBranchCode } from './transitions';
import type { BranchDetail, BranchListItem, LeadCandidate } from './types';

type EditableField = 'name' | 'city' | 'summary';

/** Thrown inside a command when, after locking, there is nothing to write; never escapes. */
class NothingToWrite extends Error {}

function scopeFor(actor: Actor | null, action: Action) {
  if (!actor) throw new Unauthenticated();
  return authorize(actor, action);
}

function invalidUser(): ValidationFailed {
  return new ValidationFailed([{ path: 'userId', code: 'invalid_user', message: 'invalid_user' }]);
}

function assertWritable(branch: { status: BranchStatus }): void {
  if (BRANCH_READ_ONLY.includes(branch.status)) throw new Conflict('branch_closed');
}

function assertAssignable(user: AssignableUser | null): asserts user is AssignableUser {
  if (!user || !user.isActive || (user.role !== 'branch_lead' && user.role !== 'hr_lead'))
    throw invalidUser();
}

type BranchChanges = { name?: string; city?: string | null; summary?: string | null };

function changedFields(current: Pick<LockedBranch, EditableField>, patch: BranchPatch) {
  const out: BranchChanges = {};
  if (patch.name !== undefined && patch.name !== current.name) out.name = patch.name;
  for (const key of ['city', 'summary'] as const) {
    const next = patch[key];
    if (next !== undefined && (current[key] ?? null) !== next) out[key] = next;
  }
  return out;
}

function codeCollision(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === 'branches_code_key'
  )
    throw new Conflict('duplicate_branch_code');
  throw error;
}

export async function listBranches(
  db: Queryable,
  actor: Actor,
  q: { status?: BranchStatus } = {},
): Promise<BranchListItem[]> {
  return selectBranches(db, scopeFor(actor, 'branch.read'), q);
}

export async function getBranch(db: Queryable, actor: Actor, id: string): Promise<BranchDetail> {
  return selectBranchDetail(db, scopeFor(actor, 'branch.read'), id);
}

export async function createBranch(
  ctx: CommandContext,
  input: BranchCreateInput,
): Promise<BranchDetail> {
  const scope = scopeFor(ctx.actor, 'branch.create');
  try {
    return await command(ctx, 'branch.create', async (tx, audit) => {
      await lockBranchNames(tx);
      if (await branchNameTaken(tx, input.name)) throw new Conflict('duplicate_branch_name');
      const code = formatBranchCode(await nextBranchCode(tx));
      const row = {
        code,
        name: input.name,
        city: input.city ?? null,
        summary: input.summary ?? null,
      };
      const id = await insertBranch(tx, row);
      audit({
        action: 'branch.create',
        entityType: 'branch',
        entityId: id,
        branchId: id,
        after: { ...row, status: 'forming' },
      });
      return selectBranchDetail(tx, scope, id);
    });
  } catch (error) {
    return codeCollision(error);
  }
}

export async function updateBranch(
  ctx: CommandContext,
  id: string,
  patch: BranchPatch,
): Promise<BranchDetail> {
  const scope = scopeFor(ctx.actor, 'branch.update');
  const current = await selectBranchDetail(ctx.pool, scope, id);
  assertWritable(current);
  if (Object.keys(changedFields(current, patch)).length === 0) return current;
  try {
    return await command(ctx, 'branch.update', async (tx, audit) => {
      const locked = await lockBranch(tx, scope, id);
      assertWritable(locked);
      const changes = changedFields(locked, patch);
      if (Object.keys(changes).length === 0) throw new NothingToWrite();
      if (changes.name !== undefined) {
        await lockBranchNames(tx);
        if (await branchNameTaken(tx, changes.name, id))
          throw new Conflict('duplicate_branch_name');
      }
      await updateBranchFields(tx, scope, id, changes);
      audit({
        action: 'branch.update',
        entityType: 'branch',
        entityId: id,
        branchId: id,
        before: { name: locked.name, city: locked.city, summary: locked.summary },
        after: changes,
      });
      return selectBranchDetail(tx, scope, id);
    });
  } catch (error) {
    if (error instanceof NothingToWrite) return selectBranchDetail(ctx.pool, scope, id);
    throw error;
  }
}

export async function transitionBranch(
  ctx: CommandContext,
  id: string,
  input: { to: BranchStatus },
): Promise<BranchDetail> {
  const scope = scopeFor(ctx.actor, 'branch.transition');
  return command(ctx, 'branch.transition', async (tx, audit) => {
    const current = await selectBranchDetail(tx, scope, id);
    const from = current.status;
    if (!canTransitionBranch(from, input.to)) throw new Conflict('invalid_transition');
    const changed = await updateBranchStatus(tx, scope, id, from, input.to);
    if (changed === 0) {
      // Lost a race: another request moved the branch first.
      if (!(await branchVisible(tx, scope, id))) throw new NotFound();
      throw new Conflict('invalid_transition');
    }
    // Counted after the update so the row lock is held while reports are checked.
    if (input.to === 'closed' && (await countOpenReports(tx, id)) > 0)
      throw new Conflict('branch_has_open_reports');
    audit({
      action: 'branch.transition',
      entityType: 'branch',
      entityId: id,
      branchId: id,
      before: { status: from },
      after: { status: input.to },
    });
    return selectBranchDetail(tx, scope, id);
  });
}

export async function assignLead(
  ctx: CommandContext,
  branchId: string,
  input: { userId: string },
): Promise<BranchDetail> {
  const scope = scopeFor(ctx.actor, 'branch.assign_leads');
  const branch = await selectBranchDetail(ctx.pool, scope, branchId);
  assertWritable(branch);
  const user = await lockUserForAssignment(ctx.pool, input.userId, { forUpdate: false });
  assertAssignable(user);
  if (user.branchId === branchId) return branch;
  try {
    return await command(ctx, 'branch.assign_lead', async (tx, audit) => {
      assertWritable(await lockBranch(tx, scope, branchId));
      const locked = await lockUserForAssignment(tx, input.userId);
      assertAssignable(locked);
      if (locked.branchId === branchId) throw new NothingToWrite();
      await setUserBranch(tx, locked.id, branchId);
      audit({
        action: 'branch.assign_lead',
        entityType: 'user',
        entityId: locked.id,
        branchId,
        before: { branch_id: locked.branchId },
        after: { branch_id: branchId, role: locked.role },
      });
      return selectBranchDetail(tx, scope, branchId);
    });
  } catch (error) {
    if (error instanceof NothingToWrite) return selectBranchDetail(ctx.pool, scope, branchId);
    throw error;
  }
}

export async function listLeadCandidates(db: Queryable, actor: Actor): Promise<LeadCandidate[]> {
  scopeFor(actor, 'user.read');
  return selectLeadCandidates(db);
}
