import type { Role } from './roles';

export type ScopeGrant = 'all' | 'own_branch';

// Frozen in Phase 1: every action used by Phases 1 to 3 is declared here so neither
// builder edits this file concurrently later. Data only, no logic.
//
// Defaults pending owner confirmation (default, confirm with the brief):
// - Finance Reviewer sees all branches.
// - HR Lead is branch scoped.
// - Finance Reviewer audit access is limited to finance entities (enforced by the audit viewer).
// - Finance Reviewer and Super Admin may mark collections routed.
// - Lock anchor is collected_on, day 7 inclusive (see config/constants.ts).
export const PERMISSIONS = {
  'branch.create': { super_admin: 'all' },
  'branch.update': { super_admin: 'all' },
  'branch.transition': { super_admin: 'all' },
  'branch.assign_leads': { super_admin: 'all' },
  'branch.read': {
    super_admin: 'all',
    finance_reviewer: 'all',
    branch_lead: 'own_branch',
    hr_lead: 'own_branch',
  },

  'user.read': { super_admin: 'all' },

  'collection.create': { branch_lead: 'own_branch' },
  'collection.amend': { branch_lead: 'own_branch' },
  'collection.void': { branch_lead: 'own_branch' },
  'collection.read': {
    super_admin: 'all',
    finance_reviewer: 'all',
    branch_lead: 'own_branch',
  },
  'collection.mark_routed': { finance_reviewer: 'all', super_admin: 'all' },
  'collection.unmark_routed': { finance_reviewer: 'all', super_admin: 'all' },

  'report.read': {
    super_admin: 'all',
    finance_reviewer: 'all',
    branch_lead: 'own_branch',
  },
  'report.submit': { branch_lead: 'own_branch' },
  'report.approve': { finance_reviewer: 'all' },
  'report.return': { finance_reviewer: 'all' },
  'report.share': { branch_lead: 'own_branch' },

  'dashboard.read': { super_admin: 'all', finance_reviewer: 'all' },
  'trace.read': { super_admin: 'all', finance_reviewer: 'all' },
  'export.create': { super_admin: 'all', finance_reviewer: 'all' },

  'audit.read': { super_admin: 'all' },
  // Finance entities only; enforced by the Phase 3 audit viewer.
  'audit.read_finance': { finance_reviewer: 'all', super_admin: 'all' },
  // Report and collection timelines.
  'audit.read_timeline': {
    super_admin: 'all',
    finance_reviewer: 'all',
    branch_lead: 'own_branch',
  },

  'application.read': { super_admin: 'all', hr_lead: 'own_branch' },
  'application.decide': { hr_lead: 'own_branch', super_admin: 'all' },

  'member.read': {
    super_admin: 'all',
    hr_lead: 'own_branch',
    branch_lead: 'own_branch',
  },
  'member.update': { super_admin: 'all', hr_lead: 'own_branch' },

  'team.read': {
    super_admin: 'all',
    hr_lead: 'own_branch',
    branch_lead: 'own_branch',
  },
  'team.manage': { super_admin: 'all', hr_lead: 'own_branch' },

  // Events use the content.* actions.
  'content.read': { content_editor: 'all', super_admin: 'all' },
  'content.edit': { content_editor: 'all', super_admin: 'all' },
  'content.publish': { content_editor: 'all', super_admin: 'all' },
  'content.unpublish': { content_editor: 'all', super_admin: 'all' },
  'content.preview': { content_editor: 'all', super_admin: 'all' },
} as const satisfies Record<string, Partial<Record<Role, ScopeGrant>>>;

export type Action = keyof typeof PERMISSIONS;

// Deliberately outside the table: these need no session.
export const PUBLIC_ENDPOINTS: readonly string[] = [
  'POST /api/v1/applications: public membership application submit',
  'GET /api/v1/public/content: published public content',
  'GET /api/v1/public/impact: public impact page figures',
  'GET /api/health: liveness, no database',
  'GET /api/health/db: database readiness',
  'POST /api/v1/auth/login: login, throttled and same response for unknown email and wrong password',
];
