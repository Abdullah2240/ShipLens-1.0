import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/platform/authz/permissions';
import { ROLES, type Role } from '@/platform/authz/roles';
import { reportCapabilities } from './capabilities';

const EXPECTED: Record<Role, ReturnType<typeof reportCapabilities>> = {
  super_admin: { canSubmit: false, canReview: false, canSeeAll: true, canSeeTimeline: true },
  finance_reviewer: { canSubmit: false, canReview: true, canSeeAll: true, canSeeTimeline: true },
  branch_lead: { canSubmit: true, canReview: false, canSeeAll: false, canSeeTimeline: true },
  hr_lead: { canSubmit: false, canReview: false, canSeeAll: false, canSeeTimeline: false },
  content_editor: { canSubmit: false, canReview: false, canSeeAll: false, canSeeTimeline: false },
};

const grant = (action: keyof typeof PERMISSIONS, role: Role): string | undefined =>
  (PERMISSIONS[action] as Partial<Record<Role, string>>)[role];

describe('report capabilities', () => {
  it.each(ROLES)('matches the expected table for %s', (role) => {
    expect(reportCapabilities(role)).toEqual(EXPECTED[role]);
  });

  it.each(ROLES)('agrees with the permission table for %s', (role) => {
    const caps = reportCapabilities(role);
    expect(caps.canSubmit).toBe(grant('report.submit', role) !== undefined);
    expect(caps.canReview).toBe(
      grant('report.approve', role) !== undefined && grant('report.return', role) !== undefined,
    );
    expect(caps.canSeeAll).toBe(grant('report.read', role) === 'all');
    expect(caps.canSeeTimeline).toBe(grant('audit.read_timeline', role) !== undefined);
  });

  it('never lets one role both submit and review', () => {
    for (const role of ROLES) {
      const caps = reportCapabilities(role);
      expect(caps.canSubmit && caps.canReview).toBe(false);
    }
  });
});
