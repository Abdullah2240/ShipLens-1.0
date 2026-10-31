// Row shaping for CSV exports. Pure: takes results of the canonical reporting queries and
// returns column definitions, rows and a total row. Labels are passed in by the caller
// (flattened `exports.csv.*` plus `figures.<id>` names), so nothing here loads messages.
import type { CsvColumn, CsvValue } from '@/platform/csv';
import { sumMoney } from '@/platform/money';
import { addDays, pktDate } from '@/platform/time';
import type { CollectionFigureRow, ReportFigureRow } from './repo-kpi';
import type {
  DashboardSummary,
  FigureId,
  FigureValue,
  ReportingFilters,
  UnroutedRow,
} from './types';

export type ExportKind = 'summary' | 'reports' | 'collections' | 'unrouted';
export const EXPORT_KINDS: readonly ExportKind[] = Object.freeze([
  'summary',
  'reports',
  'collections',
  'unrouted',
] as const);

export function isExportKind(value: unknown): value is ExportKind {
  return typeof value === 'string' && (EXPORT_KINDS as readonly string[]).includes(value);
}

/** Flat label map: 'total', 'statuses.approved', 'figures.collected', ... */
export interface ExportLabels {
  [key: string]: string;
}

export interface ExportTable<T> {
  columns: CsvColumn<T>[];
  rows: T[];
  footer?: Record<string, CsvValue>;
}
export type ExportTableWithTotal<T> = ExportTable<T> & { footer: Record<string, CsvValue> };

/** A contributing collection with the branch and week it is reported under. */
export interface ExportCollectionRow extends CollectionFigureRow {
  branchCode: string;
  branchName: string;
  weekStart: string;
}

/** Nested message object to a flat dot-keyed map of its string leaves. */
export function flattenLabels(messages: unknown, prefix = ''): ExportLabels {
  const out: ExportLabels = {};
  if (!messages || typeof messages !== 'object') return out;
  for (const [key, value] of Object.entries(messages)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[name] = value;
    else Object.assign(out, flattenLabels(value, name));
  }
  return out;
}

const label = (labels: ExportLabels, key: string): string => labels[key] ?? key;

// Dashboard order: the six money figures, then the two counts.
const SUMMARY_ORDER: readonly FigureId[] = [
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'routed',
  'active_branches',
  'reports_awaiting_review',
];

/** One row per figure: name, value (money or count) and record count. No total row. */
export function summaryExport(
  summary: DashboardSummary,
  labels: ExportLabels,
): ExportTable<FigureValue> & { footer?: undefined } {
  const rows = SUMMARY_ORDER.map((id) => summary.figures[id]);
  return {
    columns: [
      {
        key: 'figure',
        label: label(labels, 'figure'),
        kind: 'text',
        value: (r) => label(labels, `figures.${r.figure}`),
      },
      {
        key: 'value',
        label: label(labels, 'value'),
        kind: (r) => (r.measure === 'amount' ? 'money' : 'int'),
        value: (r) => r.value,
      },
      { key: 'records', label: label(labels, 'records'), kind: 'int', value: (r) => r.recordCount },
    ],
    rows,
  };
}

const countSum = (values: number[]) => values.reduce((acc, n) => acc + n, 0);

/** Reports contributing to a money figure, with the figure amount per report and a total. */
export function reportsExport(
  rows: ReportFigureRow[],
  labels: ExportLabels,
): ExportTableWithTotal<ReportFigureRow> {
  return {
    columns: [
      {
        key: 'branchCode',
        label: label(labels, 'branchCode'),
        kind: 'text',
        value: (r) => r.branchCode,
      },
      {
        key: 'branchName',
        label: label(labels, 'branchName'),
        kind: 'text',
        value: (r) => r.branchName,
      },
      {
        key: 'weekStart',
        label: label(labels, 'weekStart'),
        kind: 'date',
        value: (r) => r.weekStart,
      },
      {
        key: 'weekEnd',
        label: label(labels, 'weekEnd'),
        kind: 'date',
        value: (r) => addDays(r.weekStart, 6),
      },
      {
        key: 'status',
        label: label(labels, 'status'),
        kind: 'text',
        value: (r) => label(labels, `statuses.${r.status}`),
      },
      { key: 'amount', label: label(labels, 'amount'), kind: 'money', value: (r) => r.value },
      {
        key: 'collections',
        label: label(labels, 'collections'),
        kind: 'int',
        value: (r) => r.recordCount,
      },
      {
        key: 'frozenAmount',
        label: label(labels, 'frozenAmount'),
        kind: 'money',
        value: (r) => r.frozenAmount,
      },
      {
        key: 'submittedAt',
        label: label(labels, 'submittedAt'),
        kind: 'datetime',
        value: (r) => r.submittedAt,
      },
      {
        key: 'approvedAt',
        label: label(labels, 'approvedAt'),
        kind: 'datetime',
        // reviewed_at also records a return; it is an approval time only once approved
        value: (r) => (r.status === 'approved' ? r.reviewedAt : null),
      },
    ],
    rows,
    footer: {
      branchCode: label(labels, 'total'),
      amount: sumMoney(rows.map((r) => r.value)),
      collections: countSum(rows.map((r) => r.recordCount)),
    },
  };
}

/** Every collection contributing to a money figure, with a total. */
export function collectionsExport(
  rows: ExportCollectionRow[],
  labels: ExportLabels,
): ExportTableWithTotal<ExportCollectionRow> {
  return {
    columns: [
      {
        key: 'collectionId',
        label: label(labels, 'collectionId'),
        kind: 'text',
        value: (r) => r.collectionId,
      },
      {
        key: 'branchCode',
        label: label(labels, 'branchCode'),
        kind: 'text',
        value: (r) => r.branchCode,
      },
      {
        key: 'branchName',
        label: label(labels, 'branchName'),
        kind: 'text',
        value: (r) => r.branchName,
      },
      {
        key: 'weekStart',
        label: label(labels, 'weekStart'),
        kind: 'date',
        value: (r) => r.weekStart,
      },
      {
        key: 'collectedOn',
        label: label(labels, 'collectedOn'),
        kind: 'date',
        value: (r) => r.collectedOn,
      },
      { key: 'purpose', label: label(labels, 'purpose'), kind: 'text', value: (r) => r.purpose },
      { key: 'amount', label: label(labels, 'amount'), kind: 'money', value: (r) => r.amount },
      {
        key: 'routedAt',
        label: label(labels, 'routedAt'),
        kind: 'datetime',
        value: (r) => r.routedAt,
      },
    ],
    rows,
    footer: { collectionId: label(labels, 'total'), amount: sumMoney(rows.map((r) => r.amount)) },
  };
}

/** Every approved, unrouted collection, oldest approval first, with a total. */
export function unroutedExport(
  rows: UnroutedRow[],
  labels: ExportLabels,
): ExportTableWithTotal<UnroutedRow> {
  return {
    columns: [
      {
        key: 'branchCode',
        label: label(labels, 'branchCode'),
        kind: 'text',
        value: (r) => r.branchCode,
      },
      {
        key: 'branchName',
        label: label(labels, 'branchName'),
        kind: 'text',
        value: (r) => r.branchName,
      },
      {
        key: 'weekStart',
        label: label(labels, 'weekStart'),
        kind: 'date',
        value: (r) => r.weekStart,
      },
      {
        key: 'collectedOn',
        label: label(labels, 'collectedOn'),
        kind: 'date',
        value: (r) => r.collectedOn,
      },
      { key: 'purpose', label: label(labels, 'purpose'), kind: 'text', value: (r) => r.purpose },
      { key: 'amount', label: label(labels, 'amount'), kind: 'money', value: (r) => r.amount },
      {
        key: 'approvedAt',
        label: label(labels, 'approvedAt'),
        kind: 'datetime',
        value: (r) => r.approvedAt,
      },
      {
        key: 'daysWaiting',
        label: label(labels, 'daysWaiting'),
        kind: 'int',
        value: (r) => r.daysWaiting,
      },
    ],
    rows,
    footer: { branchCode: label(labels, 'total'), amount: sumMoney(rows.map((r) => r.amount)) },
  };
}

const MONTH = /^\d{4}-\d{2}$/;

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 'shiplens-<kind>[-<figure slug>]-<from|all>-<to|all>-<YYYYMMDD in PKT>.csv'.
 * Only [a-z0-9.-] characters, so it is safe inside a Content-Disposition header.
 */
export function exportFilename(
  kind: ExportKind,
  figure: string | null,
  f: ReportingFilters,
  at: Date,
): string {
  const parts = ['shiplens', slugPart(kind)];
  const slug = figure ? slugPart(figure) : '';
  if (slug) parts.push(slug);
  parts.push(f.from && MONTH.test(f.from) ? f.from : 'all');
  parts.push(f.to && MONTH.test(f.to) ? f.to : 'all');
  parts.push(pktDate(at).replace(/-/g, ''));
  return `${parts.join('-')}.csv`;
}
