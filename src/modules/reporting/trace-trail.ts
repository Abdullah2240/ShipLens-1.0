// The "trail of numbers": one breadcrumb step per drill-down level, each carrying the value
// that was clicked to reach the next level. Pure.
import { FIGURES, traceHref } from './figures';
import { toSearchParams } from './filters';
import type { TrailStep } from './trace-types';
import type { FigureId, ReportingFilters } from './types';

export interface TrailInput {
  figure: FigureId;
  filters: ReportingFilters;
  /** The figure's value on the dashboard for `filters`. */
  overview: string;
  branch?: { id: string; code: string; name: string; value: string };
  report?: { id: string; weekStart: string; value: string };
  collection?: { id: string; collectedOn: string; amount: string };
}

export function buildTrail(input: TrailInput): TrailStep[] {
  const { figure, filters, overview, branch, report, collection } = input;
  if (report && !branch) throw new Error('buildTrail: a report needs its branch');
  if (collection && !report) throw new Error('buildTrail: a collection needs its report');
  const measure = FIGURES[figure].measure;
  const steps: TrailStep[] = [
    {
      kind: 'dashboard',
      href: `/dashboard${toSearchParams(filters)}`,
      figure,
      measure,
      value: overview,
    },
    { kind: 'figure', href: traceHref(figure, {}, filters), figure, measure, value: overview },
  ];
  if (branch) {
    steps.push({
      kind: 'branch',
      href: traceHref(figure, { branchId: branch.id }, filters),
      figure,
      measure,
      value: branch.value,
      branchCode: branch.code,
      branchName: branch.name,
    });
  }
  if (branch && report) {
    steps.push({
      kind: 'report',
      href: traceHref(figure, { branchId: branch.id, reportId: report.id }, filters),
      figure,
      measure: 'amount',
      value: report.value,
      weekStart: report.weekStart,
    });
  }
  if (branch && report && collection) {
    steps.push({
      kind: 'collection',
      href: traceHref(
        figure,
        { branchId: branch.id, reportId: report.id, collectionId: collection.id },
        filters,
      ),
      figure,
      measure: 'amount',
      value: collection.amount,
      collectedOn: collection.collectedOn,
    });
  }
  return steps;
}
