// Audited CSV exports (EXP-01, EXP-02, EXP-04). The reads run through the same canonical
// queries as the dashboard and the drill-down, in one READ ONLY REPEATABLE READ snapshot.
// The export.create command then records the export at READ COMMITTED (the audit chain
// trigger must see the newest chain head after it takes its lock, which an earlier
// repeatable-read snapshot cannot), and the file is returned only after that audit row
// commits: a failed audit produces no file. The audit event records only the kind and the
// row count, never exported values.
import { randomUUID } from 'node:crypto';
import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor, type Scope } from '@/platform/authz';
import { toCsv } from '@/platform/csv';
import { NotFound, Unauthenticated } from '@/platform/errors';
import { daysBetween, pktDate } from '@/platform/time';
import {
  collectionsExport,
  exportFilename,
  isExportKind,
  reportsExport,
  summaryExport,
  unroutedExport,
  type ExportCollectionRow,
  type ExportKind,
  type ExportLabels,
} from './export-rows';
import { isMoneyFigure } from './figures';
import { normaliseFilters } from './filters';
import { selectFigureCollections, selectFigureReports, selectUnrouted } from './repo-kpi';
import { getDashboardSummary, withReadSnapshot } from './service-dashboard';
import type { MoneyFigureId, ReportingFilters } from './types';

export type { ExportKind, ExportLabels } from './export-rows';
export type ExportQuery = ReportingFilters & { figure?: MoneyFigureId; reportId?: string };
export interface ExportFile {
  filename: string;
  body: string;
  rowCount: number;
}

const DEFAULT_FIGURE: MoneyFigureId = 'approved';
// Exports are never paged: every matching row is written.
const ALL_ROWS = 2_147_483_647;

type Db = Parameters<typeof selectFigureReports>[0];
interface Built {
  body: string;
  rowCount: number;
}

async function buildSummary(
  tx: Db,
  actor: Actor,
  f: ReportingFilters,
  labels: ExportLabels,
): Promise<Built> {
  const table = summaryExport(await getDashboardSummary(tx, actor, f), labels);
  return { body: toCsv(table.columns, table.rows), rowCount: table.rows.length };
}

async function buildReports(
  tx: Db,
  scope: Scope,
  figure: MoneyFigureId,
  f: ReportingFilters,
  labels: ExportLabels,
): Promise<Built> {
  const table = reportsExport(await selectFigureReports(tx, scope, figure, f), labels);
  return { body: toCsv(table.columns, table.rows, table.footer), rowCount: table.rows.length };
}

async function buildCollections(
  tx: Db,
  scope: Scope,
  figure: MoneyFigureId,
  f: ReportingFilters,
  reportId: string | undefined,
  labels: ExportLabels,
): Promise<Built> {
  const { rows } = await selectFigureCollections(tx, scope, figure, { ...f, reportId });
  // The contributing reports carry each collection's branch and week.
  const reports = new Map(
    (await selectFigureReports(tx, scope, figure, f)).map((r) => [r.reportId, r]),
  );
  const shaped: ExportCollectionRow[] = rows.map((row) => {
    const report = reports.get(row.reportId);
    if (!report) throw new Error('export: a contributing collection has no contributing report');
    return {
      ...row,
      branchCode: report.branchCode,
      branchName: report.branchName,
      weekStart: report.weekStart,
    };
  });
  const table = collectionsExport(shaped, labels);
  return { body: toCsv(table.columns, table.rows, table.footer), rowCount: table.rows.length };
}

async function buildUnrouted(
  tx: Db,
  scope: Scope,
  f: ReportingFilters,
  today: string,
  labels: ExportLabels,
): Promise<Built> {
  const { rows } = await selectUnrouted(tx, scope, { ...f, page: 1, pageSize: ALL_ROWS });
  const table = unroutedExport(
    rows.map((row) => ({
      ...row,
      daysWaiting: daysBetween(pktDate(new Date(row.approvedAt)), today),
    })),
    labels,
  );
  return { body: toCsv(table.columns, table.rows, table.footer), rowCount: table.rows.length };
}

/**
 * One CSV export with the same filters, scope and totals as the screen it mirrors:
 * summary (dashboard figures), reports and collections contributing to a money figure
 * (default approved; collections optionally for one report), and every unrouted
 * collection. Writes exactly one export.create audit event.
 */
export async function exportCsv(
  ctx: CommandContext,
  kind: ExportKind,
  q: ExportQuery,
  labels: ExportLabels,
): Promise<ExportFile> {
  if (!ctx.actor) throw new Unauthenticated();
  const actor = ctx.actor;
  const scope = authorize(actor, 'export.create');
  if (!isExportKind(kind)) throw new NotFound();
  const figure = q.figure ?? DEFAULT_FIGURE;
  if (!isMoneyFigure(figure)) throw new NotFound();
  const f = normaliseFilters(q);
  const reportId = typeof q.reportId === 'string' ? q.reportId : undefined;
  const at = ctx.clock.now();

  // One read-only snapshot for every read in the file.
  const built = await withReadSnapshot(ctx.pool, async (snapshot): Promise<Built> => {
    switch (kind) {
      case 'summary':
        return buildSummary(snapshot, actor, f, labels);
      case 'reports':
        return buildReports(snapshot, scope, figure, f, labels);
      case 'collections':
        return buildCollections(snapshot, scope, figure, f, reportId, labels);
      case 'unrouted':
        return buildUnrouted(snapshot, scope, f, pktDate(at), labels);
    }
  });

  // Recorded at READ COMMITTED (never inside the snapshot above); no file without its row.
  await command(ctx, 'export.create', async (_tx, audit) => {
    audit({
      action: 'export.create',
      entityType: 'export',
      entityId: randomUUID(),
      after: { kind, row_count: built.rowCount },
    });
  });

  const usesFigure = kind === 'reports' || kind === 'collections';
  return {
    filename: exportFilename(kind, usesFigure ? figure : null, f, at),
    body: built.body,
    rowCount: built.rowCount,
  };
}
