import { PERMISSIONS } from '@/platform/authz/permissions';
import type { Role } from '@/platform/authz/roles';

export function memberCapabilities(role: Role): { canEdit: boolean; canManageTeams: boolean } {
  return {
    canEdit: Object.hasOwn(PERMISSIONS['member.update'], role),
    canManageTeams: Object.hasOwn(PERMISSIONS['team.manage'], role),
  };
}
