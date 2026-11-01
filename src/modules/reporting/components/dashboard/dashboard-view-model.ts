// Pure view model for the dashboard overview. Imports only the pure figure and filter
// files (never the services), so client components may share its helpers.
import { FIGURES, traceHref } from '@/modules/reporting/figures';
import { normaliseFilters, toSearchParams } from '@/modules/reporting/filters';
import type {
  DashboardSummary,
  Explanation,
  FigureId,
  FigureMeasure,
  MoneyFigureId,
  ReportingFilters,
  TrendSeries,
} from '@/modules/reporting/types';

export interface FigureCardModel {
  figure: FigureId;
  value: string;
  measure: FigureMeasure;
  recordCount: number;
  href: string;
}

export interface SegmentModel {
  figure: MoneyFigureId;
  amount: string;
  href: string;
}

export type TrendKey = 'approved' | 'pending_approval' | 'in_progress';
export const TREND_KEYS: readonly TrendKey[] = ['approved', 'pending_approval', 'in_progress'];

export interface TrendPointModel {
  month: string;
  values: Record<TrendKey, string>;
}

export type ExportKind = 'summary' | 'reports' | 'collections' | 'unrouted';

export interface DashboardModel {
  asOf: string;
  filters: ReportingFilters;
  identities: { collected: boolean; approved: boolean };
  collected: FigureCardModel;
  approved: FigureCardModel;
  pending: FigureCardModel;
  inProgress: FigureCardModel;
  notYetRouted: FigureCardModel;
  routed: FigureCardModel;
  activeBranches: FigureCardModel;
  awaitingReview: FigureCardModel;
  /** approved, pending_approval, in_progress: they add up to collected. */
  collectedSegments: SegmentModel[];
  /** routed, not_yet_routed: they add up to approved. */
  approvedSegments: SegmentModel[];
  trendPoints: TrendPointModel[];
  trendHref: (month: string, figure: FigureId) => string;
  exportHref: (kind: ExportKind, locale: string) => string;
  printHref: string;
  /** Trend months, oldest first. */
  months: string[];
  explain: Record<FigureId, Explanation>;
}

// Reports and collections exports list what feeds a figure; the overview offers approved.
const EXPORT_FIGURE: Partial<Record<ExportKind, FigureId>> = {
  reports: 'approved',
  collections: 'approved',
};

export function buildDashboardModel(
  summary: DashboardSummary,
  trend: TrendSeries,
  rawFilters: ReportingFilters,
): DashboardModel {
  const filters = normaliseFilters(rawFilters);

  const card = (figure: FigureId): FigureCardModel => {
    const value = summary.figures[figure];
    return {
      figure,
      value: value.value,
      measure: FIGURES[figure].measure,
      recordCount: value.recordCount,
      href: traceHref(figure, {}, filters),
    };
  };
  const segment = (figure: MoneyFigureId): SegmentModel => ({
    figure,
    amount: summary.figures[figure].value,
    href: traceHref(figure, {}, filters),
  });

  const explain = Object.fromEntries(
    (Object.keys(FIGURES) as FigureId[]).map((figure) => [
      figure,
      {
        figure,
        level: 'overview',
        filters,
        recordCount: summary.figures[figure].recordCount,
        value: summary.figures[figure].value,
        asOf: summary.asOf,
      } satisfies Explanation,
    ]),
  ) as Record<FigureId, Explanation>;

  return {
    asOf: summary.asOf,
    filters,
    identities: { ...summary.identities },
    collected: card('collected'),
    approved: card('approved'),
    pending: card('pending_approval'),
    inProgress: card('in_progress'),
    notYetRouted: card('not_yet_routed'),
    routed: card('routed'),
    activeBranches: card('active_branches'),
    awaitingReview: card('reports_awaiting_review'),
    collectedSegments: [segment('approved'), segment('pending_approval'), segment('in_progress')],
    approvedSegments: [segment('routed'), segment('not_yet_routed')],
    trendPoints: trend.months.map((m) => ({
      month: m.month,
      values: {
        approved: m.approved,
        pending_approval: m.pendingApproval,
        in_progress: m.inProgress,
      },
    })),
    trendHref: (month, figure) => traceHref(figure, {}, { ...filters, from: month, to: month }),
    exportHref: (kind, locale) => {
      const params = new URLSearchParams();
      const figure = EXPORT_FIGURE[kind];
      if (figure) params.set('figure', figure);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      if (filters.branch) params.set('branch', filters.branch);
      params.set('locale', locale);
      return `/api/v1/exports/${kind}?${params.toString()}`;
    },
    printHref: `/dashboard/print${toSearchParams(filters)}`,
    months: trend.months.map((m) => m.month),
    explain,
  };
}

export type FilterChipPart =
  | { kind: 'months'; from?: string; to?: string }
  | { kind: 'branch'; id: string }
  | { kind: 'report'; id: string };

/**
 * Which filter chips describe a figure's scope. Empty when nothing narrows it (all time,
 * all branches); otherwise the month range always comes first, "all time" when open.
 */
export function overviewFilterChipsInput(filters: Explanation['filters']): FilterChipPart[] {
  const branch = filters.branchId ?? filters.branch;
  const parts: FilterChipPart[] = [];
  if (!filters.from && !filters.to && !branch && !filters.reportId) return parts;
  const months: FilterChipPart = { kind: 'months' };
  if (filters.from) months.from = filters.from;
  if (filters.to) months.to = filters.to;
  parts.push(months);
  if (branch) parts.push({ kind: 'branch', id: branch });
  if (filters.reportId) parts.push({ kind: 'report', id: filters.reportId });
  return parts;
}

export interface FilterChipText {
  kind: FilterChipPart['kind'];
  label: string;
  text: string;
  /** True when the text is a machine id (shown left to right, monospaced). */
  isId: boolean;
}

export interface FilterChipCopy {
  /** Messages under `dashboard.filters`. */
  t: (
    key: 'months' | 'branch' | 'report' | 'range' | 'fromOnly' | 'toOnly',
    values?: Record<string, string>,
  ) => string;
  allTime: string;
  formatMonth: (month: string) => string;
  branchName?: string | null;
}

/** Chip labels and values for a figure's scope, shared by the page and the drawers. */
export function filterChipTexts(
  filters: Explanation['filters'],
  copy: FilterChipCopy,
): FilterChipText[] {
  return overviewFilterChipsInput(filters).map((part): FilterChipText => {
    switch (part.kind) {
      case 'months': {
        const from = part.from ? copy.formatMonth(part.from) : null;
        const to = part.to ? copy.formatMonth(part.to) : null;
        let text = copy.allTime;
        if (from && to) text = part.from === part.to ? from : copy.t('range', { from, to });
        else if (from) text = copy.t('fromOnly', { from });
        else if (to) text = copy.t('toOnly', { to });
        return { kind: 'months', label: copy.t('months'), text, isId: false };
      }
      case 'branch':
        return copy.branchName
          ? { kind: 'branch', label: copy.t('branch'), text: copy.branchName, isId: false }
          : { kind: 'branch', label: copy.t('branch'), text: part.id.slice(0, 8), isId: true };
      case 'report':
        return { kind: 'report', label: copy.t('report'), text: part.id.slice(0, 8), isId: true };
    }
  });
}
