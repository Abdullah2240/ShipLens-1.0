import { describe, expect, it } from 'vitest';
import type { Actor } from '@/platform/authz';
import { ROLES, type Role } from '@/platform/authz/roles';
import { BRANCH_STATUSES, REPORT_STATUSES } from '@/platform/config/constants';
import {
  REPORT_ACTIONS,
  REPORT_OPEN_STATUSES,
  REPORT_TRANSITIONS,
  allowedActionsFor,
  nextReportStatus,
} from './transitions';
import type { ReportAction } from './types';

const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';
const SUBMITTER = '33333333-3333-4333-8333-333333333333';

const EXPECTED: Record<string, { to: string; event: string }> = {
  'draft>submit': { to: 'submitted', event: 'submitted' },
  'returned>submit': { to: 'submitted', event: 'resubmitted' },
  'submitted>return': { to: 'returned', event: 'returned' },
  'submitted>approve': { to: 'approved', event: 'approved' },
};

describe('nextReportStatus', () => {
  it('allows exactly the four documented moves over all 12 status x action cases', () => {
    let checked = 0;
    for (const from of REPORT_STATUSES) {
      for (const action of REPORT_ACTIONS) {
        checked += 1;
        const key = `${from}>${action}`;
        expect(nextReportStatus(from, action), key).toEqual(EXPECTED[key] ?? null);
      }
    }
    expect(checked).toBe(12);
  });

  it('keeps approved terminal and lists the table rows in order', () => {
    for (const action of REPORT_ACTIONS) expect(nextReportStatus('approved', action)).toBeNull();
    expect(REPORT_TRANSITIONS.map((t) => `${t.from}>${t.action}>${t.to}>${t.event}`)).toEqual([
      'draft>submit>submitted>submitted',
      'returned>submit>submitted>resubmitted',
      'submitted>return>returned>returned',
      'submitted>approve>approved>approved',
    ]);
  });

  it('treats draft and returned as the open statuses', () => {
    expect([...REPORT_OPEN_STATUSES]).toEqual(['draft', 'returned']);
  });

  it('returns null for unknown statuses and actions', () => {
    expect(nextReportStatus('archived' as never, 'submit')).toBeNull();
    expect(nextReportStatus('draft', 'delete' as never)).toBeNull();
  });
});

// Written independently of PERMISSIONS: the frozen grants for the three report actions.
const GRANTS: Record<Role, Partial<Record<ReportAction, 'all' | 'own_branch'>>> = {
  super_admin: {},
  finance_reviewer: { return: 'all', approve: 'all' },
  content_editor: {},
  branch_lead: { submit: 'own_branch' },
  hr_lead: {},
};

function actorFor(role: Role, userId = '44444444-4444-4444-8444-444444444444'): Actor {
  const branchScoped = role === 'branch_lead' || role === 'hr_lead';
  return { userId, role, branchId: branchScoped ? BRANCH_A : null };
}

describe('allowedActionsFor', () => {
  it('matches the generated role x status x action table (60 cases)', () => {
    let checked = 0;
    for (const role of ROLES) {
      const actor = actorFor(role);
      for (const status of REPORT_STATUSES) {
        const allowed = allowedActionsFor(actor, {
          status,
          branchId: BRANCH_A,
          branchStatus: 'active',
          submittedBy: SUBMITTER,
        });
        for (const action of REPORT_ACTIONS) {
          checked += 1;
          const expected =
            GRANTS[role][action] !== undefined && nextReportStatus(status, action) !== null;
          expect(allowed.includes(action), `${role} ${status} ${action}`).toBe(expected);
        }
      }
    }
    expect(checked).toBe(60);
  });

  it('gives branch roles nothing on another branch, head office keeps its grants', () => {
    const report = {
      status: 'draft' as const,
      branchId: BRANCH_B,
      branchStatus: 'active' as const,
      submittedBy: null,
    };
    expect(allowedActionsFor(actorFor('branch_lead'), report)).toEqual([]);
    expect(allowedActionsFor(actorFor('branch_lead'), { ...report, branchId: BRANCH_A })).toEqual([
      'submit',
    ]);
    const submitted = { ...report, status: 'submitted' as const, submittedBy: SUBMITTER };
    expect(allowedActionsFor(actorFor('finance_reviewer'), submitted)).toEqual([
      'return',
      'approve',
    ]);
    expect(allowedActionsFor(actorFor('super_admin'), submitted)).toEqual([]);
  });

  it('refuses every action on a closed branch and allows them on paused or forming', () => {
    for (const branchStatus of BRANCH_STATUSES) {
      const draft = allowedActionsFor(actorFor('branch_lead'), {
        status: 'draft',
        branchId: BRANCH_A,
        branchStatus,
        submittedBy: null,
      });
      const submitted = allowedActionsFor(actorFor('finance_reviewer'), {
        status: 'submitted',
        branchId: BRANCH_A,
        branchStatus,
        submittedBy: SUBMITTER,
      });
      expect(draft, branchStatus).toEqual(branchStatus === 'closed' ? [] : ['submit']);
      expect(submitted, branchStatus).toEqual(
        branchStatus === 'closed' ? [] : ['return', 'approve'],
      );
    }
  });

  it('never offers approve to the submitter', () => {
    const reviewer = actorFor('finance_reviewer', SUBMITTER);
    expect(
      allowedActionsFor(reviewer, {
        status: 'submitted',
        branchId: BRANCH_A,
        branchStatus: 'active',
        submittedBy: SUBMITTER,
      }),
    ).toEqual(['return']);
  });

  it('gives a branch lead without a branch nothing', () => {
    const actor: Actor = { userId: SUBMITTER, role: 'branch_lead', branchId: null };
    expect(
      allowedActionsFor(actor, {
        status: 'draft',
        branchId: BRANCH_A,
        branchStatus: 'active',
        submittedBy: null,
      }),
    ).toEqual([]);
  });
});
