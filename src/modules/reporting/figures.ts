// Every reporting figure, defined once. Money predicates name boolean columns of the
// v_kpi_collections view; repositories take them only from this map, never from input.
import { toSearchParams } from './filters';
import type {
  CountFigureId,
  FigureDefinition,
  FigureId,
  MoneyFigureId,
  ReportingFilters,
} from './types';

export { REPORTING_LIMITS } from './filters';
export type { CountFigureId, FigureDefinition, FigureId, MoneyFigureId } from './types';

export const MONEY_FIGURES: readonly MoneyFigureId[] = Object.freeze([
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'routed',
] as const);

export const COUNT_FIGURES: readonly CountFigureId[] = Object.freeze([
  'active_branches',
  'reports_awaiting_review',
] as const);

function define(def: FigureDefinition): Readonly<FigureDefinition> {
  return Object.freeze(def);
}

export const FIGURES: Readonly<Record<FigureId, Readonly<FigureDefinition>>> = Object.freeze({
  collected: define({
    slug: 'collected',
    measure: 'amount',
    predicate: 'TRUE',
    collectionPredicate: 'collected',
  }),
  approved: define({
    slug: 'approved',
    measure: 'amount',
    predicate: 'is_approved',
    collectionPredicate: 'approved',
  }),
  pending_approval: define({
    slug: 'pending-approval',
    measure: 'amount',
    predicate: 'is_pending_approval',
    collectionPredicate: 'pending_approval',
  }),
  in_progress: define({
    slug: 'in-progress',
    measure: 'amount',
    predicate: 'is_in_progress',
    collectionPredicate: 'in_progress',
  }),
  not_yet_routed: define({
    slug: 'not-yet-routed',
    measure: 'amount',
    predicate: 'is_not_yet_routed',
    collectionPredicate: 'not_yet_routed',
  }),
  routed: define({
    slug: 'routed',
    measure: 'amount',
    predicate: 'is_routed',
    collectionPredicate: 'routed',
  }),
  active_branches: define({
    slug: 'active-branches',
    measure: 'count',
    predicate: null,
    collectionPredicate: null,
  }),
  reports_awaiting_review: define({
    slug: 'reports-awaiting-review',
    measure: 'count',
    predicate: null,
    collectionPredicate: 'pending_approval',
  }),
});

export function isFigureId(value: unknown): value is FigureId {
  return typeof value === 'string' && Object.hasOwn(FIGURES, value);
}

export function isMoneyFigure(value: unknown): value is MoneyFigureId {
  return isFigureId(value) && FIGURES[value].measure === 'amount';
}

export function figureFromSlug(slug: string): FigureId | null {
  if (typeof slug !== 'string') return null;
  for (const id of Object.keys(FIGURES) as FigureId[]) {
    if (FIGURES[id].slug === slug) return id;
  }
  return null;
}

/**
 * App-relative drill-down link (no locale prefix). The path is the proof chain, so a
 * report needs its branch and a collection needs its report.
 */
export function traceHref(
  figure: FigureId,
  path: { branchId?: string; reportId?: string; collectionId?: string },
  filters: ReportingFilters,
): string {
  if (!isFigureId(figure)) throw new Error(`unknown figure: ${String(figure)}`);
  if (path.reportId && !path.branchId) throw new Error('traceHref: a report needs its branch');
  if (path.collectionId && !path.reportId) {
    throw new Error('traceHref: a collection needs its report');
  }
  let href = `/dashboard/kpi/${FIGURES[figure].slug}`;
  if (path.branchId) href += `/branches/${encodeURIComponent(path.branchId)}`;
  if (path.reportId) href += `/reports/${encodeURIComponent(path.reportId)}`;
  if (path.collectionId) href += `/collections/${encodeURIComponent(path.collectionId)}`;
  const query: ReportingFilters = { from: filters.from, to: filters.to };
  if (!path.branchId) query.branch = filters.branch;
  return href + toSearchParams(query);
}
