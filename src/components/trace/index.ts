export { ExplainDrawer, type ExplainDrawerProps, type ExplainIdentity } from './ExplainDrawer';
export { FigureLink, type FigureLinkProps, type FigureSize } from './FigureLink';
export { MonthRangeFilter, type MonthRangeFilterProps } from './MonthRangeFilter';
export {
  FilterChips,
  TraceHeader,
  type ExplainFilterChip,
  type TraceHeaderProps,
} from './TraceHeader';
export { TraceTable, type TraceMeasure, type TraceTableProps } from './TraceTable';
export { TrailBreadcrumb, type TrailBreadcrumbProps, type TrailCrumb } from './TrailBreadcrumb';

/** Figures with copy under `trace.figures.<id>` (same ids as the reporting module). */
export const TRACE_FIGURE_IDS = [
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'routed',
  'active_branches',
  'reports_awaiting_review',
] as const;
export type TraceFigureId = (typeof TRACE_FIGURE_IDS)[number];
