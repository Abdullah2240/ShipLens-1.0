// Print-to-PDF for head office (EXP-03). Printing happens in the browser; the server only
// records that it happened (kind and row count, never the printed values) and serves the
// printable report from the same canonical queries as the drill-down, so a printed total
// always equals the on-screen one.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor } from '@/platform/authz';
import type { Queryable } from '@/platform/db';
import { NotFound, Unauthenticated, ValidationFailed } from '@/platform/errors';
import { compareMoney } from '@/platform/money';
import { addDays } from '@/platform/time';
import { isUuid } from './filters';
import { selectAsOf, selectFigureCollections, selectReportFigure } from './repo-kpi';
import { selectBranchHeader, selectReportEvents, selectReportHeaderPeople } from './repo-trace';
import { withReadSnapshot } from './service-dashboard';
import type { BranchHeader, ReportEventRow, ReportHeader } from './trace-types';

export const PRINT_KINDS = ['print_summary', 'print_report'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];
export const PRINT_MAX_ROWS = 100_000;

export interface PrintInput {
  kind: PrintKind;
  reportId?: string;
  rowCount: number;
}

/** POST /api/v1/exports/print body. A report print names its report; a summary print does not. */
export const printBodySchema = z
  .strictObject({
    kind: z.enum(PRINT_KINDS, { error: 'invalid_kind' }),
    reportId: z.uuid({ error: 'invalid_uuid' }).optional(),
    rowCount: z
      .number({ error: 'invalid_type' })
      .int({ error: 'invalid_type' })
      .min(0, { error: 'too_small' })
      .max(PRINT_MAX_ROWS, { error: 'too_big' }),
  })
  .refine((v) => (v.kind === 'print_report') === (v.reportId !== undefined), {
    error: 'report_id_mismatch',
    path: ['reportId'],
  });

export interface PrintableCollection {
  collectedOn: string;
  purpose: string;
  amount: string;
  routedAt: string | null;
}

export interface PrintableReport {
  branch: BranchHeader;
  report: ReportHeader;
  events: ReportEventRow[];
  collections: PrintableCollection[];
  total: string;
  count: number;
  asOf: string;
}

function invalid(path: string, code: string): ValidationFailed {
  return new ValidationFailed([{ path, code, message: code }]);
}

/**
 * Records one print as an export.create audit event (entity export, after { kind,
 * row_count }). A report print must name a report the actor can see (NotFound otherwise).
 */
export async function recordPrint(ctx: CommandContext, input: PrintInput): Promise<void> {
  if (!ctx.actor) throw new Unauthenticated();
  const scope = authorize(ctx.actor, 'export.create');
  if (!(PRINT_KINDS as readonly string[]).includes(input.kind))
    throw invalid('kind', 'invalid_kind');
  if (
    !Number.isSafeInteger(input.rowCount) ||
    input.rowCount < 0 ||
    input.rowCount > PRINT_MAX_ROWS
  ) {
    throw invalid('rowCount', 'invalid_type');
  }
  const hasReport = input.reportId !== undefined;
  if ((input.kind === 'print_report') !== hasReport)
    throw invalid('reportId', 'report_id_mismatch');

  await command(ctx, 'export.create', async (tx, audit) => {
    if (input.reportId !== undefined) {
      const report = await selectReportFigure(tx, scope, input.reportId);
      if (!report) throw new NotFound();
    }
    audit({
      action: 'export.create',
      entityType: 'export',
      entityId: randomUUID(),
      after: { kind: input.kind, row_count: input.rowCount },
    });
  });
}

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
 * One weekly report ready to print: branch, header with frozen and live totals, status
 * events in order, and every active collection (voided ones are in no figure). Read-only,
 * one snapshot, authorized as trace.read like the drill-down it mirrors.
 */
export async function getPrintableReport(
  db: Queryable,
  actor: Actor,
  reportId: string,
): Promise<PrintableReport> {
  const scope = authorize(actor, 'trace.read');
  if (!isUuid(reportId)) throw new NotFound();
  const rid = reportId.toLowerCase();

  return withReadSnapshot(db, async (q) => {
    const live = await selectReportFigure(q, scope, rid);
    if (!live) throw new NotFound();
    const branch = await selectBranchHeader(q, scope, live.branchId);
    const people = await selectReportHeaderPeople(q, rid);
    const events = await selectReportEvents(q, rid);
    const listed = await selectFigureCollections(q, scope, 'collected', {
      branchId: live.branchId,
      reportId: rid,
    });
    const asOf = await selectAsOf(q);

    const report: ReportHeader = {
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
    };
    return {
      branch,
      report,
      events,
      collections: listed.rows.map((r) => ({
        collectedOn: r.collectedOn,
        purpose: r.purpose,
        amount: r.amount,
        routedAt: r.routedAt,
      })),
      total: listed.total,
      count: listed.recordCount,
      asOf,
    };
  });
}
