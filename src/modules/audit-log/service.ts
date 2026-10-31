import type { Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { resolveAuditAccess } from './policy';
import { selectAuditEvents, selectAuditFacets } from './repo';
import { AUDIT_LIMITS } from './schema';
import type { AuditFacets, AuditPage, AuditQuery } from './types';

function safeLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isInteger(limit)) return AUDIT_LIMITS.defaultLimit;
  return Math.min(Math.max(limit, 1), AUDIT_LIMITS.maxLimit);
}

/** Audit events visible to the actor, newest first, filtered and keyset paged on id. */
export async function listAuditEvents(
  db: Queryable,
  actor: Actor,
  q: AuditQuery,
): Promise<AuditPage> {
  const access = resolveAuditAccess(actor);
  const { items, hasMore } = await selectAuditEvents(db, access.scope, {
    ...q,
    limit: safeLimit(q.limit),
    entityTypes: access.entityTypes,
  });
  return {
    items,
    nextBefore: hasMore && items.length > 0 ? items[items.length - 1]!.id : null,
    restricted: access.entityTypes !== null,
  };
}

/** Filter options for the audit viewer: only values the actor can actually see. */
export async function getAuditFacets(db: Queryable, actor: Actor): Promise<AuditFacets> {
  const access = resolveAuditAccess(actor);
  const facets = await selectAuditFacets(db, access.scope, access.entityTypes);
  return { ...facets, restricted: access.entityTypes !== null };
}
