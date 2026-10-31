import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { Forbidden } from '@/platform/errors';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, testPool } from '../../../tests/support/db';
import {
  SCENARIO_EXPECTED,
  buildReportingScenario,
  type ReportingScenario,
} from '../../../tests/support/reporting-fixtures';
import enExports from '../../../messages/en/exports.json';
import enTrace from '../../../messages/en/trace.json';
import { flattenLabels, type ExportLabels } from './export-rows';
import { MONEY_FIGURES } from './figures';
import { exportCsv, type ExportKind, type ExportQuery } from './service-export';
import { getDashboardSummary, listUnrouted } from './service-dashboard';
import { getReportCollections } from './service-trace';

const db = testPool();
const NOW = '2026-10-31T12:00:00.000Z';
const BOM = '﻿';
let s: ReportingScenario;

const LABELS: ExportLabels = {
  ...flattenLabels(enExports.csv),
  ...Object.fromEntries(
    Object.entries(enTrace.figures).map(([id, f]) => [`figures.${id}`, f.label]),
  ),
};

const ctx = (actor: Actor): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: fixedClock(NOW),
  pool: db,
});

/** The scenario has no commas, quotes or line breaks in its text, so a plain split reads it. */
function parse(body: string): { header: string[]; rows: string[][]; footer: string[] | null } {
  expect(body.startsWith(BOM)).toBe(true);
  expect(body.endsWith('\r\n')).toBe(true);
  const lines = body.slice(1, -2).split('\r\n');
  const all = lines.map((l) => l.split(','));
  const last = all.at(-1)!;
  const hasFooter = all.length > 1 && last[0] === LABELS.total;
  return {
    header: all[0]!,
    rows: all.slice(1, hasFooter ? -1 : undefined),
    footer: hasFooter ? last : null,
  };
}

function cell(table: ReturnType<typeof parse>, row: string[], key: string): string {
  const index = table.header.indexOf(LABELS[key]!);
  expect(index, key).toBeGreaterThanOrEqual(0);
  return row[index]!;
}

async function run(kind: ExportKind, q: ExportQuery = {}, actor = s.actors.finance) {
  const file = await exportCsv(ctx(actor), kind, q, LABELS);
  return { file, table: parse(file.body) };
}

type AuditRow = {
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  branch_id: string | null;
  report_id: string | null;
  before: unknown;
  after: Record<string, unknown> | null;
};
const audits = async () =>
  (await db.query<AuditRow>('SELECT * FROM audit_events ORDER BY occurred_at, id')).rows;

beforeEach(async () => {
  await resetDb(db);
  s = await buildReportingScenario(db);
});

afterAll(async () => {
  await closeTestPool();
});

describe('summary export', () => {
  it('has one row per figure with the dashboard values', async () => {
    const { file, table } = await run('summary');
    const summary = await getDashboardSummary(db, s.actors.finance, {});
    expect(table.footer).toBeNull();
    expect(table.rows).toHaveLength(8);
    expect(file.rowCount).toBe(8);
    const byLabel = new Map(table.rows.map((r) => [r[0], r]));
    for (const figure of Object.values(summary.figures)) {
      const row = byLabel.get(LABELS[`figures.${figure.figure}`]);
      expect(row, figure.figure).toEqual([
        LABELS[`figures.${figure.figure}`],
        figure.value,
        String(figure.recordCount),
      ]);
    }
    expect(byLabel.get(LABELS['figures.approved'])?.[1]).toBe(
      SCENARIO_EXPECTED.allTime.money.approved.value,
    );
    expect(file.filename).toBe('shiplens-summary-all-all-20261031.csv');
  });

  it('follows the month and branch filters exactly as the dashboard does', async () => {
    for (const filters of [
      { from: '2026-09', to: '2026-09' },
      { branch: s.branches.a.id },
      { from: '2026-08', branch: s.branches.b.id },
    ]) {
      const { table } = await run('summary', filters);
      const summary = await getDashboardSummary(db, s.actors.finance, filters);
      for (const id of MONEY_FIGURES) {
        const row = table.rows.find((r) => r[0] === LABELS[`figures.${id}`])!;
        expect(row[1], `${id} ${JSON.stringify(filters)}`).toBe(summary.figures[id].value);
      }
    }
  });
});

describe('reports export', () => {
  it('lists the approved reports with a total equal to the approved figure', async () => {
    const { file, table } = await run('reports');
    expect(cell(table, table.footer!, 'amount')).toBe(
      SCENARIO_EXPECTED.allTime.money.approved.value,
    );
    expect(cell(table, table.footer!, 'collections')).toBe(
      String(SCENARIO_EXPECTED.allTime.money.approved.recordCount),
    );
    // The nil report has no contributing collection, so it is not listed.
    expect(table.rows.map((r) => [cell(table, r, 'branchCode'), cell(table, r, 'amount')])).toEqual(
      [
        ['BR-A', '1250.50'],
        ['BR-B', '500.00'],
      ],
    );
    expect(table.rows.every((r) => cell(table, r, 'status') === 'Approved')).toBe(true);
    expect(file.rowCount).toBe(2);
    expect(file.filename).toBe('shiplens-reports-approved-all-all-20261031.csv');
  });

  it('follows the figure and filters', async () => {
    const pending = await run('reports', { figure: 'pending_approval' });
    expect(cell(pending.table, pending.table.footer!, 'amount')).toBe('300.00');
    expect(pending.table.rows).toHaveLength(1);
    expect(cell(pending.table, pending.table.rows[0]!, 'status')).toBe('Submitted');

    const branchB = await run('reports', { branch: s.branches.b.id });
    expect(cell(branchB.table, branchB.table.footer!, 'amount')).toBe(
      SCENARIO_EXPECTED.branchB.money.approved.value,
    );
    const september = await run('reports', { from: '2026-09', to: '2026-09' });
    expect(cell(september.table, september.table.footer!, 'amount')).toBe(
      SCENARIO_EXPECTED.september.money.approved.value,
    );
  });
});

describe('collections export', () => {
  it('lists every contributing approved collection, voided excluded, with the figure total', async () => {
    const { file, table } = await run('collections');
    expect(cell(table, table.footer!, 'amount')).toBe(
      SCENARIO_EXPECTED.allTime.money.approved.value,
    );
    const ids = table.rows.map((r) => cell(table, r, 'collectionId')).sort();
    expect(ids).toEqual([s.collections.a1000, s.collections.a250, s.collections.b500].sort());
    expect(file.body).not.toContain('999.99');
    expect(file.body).not.toContain(s.collections.aVoid999);
    expect(file.rowCount).toBe(3);
    const a250 = table.rows.find((r) => r[0] === s.collections.a250)!;
    expect(cell(table, a250, 'weekStart')).toBe('2026-08-31');
    expect(cell(table, a250, 'collectedOn')).toBe('2026-09-01');
    expect(cell(table, a250, 'branchName')).toBe('Alpha');
    expect(cell(table, a250, 'routedAt')).toBe('2026-09-10T06:00:00.000Z');
  });

  it('for one report equals that report level total in the drill-down', async () => {
    const { table } = await run('collections', { reportId: s.reports.aApproved });
    const level = await getReportCollections(
      db,
      s.actors.finance,
      'approved',
      s.branches.a.id,
      s.reports.aApproved,
      {},
    );
    expect(cell(table, table.footer!, 'amount')).toBe(level.total);
    expect(level.total).toBe('1250.50');
    expect(table.rows).toHaveLength(level.recordCount);
  });

  it('follows the figure and filters', async () => {
    const september = await run('collections', { from: '2026-09', to: '2026-09' });
    expect(september.table.rows.map((r) => r[0])).toEqual([s.collections.a250]);
    expect(cell(september.table, september.table.footer!, 'amount')).toBe('250.50');

    const inProgress = await run('collections', { figure: 'in_progress' });
    expect(cell(inProgress.table, inProgress.table.footer!, 'amount')).toBe(
      SCENARIO_EXPECTED.allTime.money.in_progress.value,
    );
    const branchA = await run('collections', { figure: 'collected', branch: s.branches.a.id });
    expect(cell(branchA.table, branchA.table.footer!, 'amount')).toBe(
      SCENARIO_EXPECTED.branchA.money.collected.value,
    );
    expect(branchA.table.rows).toHaveLength(SCENARIO_EXPECTED.branchA.money.collected.recordCount);
  });

  it('an unknown or malformed report id gives an empty export with a zero total', async () => {
    for (const reportId of [randomUUID(), 'not-a-uuid']) {
      const { file, table } = await run('collections', { reportId });
      expect(table.rows).toEqual([]);
      expect(cell(table, table.footer!, 'amount')).toBe('0.00');
      expect(file.rowCount).toBe(0);
    }
  });
});

describe('unrouted export', () => {
  it('lists every unrouted row, oldest approval first, with the not yet routed total', async () => {
    const { file, table } = await run('unrouted');
    expect(cell(table, table.footer!, 'amount')).toBe(
      SCENARIO_EXPECTED.allTime.money.not_yet_routed.value,
    );
    expect(table.rows.map((r) => cell(table, r, 'amount'))).toEqual([
      ...SCENARIO_EXPECTED.unroutedAmounts,
    ]);
    // Days waiting are computed with the same clock as the on-screen list.
    const page = await listUnrouted(db, s.actors.finance, {}, fixedClock(NOW));
    expect(table.rows.map((r) => cell(table, r, 'daysWaiting'))).toEqual(
      page.items.map((i) => String(i.daysWaiting)),
    );
    expect(table.rows.map((r) => cell(table, r, 'approvedAt'))).toEqual(
      page.items.map((i) => i.approvedAt),
    );
    expect(file.rowCount).toBe(2);
  });

  it('is not paged', async () => {
    const { seedReport } = await import('../../../tests/support/finance-fixtures');
    const collections = Array.from({ length: 60 }, (_, i) => ({
      amount: '1.00',
      collectedOn: '2026-07-0' + String(1 + (i % 5)),
      purpose: 'Bulk',
      createdBy: s.users.leadB.id,
    }));
    await seedReport(db, {
      branchId: s.branches.b.id,
      weekStart: '2026-06-29',
      status: 'approved',
      submittedBy: s.users.leadB.id,
      reviewedBy: s.users.finance.id,
      collections,
    });
    const { table } = await run('unrouted');
    expect(table.rows).toHaveLength(62);
    expect(cell(table, table.footer!, 'amount')).toBe('1560.00');
  });
});

describe('export audit', () => {
  it('writes exactly one export.create event per export with kind and row count only', async () => {
    const before = (await audits()).length;
    const runs: [ExportKind, number][] = [];
    for (const kind of ['summary', 'reports', 'collections', 'unrouted'] as const) {
      runs.push([kind, (await run(kind)).file.rowCount]);
    }
    const rows = (await audits()).slice(before);
    expect(rows).toHaveLength(4);
    rows.forEach((row, i) => {
      expect(row.action).toBe('export.create');
      expect(row.entity_type).toBe('export');
      expect(row.entity_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(row.actor_id).toBe(s.users.finance.id);
      expect(row.before).toBeNull();
      expect(row.after).toEqual({ kind: runs[i]![0], row_count: runs[i]![1] });
    });
    const serialised = JSON.stringify(rows);
    for (const secret of [
      '1000.00',
      '1750.50',
      '250.50',
      'Food parcels',
      'School fees',
      'Alpha',
      'Bravo',
      'BR-A',
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it.each(['leadA', 'hrA', 'editor'] as const)(
    'is forbidden for %s and writes no audit row',
    async (who) => {
      const before = (await audits()).length;
      for (const kind of ['summary', 'reports', 'collections', 'unrouted'] as const) {
        await expect(exportCsv(ctx(s.actors[who]), kind, {}, LABELS)).rejects.toBeInstanceOf(
          Forbidden,
        );
      }
      expect((await audits()).length).toBe(before);
    },
  );

  it('allows the super admin too', async () => {
    const { file } = await run('summary', {}, s.actors.superAdmin);
    expect(file.rowCount).toBe(8);
  });
});
