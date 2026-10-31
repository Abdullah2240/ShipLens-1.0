// The 7-day lock rule, pure. A collection is editable through the whole PKT day
// collectedOn + LOCK_DAYS (day 7 inclusive) and locked from 00:00 PKT on day 8. Callers pass
// today as pktDate(clock.now()).
import {
  LOCK_DAYS,
  type BranchStatus,
  type CollectionStatus,
  type ReportStatus,
} from '@/platform/config/constants';
import { addDays, daysBetween, type DateString } from '@/platform/time';

export interface LockState {
  lastEditableOn: DateString;
  locked: boolean;
  daysLeft: number;
}

export type CollectionEditability =
  | 'editable'
  | 'editable_exempt'
  | 'locked'
  | 'report_submitted'
  | 'report_approved'
  | 'voided'
  | 'branch_closed';

export function lockState(
  collectedOn: DateString,
  today: DateString,
  lockDays: number = LOCK_DAYS,
): LockState {
  const lastEditableOn = addDays(collectedOn, lockDays);
  const remaining = daysBetween(today, lastEditableOn);
  return { lastEditableOn, locked: remaining < 0, daysLeft: Math.max(0, remaining) };
}

export function isLocked(
  collectedOn: DateString,
  today: DateString,
  lockDays: number = LOCK_DAYS,
): boolean {
  return lockState(collectedOn, today, lockDays).locked;
}

/**
 * What may happen to a collection now. Precedence: voided, closed branch, report under
 * review or approved, then the lock window. A returned report reopens locked collections
 * as an audited exemption.
 */
export function collectionEditability(input: {
  status: CollectionStatus;
  reportStatus: ReportStatus;
  branchStatus: BranchStatus;
  collectedOn: DateString;
  today: DateString;
}): CollectionEditability {
  if (input.status === 'voided') return 'voided';
  if (input.branchStatus === 'closed') return 'branch_closed';
  if (input.reportStatus === 'submitted') return 'report_submitted';
  if (input.reportStatus === 'approved') return 'report_approved';
  if (!isLocked(input.collectedOn, input.today)) return 'editable';
  return input.reportStatus === 'returned' ? 'editable_exempt' : 'locked';
}
