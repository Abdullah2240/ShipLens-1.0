import type { BranchStatus, ReportStatus } from '@/platform/config/constants';
import type { MoneyString } from '@/platform/money';
import type { DateString } from '@/platform/time';

export type { BranchStatus, ReportStatus } from '@/platform/config/constants';

export type ReportAction = 'submit' | 'return' | 'approve';
export type ReportEventType = 'submitted' | 'resubmitted' | 'returned' | 'approved';

export interface ReportListItem {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  branchStatus: BranchStatus;
  weekStart: DateString;
  weekEnd: DateString;
  status: ReportStatus;
  /** Frozen when submitted or approved, the live sum of active collections otherwise. */
  amount: MoneyString;
  count: number;
  amountIsFrozen: boolean;
  submittedAt: string | null;
  submittedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  version: number;
}

export interface ReportCollectionRow {
  id: string;
  collectedOn: DateString;
  amount: MoneyString;
  purpose: string;
  status: 'active' | 'voided';
  voidReason: string | null;
  routedAt: string | null;
  createdByName: string | null;
}

export interface ReportEventItem {
  id: string;
  type: ReportEventType;
  fromStatus: ReportStatus | null;
  toStatus: ReportStatus | null;
  actorName: string | null;
  reason: string | null;
  occurredAt: string;
}

export interface ReportDetail extends ReportListItem {
  returnReason: string | null;
  liveAmount: MoneyString;
  liveCount: number;
  frozenAmount: MoneyString | null;
  frozenCount: number | null;
  collections: ReportCollectionRow[];
  events: ReportEventItem[];
  /** For the requesting actor: permission, state, branch not closed, not self-approval. */
  allowedActions: ReportAction[];
}

export interface ReportQuery {
  status?: ReportStatus;
  branchId?: string;
  weekStart?: DateString;
  /** Default 60, clamped to 1..500. */
  limit: number;
}

export interface ReportPage {
  items: ReportListItem[];
  total: number;
}
