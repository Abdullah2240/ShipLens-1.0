import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/platform/authz/permissions';
import { ROLES, type Role } from '@/platform/authz/roles';
import { branchCapabilities, isBranchReadOnly } from './capabilities';

const EXPECTED: Record<Role, ReturnType<typeof branchCapabilities>> = {
  super_admin: {
    canCreate: true,
    canEdit: true,
    canTransition: true,
    canAssignLeads: true,
    canSeeAll: true,
  },
  finance_reviewer: {
    canCreate: false,
    canEdit: false,
    canTransition: false,
    canAssignLeads: false,
    canSeeAll: true,
  },
  content_editor: {
    canCreate: false,
    canEdit: false,
    canTransition: false,
    canAssignLeads: false,
    canSeeAll: false,
  },
  branch_lead: {
    canCreate: false,
    canEdit: false,
    canTransition: false,
    canAssignLeads: false,
    canSeeAll: false,
  },
  hr_lead: {
    canCreate: false,
    canEdit: false,
    canTransition: false,
    canAssignLeads: false,
    canSeeAll: false,
  },
};

const grants = (action: keyof typeof PERMISSIONS): Partial<Record<Role, string>> =>
  PERMISSIONS[action];

describe('branchCapabilities', () => {
  it.each(ROLES)('gives %s the expected screen controls', (role) => {
    expect(branchCapabilities(role)).toEqual(EXPECTED[role]);
  });

  it.each(ROLES)('agrees with the permission table for %s', (role) => {
    const caps = branchCapabilities(role);
    expect(caps.canCreate).toBe(grants('branch.create')[role] !== undefined);
    expect(caps.canEdit).toBe(grants('branch.update')[role] !== undefined);
    expect(caps.canTransition).toBe(grants('branch.transition')[role] !== undefined);
    expect(caps.canAssignLeads).toBe(grants('branch.assign_leads')[role] !== undefined);
    expect(caps.canSeeAll).toBe(grants('branch.read')[role] === 'all');
  });
});

describe('isBranchReadOnly', () => {
  it('treats only closed branches as read-only', () => {
    expect(isBranchReadOnly('closed')).toBe(true);
    for (const status of ['forming', 'active', 'paused'] as const) {
      expect(isBranchReadOnly(status)).toBe(false);
    }
  });
});
