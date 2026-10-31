import { describe, expect, it } from 'vitest';
import { BRANCH_SCOPED_ROLES, ROLES, type Role } from './roles';
import { PERMISSIONS, PUBLIC_ENDPOINTS } from './permissions';

type Grants = Partial<Record<Role, string>>;
const table = PERMISSIONS as Record<string, Grants>;
const actions = Object.keys(table);

function rolesFor(action: string): string[] {
  return Object.keys(table[action]!).sort();
}

describe('permission table shape', () => {
  it('uses domain.verb action names and known roles only', () => {
    for (const action of actions) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/);
      for (const role of Object.keys(table[action]!)) {
        expect(ROLES as readonly string[]).toContain(role);
      }
    }
  });

  it('grants every action to at least one role with a known scope', () => {
    for (const action of actions) {
      const grants = Object.values(table[action]!);
      expect(grants.length).toBeGreaterThan(0);
      for (const scope of grants) expect(['all', 'own_branch']).toContain(scope);
    }
  });

  it('only branch scoped roles ever get own_branch', () => {
    for (const action of actions) {
      for (const [role, scope] of Object.entries(table[action]!)) {
        if (scope === 'own_branch') {
          expect(BRANCH_SCOPED_ROLES as readonly string[]).toContain(role);
        }
      }
      expect(table[action]!.content_editor).not.toBe('own_branch');
      expect(table[action]!.finance_reviewer).not.toBe('own_branch');
    }
  });
});

describe('permission table rules', () => {
  it('keeps approve and return with the finance reviewer, submit with the branch lead', () => {
    expect(rolesFor('report.approve')).toEqual(['finance_reviewer']);
    expect(rolesFor('report.return')).toEqual(['finance_reviewer']);
    expect(rolesFor('report.submit')).toEqual(['branch_lead']);
  });

  it('enforces separation of duty between submit and approve', () => {
    for (const role of ROLES) {
      const holdsSubmit = table['report.submit']![role] !== undefined;
      const holdsApprove = table['report.approve']![role] !== undefined;
      expect(holdsSubmit && holdsApprove).toBe(false);
    }
  });

  it('keeps head office views away from branch and content roles', () => {
    for (const action of ['dashboard.read', 'trace.read', 'export.create']) {
      const granted = rolesFor(action);
      expect(granted).not.toContain('branch_lead');
      expect(granted).not.toContain('hr_lead');
      expect(granted).not.toContain('content_editor');
    }
  });

  it('keeps branch administration with the super admin only', () => {
    for (const action of [
      'branch.create',
      'branch.update',
      'branch.transition',
      'branch.assign_leads',
    ]) {
      expect(rolesFor(action)).toEqual(['super_admin']);
    }
  });

  it('documents the public endpoints outside the table', () => {
    expect(PUBLIC_ENDPOINTS.length).toBeGreaterThan(0);
  });
});

describe('permission table freeze guard', () => {
  it('matches the agreed action list', () => {
    expect(actions.sort()).toMatchInlineSnapshot(`
      [
        "application.decide",
        "application.read",
        "audit.read",
        "audit.read_finance",
        "audit.read_timeline",
        "branch.assign_leads",
        "branch.create",
        "branch.read",
        "branch.transition",
        "branch.update",
        "collection.amend",
        "collection.create",
        "collection.mark_routed",
        "collection.read",
        "collection.unmark_routed",
        "collection.void",
        "content.edit",
        "content.preview",
        "content.publish",
        "content.read",
        "content.unpublish",
        "dashboard.read",
        "export.create",
        "member.read",
        "member.update",
        "report.approve",
        "report.read",
        "report.return",
        "report.share",
        "report.submit",
        "team.manage",
        "team.read",
        "trace.read",
        "user.read",
      ]
    `);
  });
});
