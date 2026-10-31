// Drill-down services (TRC-01..03). Every level reads the canonical figure queries inside
// one READ ONLY REPEATABLE READ snapshot, computes its parent value through an independent
// query, and reports whether its own total matches it. The URL path is a proof chain:
// any branch, report or collection that does not contribute to the figure under the
// filters is the same NotFound as one that does not exist.
import { getCollectionTimeline, getReportTimeline } from '@/modules/timeline';
import { authorize, type Actor, type Scope } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound } from '@/platform/errors';
import { compareMoney, sumMoney } from '@/platform/money';
import { addDays } from '@/platform/time';
import { FIGURES, REPORTING_LIMITS, isFigureId, isMoneyFigure, traceHref } from './figures';
import { isUuid, normaliseFilters } from './filters';
import {
  selectActiveBranches,
  selectFigureByBranch,
  selectFigureCollections,
  selectFigureReports,
  selectFigureTotals,
  selectReportFigure,
  selectSubmittedReportCounts,
  type FigureTotals,
  type KpiFilters,
} from './repo-kpi';
import {
  collectionContributes,
  selectBranchHeader,
  selectBranchHeaders,
  selectCollectionDetail,
  selectReportEvents,
  selectReportHeaderPeople,
  selectSubmittedReports,
} from './repo-trace';
import { withReadSnapshot } from './service-dashboard';
import { buildTrail } from './trace-trail';
import type {
  BranchFigureRow,
  BranchHeader,
  BranchReportsLevel,
  CollectionDetail,
  CollectionEvidence,
  CollectionFigureRow,
  ReportCollectionsLevel,
  ReportEventRow,
  ReportFigureRow,
  ReportHeader,
  TraceLevel,
  TraceLevelName,
  TrailStep,
} from './trace-types';
import type {
  Explanation,
  FigureId,
  FigureMeasure,
  MoneyFigureId,
  ReportingFilters,
} from './types';

type TracedFigure = Exclude<FigureId, 'active_branches'>;

/** Authorize first (so other roles always get 403), then reject unknown figures as NotFound. */
function authorizeTrace(actor: Actor, figure: FigureId): Scope {
  const scope = authorize(actor, 'trace.read');
  if (!isFigureId(figure)) throw new NotFound();
  return scope;
}

/** Below L1 only the month filter applies: the branch in the path replaces `branch`. */
function pathFilters(filters: ReportingFilters): ReportingFilters {
  const f = normaliseFilters(filters);
  const out: ReportingFilters = {};
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  return out;
}

function sameValue(measure: FigureMeasure, a: string, b: string): boolean {
  return measure === 'amount' ? compareMoney(a, b) === 0 : a === b;
}

/** The dashboard value of a figure, as the overview step of the trail shows it. */
function overviewValue(totals: FigureTotals, figure: FigureId): string {
  return isMoneyFigure(figure) ? totals.money[figure].value : String(totals.counts[figure]);
}

function capRows<R>(rows: R[]): { rows: R[]; truncated: { shown: number } | null } {
  const max = REPORTING_LIMITS.traceMaxRows;
  if (rows.length <= max) return { rows, truncated: null };
  return { rows: rows.slice(0, max), truncated: { shown: max } };
}

function buildLevel<R>(input: {
  figure: FigureId;
  measure: FigureMeasure;
  level: TraceLevelName;
  parentValue: string;
  rows: R[];
  truncated: { shown: number } | null;
  total: string;
  recordCount: number;
  /** Extra cross-checks (record counts, independent sums) that must also hold. */
  consistent: boolean;
  filters: Explanation['filters'];
  asOf: string;
  trail: TrailStep[];
}): TraceLevel<R> {
  const explainLevel: Explanation['level'] = input.level;
  return {
    figure: input.figure,
    slug: FIGURES[input.figure].slug,
    measure: input.measure,
    level: input.level,
    parentValue: input.parentValue,
    rows: input.rows,
    total: input.total,
    recordCount: input.recordCount,
    matchesParent: input.consistent && sameValue(input.measure, input.total, input.parentValue),
    truncated: input.truncated,
    explain: {
      figure: input.figure,
      level: explainLevel,
      filters: input.filters,
      recordCount: input.recordCount,
      value: input.total,
      asOf: input.asOf,
    },
    asOf: input.asOf,
    trail: input.trail,
  };
}

/** L1: the figure split by branch. Only contributing branches are listed. */
export async function getFigureByBranch(
  db: Queryable,
  actor: Actor,
  figure: FigureId,
  filters: ReportingFilters,
): Promise<TraceLevel<BranchFigureRow>> {
  const scope = authorizeTrace(actor, figure);
  const f = normaliseFilters(filters);
  const measure = FIGURES[figure].measure;

  return withReadSnapshot(db, async (q) => {
    const totals = await selectFigureTotals(q, scope, f);
    const parentValue = overviewValue(totals, figure);
    let all: BranchFigureRow[];
    let total: string;
    let consistent = true;

    if (isMoneyFigure(figure)) {
      const rows = await selectFigureByBranch(q, scope, figure, f);
      all = rows.map((r) => ({
        branchId: r.branchId,
        branchCode: r.branchCode,
        branchName: r.branchName,
        branchStatus: r.branchStatus,
        value: r.value,
        recordCount: r.recordCount,
        reportCount: r.reportCount,
        href: traceHref(figure, { branchId: r.branchId }, f),
      }));
      total = sumMoney(all.map((r) => r.value));
      consistent = all.reduce((n, r) => n + r.recordCount, 0) === totals.money[figure].recordCount;
    } else if (figure === 'reports_awaiting_review') {
      const counts = await selectSubmittedReportCounts(q, scope, f);
      const headers = await selectBranchHeaders(
        q,
        scope,
        counts.map((c) => c.branchId),
      );
      all = counts.map((c) => {
        const header = headers.get(c.branchId);
        if (!header) throw new Error('trace: counted branch is not readable');
        return {
          branchId: c.branchId,
          branchCode: c.branchCode,
          branchName: c.branchName,
          branchStatus: header.branchStatus,
          value: String(c.count),
          recordCount: c.count,
          reportCount: c.count,
          href: traceHref(figure, { branchId: c.branchId }, f),
        };
      });
      total = String(all.reduce((n, r) => n + r.recordCount, 0));
    } else {
      const active = await selectActiveBranches(q, scope, f);
      const approved = new Map(
        (await selectFigureByBranch(q, scope, 'approved', f)).map((r) => [r.branchId, r]),
      );
      all = active.map((b) => ({
        branchId: b.branchId,
        branchCode: b.branchCode,
        branchName: b.branchName,
        branchStatus: 'active',
        value: '1',
        recordCount: 1,
        reportCount: approved.get(b.branchId)?.reportCount ?? 0,
        href: traceHref('approved', { branchId: b.branchId }, f),
      }));
      total = String(all.length);
    }

    const { rows, truncated } = capRows(all);
    return buildLevel({
      figure,
      measure,
      level: 'branches',
      parentValue,
      rows,
      truncated,
      total,
      recordCount: all.length,
      consistent,
      filters: f,
      asOf: totals.asOf,
      trail: buildTrail({ figure, filters: f, overview: parentValue }),
    });
  });
}

/** The branch's value for the figure (its L1 row), read independently of the L2 rows. */
async function branchFigureValue(
  q: Queryable,
  scope: Scope,
  figure: TracedFigure,
  branchId: string,
  f: ReportingFilters,
): Promise<{ value: string; recordCount: number; amount: string }> {
  if (isMoneyFigure(figure)) {
    const row = (await selectFigureByBranch(q, scope, figure, { ...f, branch: branchId })).find(
      (r) => r.branchId === branchId,
    );
    return {
      value: row?.value ?? '0.00',
      recordCount: row?.recordCount ?? 0,
      amount: row?.value ?? '0.00',
    };
  }
  const row = (await selectSubmittedReportCounts(q, scope, { ...f, branch: branchId })).find(
    (r) => r.branchId === branchId,
  );
  return {
    value: String(row?.count ?? 0),
    recordCount: row?.count ?? 0,
    amount: row?.value ?? '0.00',
  };
}

/** The reports behind a branch's value, with the report amount each contributes. */
async function branchReportRows(
  q: Queryable,
  scope: Scope,
  figure: TracedFigure,
  branchId: string,
  f: ReportingFilters,
): Promise<ReportFigureRow[]> {
  const href = (reportId: string) => traceHref(figure, { branchId, reportId }, f);
  if (isMoneyFigure(figure)) {
    const rows = await selectFigureReports(q, scope, figure, { ...f, branchId });
    return rows.map((r) => {
      if (r.branchId !== branchId) throw new Error('trace: report outside its branch');
      return {
        reportId: r.reportId,
        weekStart: r.weekStart,
        weekEnd: addDays(r.weekStart, 6),
        status: r.status,
        value: r.value,
        recordCount: r.recordCount,
        frozenAmount: r.frozenAmount,
        frozenCount: r.frozenCount,
        submittedAt: r.submittedAt,
        reviewedAt: r.reviewedAt,
        href: href(r.reportId),
      };
    });
  }
  const rows = await selectSubmittedReports(q, scope, { ...f, branchId });
  return rows.map((r) => ({
    reportId: r.reportId,
    weekStart: r.weekStart,
    weekEnd: addDays(r.weekStart, 6),
    status: r.status,
    value: r.liveAmount,
    recordCount: r.liveCount,
    frozenAmount: r.frozenAmount,
    frozenCount: r.frozenCount,
    submittedAt: r.submittedAt,
    reviewedAt: r.reviewedAt,
    href: href(r.reportId),
  }));
}

function tracedFigure(figure: FigureId): TracedFigure {
  if (figure === 'active_branches') throw new NotFound();
  return figure;
}

/** L2: the reports behind one branch's value. */
export async function getBranchReports(
  db: Queryable,
  actor: Actor,
  figure: FigureId,
  branchId: string,
  filters: ReportingFilters,
): Promise<BranchReportsLevel> {
  const scope = authorizeTrace(actor, figure);
  const traced = tracedFigure(figure);
  const f = pathFilters(filters);
  const measure = FIGURES[traced].measure;

  return withReadSnapshot(db, async (q) => {
    const branch: BranchHeader = await selectBranchHeader(q, scope, branchId);
    const id = branch.branchId;
    const totals = await selectFigureTotals(q, scope, f);
    const parent = await branchFigureValue(q, scope, traced, id, f);
    const all = await branchReportRows(q, scope, traced, id, f);

    let total: string;
    let consistent: boolean;
    if (measure === 'amount') {
      total = sumMoney(all.map((r) => r.value));
      consistent = all.reduce((n, r) => n + r.recordCount, 0) === parent.recordCount;
    } else {
      total = String(all.length);
      // The submitted reports' amounts add up to the branch's awaiting amount.
      consistent = compareMoney(sumMoney(all.map((r) => r.value)), parent.amount) === 0;
    }

    const { rows, truncated } = capRows(all);
    const level = buildLevel({
      figure: traced,
      measure,
      level: 'reports',
      parentValue: parent.value,
      rows,
      truncated,
      total,
      recordCount: all.length,
      consistent,
      filters: { ...f, branchId: id },
      asOf: totals.asOf,
      trail: buildTrail({
        figure: traced,
        filters: f,
        overview: overviewValue(totals, traced),
        branch: { id, code: branch.branchCode, name: branch.branchName, value: parent.value },
      }),
    });
    return { ...level, branch };
  });
}

/** Everything a level below the report needs: the proven path and the values along it. */
interface ReportChain {
  branch: BranchHeader;
  asOf: string;
  overview: string;
  branchValue: string;
  /** The report's L2 row: its value for the figure is the L3 parent. */
  reportRow: ReportFigureRow;
  header: ReportHeader;
  reportEvents: ReportEventRow[];
  /** Collection-level predicate: the figure itself, or pending_approval for awaiting review. */
  predicate: MoneyFigureId;
  /**
   * Collection filters. Money figures keep the month filter on collected_on; reports
   * awaiting review filter months on week_start, which the report already satisfied at L2,
   * so all of its collections count.
   */
  collectionFilters: KpiFilters & { branchId: string; reportId: string };
}

/** Frozen totals bind only once a report is submitted; null before that or after a return. */
function frozenMatchesLive(live: {
  status: string;
  frozenAmount: string | null;
  frozenCount: number | null;
  liveAmount: string;
  liveCount: number;
}): boolean | null {
  if (live.status !== 'submitted' && live.status !== 'approved') return null;
  if (live.frozenAmount === null || live.frozenCount === null) return false;
  return (
    compareMoney(live.frozenAmount, live.liveAmount) === 0 && live.frozenCount === live.liveCount
  );
}

/**
 * Proves branch -> report for the figure and filters: the report must be one of the rows
 * the branch's L2 level lists. Anything else is NotFound.
 */
async function resolveReportChain(
  q: Queryable,
  scope: Scope,
  figure: TracedFigure,
  branchId: string,
  reportId: string,
  f: ReportingFilters,
): Promise<ReportChain> {
  if (!isUuid(reportId)) throw new NotFound();
  const branch = await selectBranchHeader(q, scope, branchId);
  const id = branch.branchId;
  const rid = reportId.toLowerCase();
  const reportRow = (await branchReportRows(q, scope, figure, id, f)).find(
    (r) => r.reportId === rid,
  );
  if (!reportRow) throw new NotFound();

  const totals = await selectFigureTotals(q, scope, f);
  const parent = await branchFigureValue(q, scope, figure, id, f);
  const live = await selectReportFigure(q, scope, rid);
  if (!live || live.branchId !== id) throw new NotFound();
  const people = await selectReportHeaderPeople(q, rid);
  const reportEvents = await selectReportEvents(q, rid);
  const predicate = FIGURES[figure].collectionPredicate;
  if (!predicate) throw new NotFound();

  return {
    branch,
    asOf: totals.asOf,
    overview: overviewValue(totals, figure),
    branchValue: parent.value,
    reportRow,
    header: {
      reportId: rid,
      weekStart: live.weekStart,
      weekEnd: addDays(live.weekStart, 6),
      status: live.status,
      liveAmount: live.liveAmount,
      liveCount: live.liveCount,
      frozenAmount: live.frozenAmount,
      frozenCount: live.frozenCount,
      frozenMatchesLive: frozenMatchesLive(live),
      submittedAt: live.submittedAt,
      submittedByName: people?.submittedByName ?? null,
      reviewedAt: live.reviewedAt,
      reviewedByName: people?.reviewedByName ?? null,
      returnReason: people?.returnReason ?? null,
    },
    reportEvents,
    predicate,
    collectionFilters: isMoneyFigure(figure)
      ? { ...f, branchId: id, reportId: rid }
      : { branchId: id, reportId: rid },
  };
}

function chainTrail(
  figure: TracedFigure,
  f: ReportingFilters,
  chain: ReportChain,
  collection?: { id: string; collectedOn: string; amount: string },
): TrailStep[] {
  return buildTrail({
    figure,
    filters: f,
    overview: chain.overview,
    branch: {
      id: chain.branch.branchId,
      code: chain.branch.branchCode,
      name: chain.branch.branchName,
      value: chain.branchValue,
    },
    report: {
      id: chain.reportRow.reportId,
      weekStart: chain.reportRow.weekStart,
      value: chain.reportRow.value,
    },
    collection,
  });
}

/** L3: the collections behind one report's value. Always amounts. */
export async function getReportCollections(
  db: Queryable,
  actor: Actor,
  figure: FigureId,
  branchId: string,
  reportId: string,
  filters: ReportingFilters,
): Promise<ReportCollectionsLevel> {
  const scope = authorizeTrace(actor, figure);
  const traced = tracedFigure(figure);
  const f = pathFilters(filters);

  return withReadSnapshot(db, async (q) => {
    const chain = await resolveReportChain(q, scope, traced, branchId, reportId, f);
    const { branchId: id, reportId: rid } = chain.collectionFilters;
    const listed = await selectFigureCollections(
      q,
      scope,
      chain.predicate,
      chain.collectionFilters,
      { limit: REPORTING_LIMITS.traceMaxRows },
    );
    const truncated =
      listed.recordCount > listed.rows.length ? { shown: listed.rows.length } : null;
    const shownSum = sumMoney(listed.rows.map((r) => r.amount));
    // The footer is the sum of the rows shown; when rows are cut it is the full SQL sum.
    const total = truncated ? listed.total : shownSum;
    const consistent =
      (truncated !== null || compareMoney(shownSum, listed.total) === 0) &&
      listed.recordCount === chain.reportRow.recordCount &&
      listed.rows.every((r) => r.branchId === id && r.reportId === rid);
    const rows: CollectionFigureRow[] = listed.rows.map((r) => ({
      collectionId: r.collectionId,
      collectedOn: r.collectedOn,
      purpose: r.purpose,
      amount: r.amount,
      routedAt: r.routedAt,
      href: traceHref(traced, { branchId: id, reportId: rid, collectionId: r.collectionId }, f),
    }));

    const level = buildLevel({
      figure: traced,
      measure: 'amount',
      level: 'collections',
      parentValue: chain.reportRow.value,
      rows,
      truncated,
      total,
      recordCount: listed.recordCount,
      consistent,
      filters: { ...f, branchId: id, reportId: rid },
      asOf: chain.asOf,
      trail: chainTrail(traced, f, chain),
    });
    return {
      ...level,
      branch: chain.branch,
      report: chain.header,
      reportEvents: chain.reportEvents,
    };
  });
}

/**
 * L4: one collection as evidence, with the report header, report events and the audit
 * timelines of the collection and of the report. The collection must be one of the rows
 * the report's L3 level counts. Timelines are read after the snapshot closes.
 */
export async function getCollectionEvidence(
  db: Queryable,
  actor: Actor,
  figure: FigureId,
  branchId: string,
  reportId: string,
  collectionId: string,
  filters: ReportingFilters,
): Promise<CollectionEvidence> {
  const scope = authorizeTrace(actor, figure);
  const traced = tracedFigure(figure);
  const f = pathFilters(filters);
  if (!isUuid(collectionId)) throw new NotFound();
  const cid = collectionId.toLowerCase();

  const { chain, detail } = await withReadSnapshot(db, async (q) => {
    const proven = await resolveReportChain(q, scope, traced, branchId, reportId, f);
    const contributes = await collectionContributes(q, scope, proven.predicate, {
      ...proven.collectionFilters,
      collectionId: cid,
    });
    if (!contributes) throw new NotFound();
    const found = await selectCollectionDetail(q, scope, cid);
    if (
      !found ||
      found.branchId !== proven.collectionFilters.branchId ||
      found.reportId !== proven.collectionFilters.reportId
    ) {
      throw new NotFound();
    }
    return { chain: proven, detail: found };
  });

  const { branchId: id, reportId: rid } = chain.collectionFilters;
  const collectionTimeline = await getCollectionTimeline(db, actor, cid);
  const reportTimeline = await getReportTimeline(db, actor, rid);
  const collection: CollectionDetail = {
    collectionId: detail.collectionId,
    amount: detail.amount,
    collectedOn: detail.collectedOn,
    purpose: detail.purpose,
    status: detail.status,
    voidReason: detail.voidReason,
    routedAt: detail.routedAt,
    routedByName: detail.routedByName,
    createdAt: detail.createdAt,
    createdByName: detail.createdByName,
  };

  return {
    figure: traced,
    slug: FIGURES[traced].slug,
    branch: chain.branch,
    report: chain.header,
    reportEvents: chain.reportEvents,
    collection,
    collectionTimeline,
    reportTimeline,
    explain: {
      figure: traced,
      level: 'collection',
      filters: { ...f, branchId: id, reportId: rid, collectionId: cid },
      recordCount: 1,
      value: collection.amount,
      asOf: chain.asOf,
    },
    asOf: chain.asOf,
    trail: chainTrail(traced, f, chain, {
      id: cid,
      collectedOn: collection.collectedOn,
      amount: collection.amount,
    }),
  };
}
