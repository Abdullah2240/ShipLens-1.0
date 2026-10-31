// Shared reporting types. Money values are two-decimal strings; months are PKT 'YYYY-MM'.

export type MoneyFigureId =
  'collected' | 'approved' | 'pending_approval' | 'in_progress' | 'not_yet_routed' | 'routed';
export type CountFigureId = 'active_branches' | 'reports_awaiting_review';
export type FigureId = MoneyFigureId | CountFigureId;
export type FigureMeasure = 'amount' | 'count';

export interface FigureDefinition {
  slug: string;
  measure: FigureMeasure;
  /** v_kpi_collections boolean column ('TRUE' for collected); null for count figures. */
  predicate: string | null;
  /** The money figure whose predicate applies at collection level; null when none does. */
  collectionPredicate: MoneyFigureId | null;
}

export interface ReportingFilters {
  from?: string;
  to?: string;
  branch?: string;
}

export interface FigureValue {
  figure: FigureId;
  measure: FigureMeasure;
  value: string;
  recordCount: number;
}

export interface Explanation {
  figure: FigureId;
  level: 'overview' | 'branches' | 'reports' | 'collections' | 'collection';
  filters: ReportingFilters & { branchId?: string; reportId?: string; collectionId?: string };
  recordCount: number;
  value: string;
  asOf: string;
}

export interface DashboardSummary {
  asOf: string;
  filters: ReportingFilters;
  figures: Record<FigureId, FigureValue>;
  identities: { collected: boolean; approved: boolean };
}

export interface TrendMonth {
  month: string;
  collected: string;
  approved: string;
  pendingApproval: string;
  inProgress: string;
  notYetRouted: string;
  routed: string;
}

export interface TrendSeries {
  asOf: string;
  filters: ReportingFilters;
  months: TrendMonth[];
  totals: Omit<TrendMonth, 'month'>;
}

export interface UnroutedRow {
  collectionId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  reportId: string;
  weekStart: string;
  collectedOn: string;
  purpose: string;
  amount: string;
  approvedAt: string;
  daysWaiting: number;
}

export interface RoutedRow extends Omit<UnroutedRow, 'daysWaiting'> {
  routedAt: string;
  routedByName: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UnroutedPage extends Page<UnroutedRow> {
  totalAmount: string;
  asOf: string;
}

export interface PageQuery {
  page: number;
  pageSize: number;
}
