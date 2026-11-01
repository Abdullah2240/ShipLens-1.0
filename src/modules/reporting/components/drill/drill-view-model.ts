// Pure helpers for drill-down levels 1 and 2. Imports only the pure figure and filter
// files and the money helpers, never a service.
import type { ExplainFilterChip } from '@/components/trace';
import { FIGURES } from '@/modules/reporting/figures';
import { isMonth } from '@/modules/reporting/filters';
import type { BranchFigureRow, ReportFigureRow } from '@/modules/reporting/trace-types';
import type { FigureId, FigureMeasure, ReportingFilters } from '@/modules/reporting/types';
import { compareMoney } from '@/platform/money';

export interface ChipLabels {
  from: string;
  to: string;
  branch: string;
  /** Value of the single chip shown when nothing narrows the figure. */
  allTime: string;
  /** Label of that single chip; `allTime` when absent. */
  period?: string;
  /** Value of an open start ("From: Earliest"); `allTime` when absent. */
  earliest?: string;
  /** Value of an open end ("To: Latest"); `allTime` when absent. */
  latest?: string;
  /** Month display, e.g. "Sep 2026"; the raw 'YYYY-MM' when absent. */
  formatMonth?: (month: string) => string;
}

/**
 * The header chips of a level: the month range as From and To (one "All time" chip when
 * the range is open on both sides), then the branch (name, else its short id).
 */
export function chipsFor(
  filters: ReportingFilters & { branchId?: string; reportId?: string },
  labels: ChipLabels,
  names?: { branch?: string },
): ExplainFilterChip[] {
  const month = (value: string) => (labels.formatMonth ? labels.formatMonth(value) : value);
  const from = isMonth(filters.from) ? filters.from : undefined;
  const to = isMonth(filters.to) ? filters.to : undefined;
  const chips: ExplainFilterChip[] = [];

  if (!from && !to) {
    chips.push({ label: labels.period ?? labels.allTime, value: labels.allTime });
  } else {
    chips.push({
      label: labels.from,
      value: from ? month(from) : (labels.earliest ?? labels.allTime),
    });
    chips.push({ label: labels.to, value: to ? month(to) : (labels.latest ?? labels.allTime) });
  }

  const branch = filters.branchId ?? filters.branch;
  if (branch) {
    chips.push({ label: labels.branch, value: names?.branch || branch.slice(0, 8) });
  }
  return chips;
}

export type DrillLevel = 'branches' | 'reports' | 'collections';

/**
 * The CSV export figure for a level. Count figures export the money rows their levels
 * open: reports awaiting review are the submitted reports (pending approval), and an
 * active branch links to its approved figure.
 */
function exportSlug(figure: FigureId): string {
  if (figure === 'reports_awaiting_review') return FIGURES.pending_approval.slug;
  if (figure === 'active_branches') return FIGURES.approved.slug;
  return FIGURES[figure].slug;
}

/**
 * Export links with the same scope as the level on screen. Below level 1 the branch in
 * the path replaces any branch filter; one report's level exports only its collections.
 */
export function exportLinks(
  level: DrillLevel,
  figure: FigureId,
  f: ReportingFilters,
  ids: { branchId?: string; reportId?: string },
  locale: string,
): { reports?: string; collections: string } {
  const params = new URLSearchParams();
  params.set('figure', exportSlug(figure));
  if (isMonth(f.from)) params.set('from', f.from);
  if (isMonth(f.to)) params.set('to', f.to);
  const branch = level === 'branches' ? f.branch : ids.branchId;
  if (branch) params.set('branch', branch);
  if (level === 'collections' && ids.reportId) params.set('reportId', ids.reportId);
  params.set('locale', locale === 'ur' ? 'ur' : 'en');
  const query = params.toString();

  const collections = `/api/v1/exports/collections?${query}`;
  if (level === 'collections') return { collections };
  return { reports: `/api/v1/exports/reports?${query}`, collections };
}

/**
 * The record count in a level footer, matching the column a reader would add up: the
 * collections behind a money figure, the reports behind reports awaiting review, the
 * branches behind active branches. At level 1 every row carries its own count; at
 * level 2 a count figure counts its rows (reports).
 */
export function footerRecordCount(
  level: 'branches' | 'reports',
  measure: FigureMeasure,
  rows: Pick<BranchFigureRow, 'recordCount'>[],
  levelCount: number,
): number {
  if (level === 'reports' && measure === 'count') return levelCount;
  return rows.reduce((n, r) => n + r.recordCount, 0);
}

export type FrozenNoteKind = 'wholeWeek' | 'lastSubmission';

/**
 * Why a report's frozen total can differ from its value on this level. Submitted and
 * approved reports cannot change, so a difference there only means the month filter
 * counts part of the week; any other report changed after it was last submitted.
 */
export function frozenNoteKind(
  row: Pick<ReportFigureRow, 'status' | 'value' | 'frozenAmount'>,
): FrozenNoteKind | null {
  if (row.frozenAmount === null) return null;
  if (compareMoney(row.frozenAmount, row.value) === 0) return null;
  return row.status === 'submitted' || row.status === 'approved' ? 'wholeWeek' : 'lastSubmission';
}
