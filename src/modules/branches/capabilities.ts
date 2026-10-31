// Screen controls per role, read from the permission table. Pure, so client components can use it.
import { PERMISSIONS, type ScopeGrant } from '@/platform/authz/permissions';
import type { Role } from '@/platform/authz/roles';
import type { BranchStatus } from '@/platform/config/constants';
import { BRANCH_READ_ONLY } from './transitions';

export interface BranchCapabilities {
  canCreate: boolean;
  canEdit: boolean;
  canTransition: boolean;
  canAssignLeads: boolean;
  /** True when the role reads every branch rather than only its own. */
  canSeeAll: boolean;
}

type Grants = Partial<Record<Role, ScopeGrant>>;
const grantOf = (action: keyof typeof PERMISSIONS, role: Role): ScopeGrant | undefined =>
  (PERMISSIONS[action] as Grants)[role];

export function branchCapabilities(role: Role): BranchCapabilities {
  return {
    canCreate: grantOf('branch.create', role) !== undefined,
    canEdit: grantOf('branch.update', role) !== undefined,
    canTransition: grantOf('branch.transition', role) !== undefined,
    canAssignLeads: grantOf('branch.assign_leads', role) !== undefined,
    canSeeAll: grantOf('branch.read', role) === 'all',
  };
}

/** A closed branch refuses every edit, move and lead assignment. */
export function isBranchReadOnly(status: BranchStatus): boolean {
  return BRANCH_READ_ONLY.includes(status);
}
