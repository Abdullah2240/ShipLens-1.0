// Drill-down (trace) shapes. Money values are two-decimal strings; counts at L1 and L2 of a
// count figure are integer strings; instants are ISO strings; business dates 'YYYY-MM-DD'.
import type { TimelineEntry } from '@/modules/timeline';
import type { Explanation, FigureId, FigureMeasure } from './types';

export interface TrailStep {
  kind: 'dashboard' | 'figure' | 'branch' | 'report' | 'collection';
  href: string;
  figure: FigureId;
  measure: FigureMeasure;
  value: string;
  branchCode?: string;
  branchName?: string;
  weekStart?: string;
  collectedOn?: string;
}

export interface BranchHeader {
  branchId: string;
  branchCode: string;
  branchName: string;
  branchStatus: string;
  city: string | null;
}

/** One branch at L1. `value` is money (or a count for count figures). */
export interface BranchFigureRow {
  branchId: string;
  branchCode: string;
  branchName: string;
  branchStatus: string;
  value: string;
  /** Collections behind a money value; reports behind a report count; 1 for an active branch. */
  recordCount: number;
  reportCount: number;
  href: string;
}

/** One report at L2. `value` is always the report's amount for the figure (the L3 parent). */
export interface ReportFigureRow {
  reportId: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  value: string;
  /** Collections behind `value`. */
  recordCount: number;
  frozenAmount: string | null;
  frozenCount: number | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  href: string;
}

export interface CollectionFigureRow {
  collectionId: string;
  collectedOn: string;
  purpose: string;
  amount: string;
  routedAt: string | null;
  href: string;
}

export interface ReportHeader {
  reportId: string;
  weekStart: string;
  weekEnd: string;
  status: string;
  liveAmount: string;
  liveCount: number;
  frozenAmount: string | null;
  frozenCount: number | null;
  /** Null unless the report is submitted or approved (frozen totals only bind then). */
  frozenMatchesLive: boolean | null;
  submittedAt: string | null;
  submittedByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  returnReason: string | null;
}

export interface ReportEventRow {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorName: string | null;
  reason: string | null;
  occurredAt: string;
}

export type TraceLevelName = 'branches' | 'reports' | 'collections';

export interface TraceLevel<R> {
  figure: FigureId;
  slug: string;
  measure: FigureMeasure;
  level: TraceLevelName;
  /** The number clicked one level up, computed by an independent query. */
  parentValue: string;
  rows: R[];
  /** Sum over every matching row (also when `rows` is truncated). */
  total: string;
  /** Number of matching rows at this level (also when `rows` is truncated). */
  recordCount: number;
  matchesParent: boolean;
  truncated: { shown: number } | null;
  explain: Explanation;
  asOf: string;
  trail: TrailStep[];
}

export interface CollectionDetail {
  collectionId: string;
  amount: string;
  collectedOn: string;
  purpose: string;
  status: string;
  voidReason: string | null;
  routedAt: string | null;
  routedByName: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface CollectionEvidence {
  figure: FigureId;
  slug: string;
  branch: BranchHeader;
  report: ReportHeader;
  reportEvents: ReportEventRow[];
  collection: CollectionDetail;
  collectionTimeline: TimelineEntry[];
  reportTimeline: TimelineEntry[];
  explain: Explanation;
  asOf: string;
  trail: TrailStep[];
}

export type BranchReportsLevel = TraceLevel<ReportFigureRow> & { branch: BranchHeader };

export type ReportCollectionsLevel = TraceLevel<CollectionFigureRow> & {
  branch: BranchHeader;
  report: ReportHeader;
  reportEvents: ReportEventRow[];
};
