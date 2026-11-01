import { authorize, type Actor, type Scope } from '@/platform/authz';
import { PERMISSIONS } from '@/platform/authz/permissions';
import type { Role } from '@/platform/authz/roles';

/** Entity types a Finance Reviewer may see in the audit viewer. */
export const FINANCE_AUDIT_ENTITY_TYPES = ['collection', 'report', 'export', 'share'] as const;

export interface AuditAccess {
  scope: Scope;
  /** Entity types the caller is limited to; null means every entity type. */
  entityTypes: readonly string[] | null;
}

/**
 * Full audit access for roles holding `audit.read`, finance entities only for roles holding
 * `audit.read_finance`; every other role gets Forbidden. The table is checked first so a
 * permitted finance reviewer never produces a denial log for `audit.read`.
 */
export function resolveAuditAccess(actor: Actor): AuditAccess {
  const full = PERMISSIONS['audit.read'] as Partial<Record<Role, unknown>>;
  if (Object.hasOwn(full, actor.role)) {
    return { scope: authorize(actor, 'audit.read'), entityTypes: null };
  }
  return {
    scope: authorize(actor, 'audit.read_finance'),
    entityTypes: FINANCE_AUDIT_ENTITY_TYPES,
  };
}
