import type { BranchStatus, CollectionStatus, ReportStatus } from '@/platform/config/constants';
import type { MoneyString } from '@/platform/money';
import type { DateString } from '@/platform/time';
import type { CollectionEditability, LockState } from './lock';

export type { BranchStatus, CollectionStatus, ReportStatus } from '@/platform/config/constants';
export type { CollectionEditability, LockState } from './lock';

// Same values as BRANCH_ACCEPTS_COLLECTIONS and BRANCH_READ_ONLY in the branches module
// (branch lifecycle rule). Duplicated here because this module never imports another.
export const ACCEPTING_BRANCH_STATUSES = [
  'forming',
  'active',
] as const satisfies readonly BranchStatus[];
export const READ_ONLY_BRANCH_STATUSES = ['closed'] as const satisfies readonly BranchStatus[];

// Report statuses whose collections can still change (report state machine rule).
export const OPEN_REPORT_STATUSES = [
  'draft',
  'returned',
] as const satisfies readonly ReportStatus[];

export interface CollectionItem {
  id: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  branchStatus: BranchStatus;
  reportId: string;
  reportStatus: ReportStatus;
  weekStart: DateString;
  amount: MoneyString;
  collectedOn: DateString;
  purpose: string;
  note: string | null;
  status: CollectionStatus;
  voidReason: string | null;
  voidedAt: string | null;
  routedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  lock: LockState;
  editability: CollectionEditability;
}

/** A collection as stored, before the clock-dependent lock fields are added. */
export type CollectionRecord = Omit<CollectionItem, 'lock' | 'editability'>;

export interface CollectionQuery {
  branchId?: string;
  reportId?: string;
  weekStart?: DateString;
  status?: CollectionStatus;
  /** Default 100, clamped to 1..500. */
  limit: number;
}

export interface CollectionPage {
  items: CollectionItem[];
  total: number;
  /** Sum of active collections over every row matching the filters, not only this page. */
  totalActiveAmount: MoneyString;
}

export interface CurrentWeek {
  weekStart: DateString;
  weekEnd: DateString;
  today: DateString;
  reportId: string | null;
  reportStatus: ReportStatus | null;
  activeTotal: MoneyString;
  activeCount: number;
  branchStatus: BranchStatus;
}

export interface CollectionInput {
  amount: MoneyString;
  collectedOn: DateString;
  purpose: string;
  note?: string;
}

export interface CollectionPatch {
  amount?: MoneyString;
  collectedOn?: DateString;
  purpose?: string;
  note?: string | null;
}

export interface VoidInput {
  reason: string;
}
