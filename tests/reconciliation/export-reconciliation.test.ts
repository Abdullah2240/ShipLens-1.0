// EXP totals on the real demo data: every CSV export's total row equals the on-screen
// figure, and the on-screen figure equals db/seed/expected.json. Each file is parsed as
// RFC 4180 text, so quoted purposes or names cannot shift a column.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDashboardSummary, type FigureId } from '@/modules/reporting';
import { flattenLabels, type ExportLabels } from '@/modules/reporting/export-rows';
import { exportCsv, type ExportKind, type ExportQuery } from '@/modules/reporting/service-export';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { fixedClock } from '@/platform/time';
import enExports from '../../messages/en/exports.json';
import enTrace from '../../messages/en/trace.json';
import { closeTestPool, testPool } from '../support/db';
import { MONEY_FIGURE_IDS, Reconciler, loadExpected } from './expected';
import { demoActor, seedDemoDatabase } from './seed-demo';

const db = testPool();
const expected = loadExpected();
const BOM = '﻿';

// Built the same way as the export route builds them.
const LABELS: ExportLabels = {
  ...flattenLabels(enExports.csv),
  ...Object.fromEntries(
    Object.entries(enTrace.figures).map(([id, f]) => [`figures.${id}`, f.label]),
  ),
};

let admin: Actor;
let finance: Actor;

beforeAll(async () => {
  await seedDemoDatabase();
  admin = await demoActor('admin@shiplens.test');
  finance = await demoActor('finance@shiplens.test');
}, 120_000);

afterAll(async () => {
  await closeTestPool();
});

/** RFC 4180: CRLF records, quoted fields with doubled quotes, separators inside quotes. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        quoted = false;
        i += 1;
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === ',') {
      record.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' && text[i + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 2;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field !== '' || record.length > 0) throw new Error('CSV does not end with CRLF');
  return records;
}

interface Table {
  header: string[];
  rows: string[][];
  footer: string[] | null;
}

function readTable(body: string): Table {
  expect(body.startsWith(BOM)).toBe(true);
  const records = parseCsv(body.slice(BOM.length));
  const header = records[0]!;
  for (const rec of records) expect(rec).toHaveLength(header.length);
  const last = records.at(-1)!;
  const hasFooter = records.length > 1 && last[0] === LABELS.total;
  return {
    header,
    rows: records.slice(1, hasFooter ? -1 : undefined),
    footer: hasFooter ? last : null,
  };
}

function col(table: Table, key: string): number {
  const index = table.header.indexOf(LABELS[key]!);
  expect(index, `column ${key}`).toBeGreaterThanOrEqual(0);
  return index;
}

async function exportCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_events WHERE action = 'export.create'`,
  );
  return rows[0]!.n;
}

/** One export with a fresh command context, checking it wrote exactly one audit row. */
async function run(kind: ExportKind, q: ExportQuery = {}) {
  const before = await exportCount();
  const ctx: CommandContext = {
    actor: finance,
    requestId: randomUUID(),
    clock: fixedClock('2026-11-01T06:00:00.000Z'),
    pool: db,
  };
  const file = await exportCsv(ctx, kind, q, LABELS);
  expect(await exportCount(), `${kind} export.create rows`).toBe(before + 1);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_events WHERE action = 'export.create' AND request_id = $1`,
    [ctx.requestId],
  );
  expect(rows[0]!.n, `${kind} audit row for this request`).toBe(1);
  const table = readTable(file.body);
  expect(file.rowCount).toBe(table.rows.length);
  return table;
}

function expectReconciled(r: Reconciler): void {
  expect(r.rows.length).toBeGreaterThan(0);
  expect(r.mismatches(), r.report()).toEqual([]);
}

describe('CSV parser', () => {
  it('reads quoted fields with commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b,1","c ""q""","d\r\ne"\r\n,x\r\n')).toEqual([
      ['a', 'b,1', 'c "q"', 'd\r\ne'],
      ['', 'x'],
    ]);
  });
});

describe('exports on the demo data', () => {
  it('summary CSV values equal the dashboard summary and the oracle', async () => {
    const summary = await getDashboardSummary(db, admin, {});
    const table = await run('summary');
    expect(table.footer).toBeNull();
    const byLabel = new Map(table.rows.map((row) => [row[col(table, 'figure')]!, row]));
    const r = new Reconciler();
    r.check('summary rows', Object.keys(summary.figures).length, table.rows.length);
    for (const id of Object.keys(summary.figures) as FigureId[]) {
      const row = byLabel.get(LABELS[`figures.${id}`]!);
      r.check(
        `summary ${id} value = screen`,
        summary.figures[id].value,
        row?.[col(table, 'value')],
      );
      r.check(
        `summary ${id} records = screen`,
        summary.figures[id].recordCount,
        row?.[col(table, 'records')],
      );
    }
    for (const id of MONEY_FIGURE_IDS) {
      const row = byLabel.get(LABELS[`figures.${id}`]!);
      r.check(
        `summary ${id} value = expected`,
        expected.kpis[id].amount,
        row?.[col(table, 'value')],
      );
      r.check(
        `summary ${id} records = expected`,
        expected.kpis[id].count,
        row?.[col(table, 'records')],
      );
    }
    r.check(
      'summary active_branches = expected',
      expected.kpis.active_branches,
      byLabel.get(LABELS['figures.active_branches']!)?.[col(table, 'value')],
    );
    r.check(
      'summary reports_awaiting_review = expected',
      expected.kpis.reports_awaiting_review,
      byLabel.get(LABELS['figures.reports_awaiting_review']!)?.[col(table, 'value')],
    );
    expectReconciled(r);
  });

  it('reports CSV total row equals each money figure (approved: kpis.approved)', async () => {
    const r = new Reconciler();
    for (const figure of MONEY_FIGURE_IDS) {
      const table = await run('reports', { figure });
      const want = expected.kpis[figure];
      r.check(`reports ${figure} total amount`, want.amount, table.footer?.[col(table, 'amount')]);
      r.check(
        `reports ${figure} total collections`,
        want.count,
        table.footer?.[col(table, 'collections')],
      );
      const rowCollections = table.rows.reduce(
        (n, row) => n + Number(row[col(table, 'collections')]),
        0,
      );
      r.check(`reports ${figure} collections over rows`, want.count, rowCollections);
    }
    const approved = await run('reports', { figure: 'approved' });
    const withMoney = expected.approvedReports.filter((e) => e.count > 0);
    r.check(
      'reports approved rows = approved reports with collections',
      withMoney.length,
      approved.rows.length,
    );
    expectReconciled(r);
  });

  it('collections CSV has one row per counted collection and its total equals the figure', async () => {
    const r = new Reconciler();
    for (const figure of MONEY_FIGURE_IDS) {
      const table = await run('collections', { figure });
      const want = expected.kpis[figure];
      r.check(`collections ${figure} data rows`, want.count, table.rows.length);
      r.check(
        `collections ${figure} total amount`,
        want.amount,
        table.footer?.[col(table, 'amount')],
      );
      const ids = new Set(table.rows.map((row) => row[col(table, 'collectionId')]));
      r.check(`collections ${figure} distinct ids`, want.count, ids.size);
    }
    expectReconciled(r);
  });

  it('collections CSV for one approved report equals that report in the oracle', async () => {
    const r = new Reconciler();
    for (const e of expected.approvedReports) {
      const table = await run('collections', { figure: 'approved', reportId: e.reportId });
      r.check(`report ${e.reportId} rows`, e.count, table.rows.length);
      r.check(`report ${e.reportId} total`, e.amount, table.footer?.[col(table, 'amount')]);
    }
    expectReconciled(r);
  });

  it('unrouted CSV total equals kpis.not_yet_routed', async () => {
    const table = await run('unrouted');
    const r = new Reconciler();
    r.check(
      'unrouted total amount',
      expected.kpis.not_yet_routed.amount,
      table.footer?.[col(table, 'amount')],
    );
    r.check('unrouted data rows', expected.kpis.not_yet_routed.count, table.rows.length);
    expectReconciled(r);
  });

  it('each month filter gives reports and collections totals equal to expected.byMonth', async () => {
    const r = new Reconciler();
    for (const [month, set] of expected.byMonth) {
      for (const figure of MONEY_FIGURE_IDS) {
        const want = set[figure] ?? { amount: '0.00', count: 0 };
        const q = { figure, from: month, to: month };
        const reports = await run('reports', q);
        r.check(
          `${month} reports ${figure} total`,
          want.amount,
          reports.footer?.[col(reports, 'amount')],
        );
        const collections = await run('collections', q);
        r.check(`${month} collections ${figure} rows`, want.count, collections.rows.length);
        r.check(
          `${month} collections ${figure} total`,
          want.amount,
          collections.footer?.[col(collections, 'amount')],
        );
      }
    }
    expectReconciled(r);
  }, 600_000);
});
