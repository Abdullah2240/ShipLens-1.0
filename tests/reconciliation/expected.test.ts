// The oracle loader and the demo seeding helper the reconciliation suite stands on.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestPool, testPool } from '../support/db';
import { Reconciler, loadExpected, normaliseExpected } from './expected';
import { runDemoSeed, seedDemoDatabase } from './seed-demo';

const fig = (amount: string, count: number) => ({ amount, count });

function sample(): Record<string, unknown> {
  return {
    asOf: '2026-10-31',
    seed: 1,
    dataDigest: 'abc',
    kpis: {
      collected: fig('30.00', 3),
      approved: fig('20.00', 2),
      pending_approval: fig('5.00', 1),
      in_progress: fig('5.00', 0),
      not_yet_routed: fig('10.00', 1),
      routed: fig('10.00', 1),
      active_branches: 2,
      reports_awaiting_review: 1,
    },
    voided: fig('1.00', 1),
    reportsByStatus: { draft: 7, submitted: 1, returned: 0, approved: 2 },
    byBranch: {
      'North (Demo)': { collected: fig('30.00', 3), approved: fig('20.00', 2) },
      'Empty (Demo)': { collected: fig('0.00', 0) },
    },
    byMonth: { '2026-09': { collected: fig('30.00', 3) } },
    approvedReports: [
      {
        reportId: '0f8fad5b-d9cb-469f-a165-70867728950e',
        branch: 'North (Demo)',
        weekStart: '2026-09-07',
        amount: '20.00',
        count: 2,
      },
    ],
  };
}

describe('normaliseExpected', () => {
  it('reads the documented shape into maps keyed by branch name and month', () => {
    const e = normaliseExpected(sample());
    expect(e.kpis.approved).toEqual({ amount: '20.00', count: 2 });
    expect(e.kpis.active_branches).toBe(2);
    expect(e.kpis.reports_awaiting_review).toBe(1);
    expect(e.byBranch).toBeInstanceOf(Map);
    expect(e.byBranch.get('North (Demo)')).toEqual({
      collected: { amount: '30.00', count: 3 },
      approved: { amount: '20.00', count: 2 },
    });
    expect(e.byMonth.get('2026-09')).toEqual({ collected: { amount: '30.00', count: 3 } });
    expect(e.approvedReports).toHaveLength(1);
    expect(e.voided).toEqual({ amount: '1.00', count: 1 });
  });

  it('drops draft, asOf, seed and dataDigest', () => {
    const e = normaliseExpected(sample());
    expect(e.reportsByStatus).toEqual({ submitted: 1, returned: 0, approved: 2 });
    expect(e).not.toHaveProperty('asOf');
    expect(e).not.toHaveProperty('seed');
    expect(e).not.toHaveProperty('dataDigest');
  });

  it('rejects a file missing kpis.approved.amount and names that path', () => {
    const raw = sample();
    delete (raw.kpis as { approved: Record<string, unknown> }).approved.amount;
    expect(() => normaliseExpected(raw)).toThrow(/kpis\.approved\.amount/);
  });

  it('rejects amounts that are not two-decimal strings', () => {
    for (const bad of ['20', '20.0', '-20.00', '20.000', 20]) {
      const raw = sample();
      (raw.kpis as { routed: Record<string, unknown> }).routed.amount = bad;
      expect(() => normaliseExpected(raw), String(bad)).toThrow(/kpis\.routed\.amount/);
    }
  });

  it('rejects negative or fractional counts', () => {
    for (const bad of [-1, 1.5, '3']) {
      const raw = sample();
      (raw.byMonth as Record<string, { collected: Record<string, unknown> }>)[
        '2026-09'
      ]!.collected.count = bad;
      expect(() => normaliseExpected(raw), String(bad)).toThrow(
        /byMonth\.2026-09\.collected\.count/,
      );
    }
    const raw = sample();
    (raw.kpis as Record<string, unknown>).active_branches = -1;
    expect(() => normaliseExpected(raw)).toThrow(/kpis\.active_branches/);
  });

  it('rejects a missing section', () => {
    const raw = sample();
    delete raw.approvedReports;
    expect(() => normaliseExpected(raw)).toThrow(/approvedReports/);
  });
});

describe('Reconciler', () => {
  it('compares exact strings and lists every mismatch as figure, expected, actual', () => {
    const r = new Reconciler();
    r.figure('approved', { amount: '10.00', count: 2 }, { amount: '10.00', count: 2 });
    r.figure('routed', { amount: '10.00', count: 1 }, { amount: '10.0', count: 1 });
    r.check('active_branches', 3, '2');
    expect(r.rows).toHaveLength(5);
    expect(r.mismatches()).toEqual([
      { figure: 'routed amount', expected: '10.00', actual: '10.0' },
      { figure: 'active_branches', expected: '3', actual: '2' },
    ]);
    const report = r.report();

    expect(report.split('\n')).toEqual([
      '2 of 5 values differ from expected.json:',
      'figure          | expected | actual',
      'routed amount   |    10.00 |   10.0',
      'active_branches |        3 |      2',
    ]);
  });

  it('reports a clean run', () => {
    const r = new Reconciler();
    r.check('x', '1.00', '1.00');
    expect(r.mismatches()).toEqual([]);
    expect(r.report()).toBe('all 1 values match');
  });
});

describe('loadExpected (committed oracle)', () => {
  // Sanity only: the reconciliation tests always read the file, never these literals.
  it('loads db/seed/expected.json with the known headline values', () => {
    const e = loadExpected();
    expect(e.kpis.collected).toEqual({ amount: '5439002.59', count: 207 });
    expect(e.kpis.approved).toEqual({ amount: '4692717.65', count: 180 });
    expect([...e.byMonth.keys()].sort()).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(e.byBranch.size).toBe(6);
    expect(e.approvedReports.length).toBe(e.reportsByStatus.approved);
  });
});

describe('seedDemoDatabase', () => {
  const db = testPool();
  const TABLES = [
    'branches',
    'users',
    'teams',
    'members',
    'applications',
    'weekly_reports',
    'collections',
    'report_events',
    'audit_events',
  ] as const;

  async function counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of TABLES) {
      const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
      out[t] = rows[0]!.n;
    }
    return out;
  }

  let first: Record<string, number>;

  beforeAll(async () => {
    await seedDemoDatabase();
    first = await counts();
  }, 120_000);

  afterAll(async () => {
    await closeTestPool();
  });

  it('loads branches, users, reports and collections', () => {
    for (const t of ['branches', 'users', 'weekly_reports', 'collections'] as const) {
      expect(first[t], t).toBeGreaterThan(0);
    }
  });

  it('gives the same row counts when run again from empty', async () => {
    await seedDemoDatabase();
    expect(await counts()).toEqual(first);
  }, 120_000);

  it('changes nothing when the seed runs a second time on top', async () => {
    await runDemoSeed();
    expect(await counts()).toEqual(first);
  }, 120_000);
});
