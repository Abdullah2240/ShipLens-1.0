// Pure report state machine and per-actor action rules. Data plus small functions only.
import type { Actor } from '@/platform/authz';
import { PERMISSIONS, type Action, type ScopeGrant } from '@/platform/authz/permissions';
import type { Role } from '@/platform/authz/roles';
import type { BranchStatus, ReportStatus } from '@/platform/config/constants';
import type { ReportAction, ReportEventType } from './types';

export type { ReportAction, ReportEventType } from './types';

export interface ReportTransition {
  from: ReportStatus;
  action: ReportAction;
  to: ReportStatus;
  event: ReportEventType;
}

export const REPORT_ACTIONS: readonly ReportAction[] = ['submit', 'return', 'approve'];

export const REPORT_TRANSITIONS: readonly ReportTransition[] = [
  { from: 'draft', action: 'submit', to: 'submitted', event: 'submitted' },
  { from: 'returned', action: 'submit', to: 'submitted', event: 'resubmitted' },
  { from: 'submitted', action: 'return', to: 'returned', event: 'returned' },
  { from: 'submitted', action: 'approve', to: 'approved', event: 'approved' },
];

/** Statuses in which a report's collections can still change. */
export const REPORT_OPEN_STATUSES: readonly ReportStatus[] = ['draft', 'returned'];

/** The permission each action needs. */
export const REPORT_ACTION_PERMISSION: Readonly<Record<ReportAction, Action>> = {
  submit: 'report.submit',
  return: 'report.return',
  approve: 'report.approve',
};

export function nextReportStatus(
  from: ReportStatus,
  action: ReportAction,
): { to: ReportStatus; event: ReportEventType } | null {
  const row = REPORT_TRANSITIONS.find((t) => t.from === from && t.action === action);
  return row ? { to: row.to, event: row.event } : null;
}

function grantFor(actor: Actor, action: Action): ScopeGrant | undefined {
  const row = PERMISSIONS[action] as Partial<Record<Role, ScopeGrant>>;
  return Object.hasOwn(row, actor.role) ? row[actor.role] : undefined;
}

/**
 * Actions the actor may take on the report now: the role holds the permission (branch
 * roles only on their own branch), the transition exists, the branch is not closed, and
 * approve is never offered to the report's submitter. Never throws.
 */
export function allowedActionsFor(
  actor: Actor,
  report: {
    status: ReportStatus;
    branchId: string;
    branchStatus: BranchStatus;
    submittedBy: string | null;
  },
): ReportAction[] {
  if (report.branchStatus === 'closed') return [];
  return REPORT_ACTIONS.filter((action) => {
    const grant = grantFor(actor, REPORT_ACTION_PERMISSION[action]);
    if (grant === undefined) return false;
    if (grant === 'own_branch' && (!actor.branchId || actor.branchId !== report.branchId))
      return false;
    if (nextReportStatus(report.status, action) === null) return false;
    if (action === 'approve' && report.submittedBy === actor.userId) return false;
    return true;
  });
}
