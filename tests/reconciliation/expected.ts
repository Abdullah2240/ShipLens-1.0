// The reconciliation oracle: db/seed/expected.json, computed from the demo data files only
// (scripts/demo-data/expected.mjs). Its shape is read in exactly one place,
// normaliseExpected, so a change to the file format edits this module and nothing else.
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { MoneyFigureId } from '@/modules/reporting';

export const EXPECTED_FILE = new URL('../../db/seed/expected.json', import.meta.url);

export const MONEY_FIGURE_IDS = [
  'collected',
  'approved',
  'pending_approval',
  'in_progress',
  'not_yet_routed',
  'routed',
] as const satisfies readonly MoneyFigureId[];

export interface FigureExpect {
  amount: string;
  count: number;
}

export type FigureSet = Partial<Record<MoneyFigureId, FigureExpect>>;

export interface ApprovedReportExpect {
  reportId: string;
  branch: string;
  weekStart: string;
  amount: string;
  count: number;
}

export interface NormalisedExpected {
  kpis: Record<MoneyFigureId, FigureExpect> & {
    active_branches: number;
    reports_awaiting_review: number;
  };
  byBranch: Map<string, FigureSet>;
  byMonth: Map<string, FigureSet>;
  approvedReports: ApprovedReportExpect[];
  /** Draft is dropped on purpose: lazily created drafts may add to it after app use. */
  reportsByStatus: Partial<Record<'submitted' | 'returned' | 'approved', number>>;
  voided: FigureExpect;
}

const amount = z.string().regex(/^\d+\.\d{2}$/, 'must be a two-decimal amount string');
const count = z.number().int().nonnegative();
const figure = z.object({ amount, count });
const figureSet = z.object({
  collected: figure.optional(),
  approved: figure.optional(),
  pending_approval: figure.optional(),
  in_progress: figure.optional(),
  not_yet_routed: figure.optional(),
  routed: figure.optional(),
});

// Unknown keys (asOf, seed, dataDigest, reportsByStatus.draft) are accepted and dropped.
const schema = z.object({
  kpis: z.object({
    collected: figure,
    approved: figure,
    pending_approval: figure,
    in_progress: figure,
    not_yet_routed: figure,
    routed: figure,
    active_branches: count,
    reports_awaiting_review: count,
  }),
  voided: figure,
  reportsByStatus: z.object({
    submitted: count.optional(),
    returned: count.optional(),
    approved: count.optional(),
  }),
  byBranch: z.record(z.string().min(1), figureSet),
  byMonth: z.record(
    z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be a YYYY-MM month'),
    figureSet,
  ),
  approvedReports: z.array(
    z.object({
      reportId: z
        .string()
        .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a uuid'),
      branch: z.string().min(1),
      weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date'),
      amount,
      count,
    }),
  ),
});

function pathOf(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map(String).join('.');
}

function dropUndefined(set: z.infer<typeof figureSet>): FigureSet {
  const out: FigureSet = {};
  for (const id of MONEY_FIGURE_IDS) {
    const value = set[id];
    if (value) out[id] = { amount: value.amount, count: value.count };
  }
  return out;
}

/** Validates the oracle and returns it keyed for lookups. Throws naming the bad path. */
export function normaliseExpected(raw: unknown): NormalisedExpected {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${pathOf(i.path)}: ${i.message}`);
    throw new Error(`expected.json is not in the expected shape: ${problems.join('; ')}`);
  }
  const e = parsed.data;
  const reportsByStatus: NormalisedExpected['reportsByStatus'] = {};
  for (const status of ['submitted', 'returned', 'approved'] as const) {
    const value = e.reportsByStatus[status];
    if (value !== undefined) reportsByStatus[status] = value;
  }
  return {
    kpis: e.kpis,
    byBranch: new Map(Object.entries(e.byBranch).map(([k, v]) => [k, dropUndefined(v)])),
    byMonth: new Map(Object.entries(e.byMonth).map(([k, v]) => [k, dropUndefined(v)])),
    approvedReports: e.approvedReports.map((r) => ({ ...r })),
    reportsByStatus,
    voided: e.voided,
  };
}

/** Reads db/seed/expected.json from the working tree. */
export function loadExpected(): NormalisedExpected {
  return normaliseExpected(JSON.parse(readFileSync(EXPECTED_FILE, 'utf8')));
}

/** One compared value: what the oracle says against what the app returned. */
export interface DiffRow {
  figure: string;
  expected: string;
  actual: string;
}

/**
 * Collects exact string comparisons and reports every mismatch at once as a compact
 * table (figure, expected, actual), instead of stopping at the first one.
 */
type Checked = string | number | boolean | null | undefined;

export class Reconciler {
  readonly rows: DiffRow[] = [];

  check(figure: string, expected: Checked, actual: Checked): void {
    this.rows.push({ figure, expected: String(expected), actual: String(actual) });
  }

  figure(label: string, expected: FigureExpect, actual: { amount: string; count: number }): void {
    this.check(`${label} amount`, expected.amount, actual.amount);
    this.check(`${label} count`, expected.count, actual.count);
  }

  mismatches(): DiffRow[] {
    return this.rows.filter((r) => r.expected !== r.actual);
  }

  report(): string {
    const bad = this.mismatches();
    if (bad.length === 0) return `all ${this.rows.length} values match`;
    const w = [6, 8, 6].map((min, i) =>
      Math.max(min, ...bad.map((r) => [r.figure, r.expected, r.actual][i]!.length)),
    );
    const line = (a: string, b: string, c: string) =>
      `${a.padEnd(w[0]!)} | ${b.padStart(w[1]!)} | ${c.padStart(w[2]!)}`;
    return [
      `${bad.length} of ${this.rows.length} values differ from expected.json:`,
      line('figure', 'expected', 'actual'),
      ...bad.map((r) => line(r.figure, r.expected, r.actual)),
    ].join('\n');
  }
}
