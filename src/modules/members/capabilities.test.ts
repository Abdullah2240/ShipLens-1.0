import { describe, expect, it } from 'vitest';
import { ROLES } from '@/platform/authz/roles';
import { memberCapabilities } from './capabilities';

describe('member capabilities', () => {
  it.each(ROLES)('reflects grants for %s', (role) => {
    const enabled = role === 'hr_lead' || role === 'super_admin';
    expect(memberCapabilities(role)).toEqual({ canEdit: enabled, canManageTeams: enabled });
  });
});
