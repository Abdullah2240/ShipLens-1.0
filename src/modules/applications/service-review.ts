import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor } from '@/platform/authz';
import { ID_FORMATS } from '@/platform/config/constants';
import type { Queryable } from '@/platform/db';
import { Conflict, Unauthenticated } from '@/platform/errors';
import { pktDate } from '@/platform/time';
import {
  countApplications,
  insertMemberFromApplication,
  lockApplication,
  markApplicationDecided,
  nextMemberSequence,
  selectApplicationById,
  selectApplications,
} from './repo-review';
import type {
  AcceptResult,
  ApplicationDetail,
  ApplicationListItem,
  ApplicationListQuery,
  Page,
} from './review-types';

const DECISION_CONSTRAINTS = new Set(['members_application_id_key', 'members_member_code_key']);

function requireActor(ctx: CommandContext): Actor {
  if (!ctx.actor) throw new Unauthenticated();
  return ctx.actor;
}

/** A unique violation on a member created from an application means another decision won. */
function decisionConflict(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    typeof error.constraint === 'string' &&
    DECISION_CONSTRAINTS.has(error.constraint)
  ) {
    throw new Conflict('already_decided');
  }
  throw error;
}

/** Prefix plus the sequence value left-padded to the configured width; wider values are kept whole. */
export function formatMemberCode(sequenceValue: string): string {
  const { prefix, digits } = ID_FORMATS.memberId;
  return `${prefix}${sequenceValue.padStart(digits, '0')}`;
}

export async function listApplications(
  db: Queryable,
  actor: Actor,
  q: ApplicationListQuery,
): Promise<Page<ApplicationListItem>> {
  const scope = authorize(actor, 'application.read');
  const [items, total] = await Promise.all([
    selectApplications(db, scope, q),
    countApplications(db, scope, q),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export async function getApplication(
  db: Queryable,
  actor: Actor,
  id: string,
): Promise<ApplicationDetail> {
  return selectApplicationById(db, authorize(actor, 'application.read'), id);
}

export async function acceptApplication(ctx: CommandContext, id: string): Promise<AcceptResult> {
  const actor = requireActor(ctx);
  const scope = authorize(actor, 'application.decide');
  try {
    return await command(ctx, 'application.accept', async (tx, audit) => {
      const app = await lockApplication(tx, scope, id);
      if (app.status !== 'pending') throw new Conflict('already_decided');
      const now = ctx.clock.now();
      const memberCode = formatMemberCode(await nextMemberSequence(tx));
      const member = await insertMemberFromApplication(tx, app, memberCode, pktDate(now));
      await markApplicationDecided(tx, app.id, 'accepted', actor.userId, now, null);
      audit({
        action: 'application.accept',
        entityType: 'application',
        entityId: app.id,
        branchId: app.branch_id,
        before: { status: app.status, branch_id: app.branch_id },
        after: { status: 'accepted', branch_id: app.branch_id },
      });
      audit({
        action: 'member.create',
        entityType: 'member',
        entityId: member.id,
        branchId: member.branch_id,
        after: {
          member_code: member.member_code,
          branch_id: member.branch_id,
          member_role: member.member_role,
          status: member.status,
        },
      });
      return { applicationId: app.id, memberId: member.id, memberCode: member.member_code };
    });
  } catch (error) {
    return decisionConflict(error);
  }
}

export async function declineApplication(
  ctx: CommandContext,
  id: string,
  input: { note?: string },
): Promise<void> {
  const actor = requireActor(ctx);
  const scope = authorize(actor, 'application.decide');
  const note = input.note?.trim() || null;
  await command(ctx, 'application.decline', async (tx, audit) => {
    const app = await lockApplication(tx, scope, id);
    if (app.status !== 'pending') throw new Conflict('already_decided');
    await markApplicationDecided(tx, app.id, 'declined', actor.userId, ctx.clock.now(), note);
    audit({
      action: 'application.decline',
      entityType: 'application',
      entityId: app.id,
      branchId: app.branch_id,
      before: { status: app.status, decision_note: app.decision_note },
      after: { status: 'declined', decision_note: note },
    });
  });
}
