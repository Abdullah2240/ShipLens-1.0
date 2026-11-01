import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Scope } from '@/platform/authz';
import type { Action } from '@/platform/authz/permissions';
import { Conflict, Unauthenticated } from '@/platform/errors';
import { clearRouted, lockCollectionForRouting, setRouted } from './repo-routing';

function scopeFor(ctx: CommandContext, action: Action): { scope: Scope; userId: string } {
  if (!ctx.actor) throw new Unauthenticated();
  return { scope: authorize(ctx.actor, action), userId: ctx.actor.userId };
}

/** A database guard refusal means the collection is not routable: report it as a 409. */
function isFinanceGuard(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === 'P0001' && typeof message === 'string' && message.startsWith('finance_guard:');
}

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isFinanceGuard(error)) throw new Conflict('not_approved');
    throw error;
  }
}

/** Marks an active collection of an approved report as routed to the main account. */
export async function markCollectionRouted(
  ctx: CommandContext,
  id: string,
): Promise<{ collectionId: string; routedAt: string }> {
  const { scope, userId } = scopeFor(ctx, 'collection.mark_routed');
  return guarded(() =>
    command(ctx, 'collection.mark_routed', async (tx, audit) => {
      const target = await lockCollectionForRouting(tx, scope, id);
      if (target.status !== 'active' || target.reportStatus !== 'approved')
        throw new Conflict('not_approved');
      if (target.routedAt !== null) throw new Conflict('already_routed');

      const routedAt = await setRouted(tx, target.id, ctx.clock.now(), userId);
      if (routedAt === null) throw new Conflict('already_routed');
      audit({
        action: 'collection.mark_routed',
        entityType: 'collection',
        entityId: target.id,
        branchId: target.branchId,
        reportId: target.reportId,
        before: { routed_at: null },
        after: { routed_at: routedAt },
      });
      return { collectionId: target.id, routedAt };
    }),
  );
}

/** Undoes a routing mark. */
export async function unmarkCollectionRouted(
  ctx: CommandContext,
  id: string,
): Promise<{ collectionId: string; routedAt: null }> {
  const { scope } = scopeFor(ctx, 'collection.unmark_routed');
  return guarded(() =>
    command(ctx, 'collection.unmark_routed', async (tx, audit) => {
      const target = await lockCollectionForRouting(tx, scope, id);
      if (target.routedAt === null) throw new Conflict('not_routed');

      if (!(await clearRouted(tx, target.id, ctx.clock.now()))) throw new Conflict('not_routed');
      audit({
        action: 'collection.unmark_routed',
        entityType: 'collection',
        entityId: target.id,
        branchId: target.branchId,
        reportId: target.reportId,
        before: { routed_at: target.routedAt },
        after: { routed_at: null },
      });
      return { collectionId: target.id, routedAt: null };
    }),
  );
}
