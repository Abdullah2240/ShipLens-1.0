// Reporting read model (TRC-04). Later service files are imported directly by path until
// the phase gate adds them here; repositories are never exported.
export {
  getDashboardSummary,
  getMonthlyTrend,
  listUnrouted,
  listRecentlyRouted,
} from './service-dashboard';
export {
  FIGURES,
  MONEY_FIGURES,
  COUNT_FIGURES,
  REPORTING_LIMITS,
  figureFromSlug,
  isFigureId,
  isMoneyFigure,
  traceHref,
} from './figures';
export {
  parseReportingFilters,
  normaliseFilters,
  toSearchParams,
  monthBounds,
  monthsBetween,
  parsePageQuery,
  isMonth,
  isUuid,
} from './filters';
export type {
  MoneyFigureId,
  CountFigureId,
  FigureId,
  FigureMeasure,
  FigureDefinition,
  ReportingFilters,
  FigureValue,
  Explanation,
  DashboardSummary,
  TrendMonth,
  TrendSeries,
  UnroutedRow,
  RoutedRow,
  Page,
  UnroutedPage,
  PageQuery,
} from './types';
