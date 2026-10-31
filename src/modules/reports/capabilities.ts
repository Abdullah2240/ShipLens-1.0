// Pure: what a role can do with weekly reports, read from the permission table.
// Buttons on a report still come from the server's `allowedActions`; this only shapes pages.
import { PERMISSIONS, type Action } from '@/platform/authz/permissions';
import type { Role } from '@/platform/authz/roles';

export interface ReportCapabilities {
  /** Submit and resubmit (own branch only). */
  canSubmit: boolean;
  /** Return and approve; also opens the review queue. */
  canReview: boolean;
  /** Reads every branch's reports and gets the head-office filters. */
  canSeeAll: boolean;
  /** Sees the audit timeline on the report page. */
  canSeeTimeline: boolean;
}

function grantOf(action: Action, role: Role): string | undefined {
  const row = PERMISSIONS[action] as Partial<Record<Role, string>>;
  return Object.hasOwn(row, role) ? row[role] : undefined;
}

export function reportCapabilities(role: Role): ReportCapabilities {
  return {
    canSubmit: grantOf('report.submit', role) !== undefined,
    canReview:
      grantOf('report.approve', role) !== undefined && grantOf('report.return', role) !== undefined,
    canSeeAll: grantOf('report.read', role) === 'all',
    canSeeTimeline: grantOf('audit.read_timeline', role) !== undefined,
  };
}
