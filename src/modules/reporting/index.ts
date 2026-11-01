// Reporting read model (TRC-04): dashboard, drill-down, exports, print, share and the public
// impact figures. Repositories are never exported.
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

// Drill-down (TRC-01..03)
export {
  getFigureByBranch,
  getBranchReports,
  getReportCollections,
  getCollectionEvidence,
} from './service-trace';
export { buildTrail } from './trace-trail';
export type { TrailInput } from './trace-trail';
export type {
  TrailStep,
  BranchHeader,
  BranchFigureRow,
  ReportFigureRow,
  CollectionFigureRow,
  ReportHeader,
  ReportEventRow,
  TraceLevelName,
  TraceLevel,
  CollectionDetail,
  CollectionEvidence,
  BranchReportsLevel,
  ReportCollectionsLevel,
} from './trace-types';

// CSV exports (EXP-01, EXP-02, EXP-04)
export { exportCsv } from './service-export';
export type { ExportQuery, ExportFile } from './service-export';
export {
  EXPORT_KINDS,
  isExportKind,
  flattenLabels,
  summaryExport,
  reportsExport,
  collectionsExport,
  unroutedExport,
  exportFilename,
} from './export-rows';
export type {
  ExportKind,
  ExportLabels,
  ExportTable,
  ExportTableWithTotal,
  ExportCollectionRow,
} from './export-rows';

// Print to PDF (EXP-03)
export {
  PRINT_KINDS,
  PRINT_MAX_ROWS,
  printBodySchema,
  recordPrint,
  getPrintableReport,
} from './service-print';
export type {
  PrintKind,
  PrintInput,
  PrintableCollection,
  PrintableReport,
} from './service-print';

// Public impact (PUB-05)
export { getPublicImpact, resetImpactCache } from './service-impact';
export type { PublicImpact } from './service-impact';

// WhatsApp share (WA-01, WA-02)
export { shareInputSchema, shareLink, shareReport, resolveSharedReport } from './service-share';
export type { ShareLocale, ShareInput, ShareResult } from './service-share';
export { buildShareText, whatsappUrl } from './share-text';
export type {
  ReportShareSummary,
  Translate,
  ShareTextFormatted,
  ShareTextOptions,
} from './share-text';
