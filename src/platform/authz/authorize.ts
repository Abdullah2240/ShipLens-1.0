import { Forbidden } from '../errors';
import { logger } from '../log/logger';
import type { Actor } from './actor';
import { PERMISSIONS } from './permissions';
import type { Action, ScopeGrant } from './permissions';
import type { Role } from './roles';
import { mintScope } from './scope';
import type { Scope } from './scope';

function deny(actor: Actor, action: string): never {
  logger.warn('authz.denied', { action, role: actor.role, userId: actor.userId });
  throw new Forbidden();
}

/**
 * Decide whether the actor may perform the action and return the data scope to apply.
 * Role and branch come only from the Actor argument. Fails closed.
 */
export function authorize(actor: Actor, action: Action): Scope {
  const row = Object.hasOwn(PERMISSIONS, action)
    ? (PERMISSIONS[action] as Partial<Record<Role, ScopeGrant>>)
    : undefined;
  const grant = row !== undefined && Object.hasOwn(row, actor.role) ? row[actor.role] : undefined;

  if (grant === 'all') return mintScope({ kind: 'all' });
  if (grant === 'own_branch' && actor.branchId) {
    return mintScope({ kind: 'branch', branchId: actor.branchId });
  }
  return deny(actor, action);
}
