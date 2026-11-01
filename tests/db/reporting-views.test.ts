import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, testPool } from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import { buildReportingScenario, type ReportingScenario } from '../support/reporting-fixtures';

const db = testPool();
let s: ReportingScenario;

beforeEach(async () => {
  await resetDb(db);
  s = await buildReportingScenario(db);
});

afterAll(async () => {
  await closeTestPool();
});

type KpiRow = {
  collection_id: string;
  amount: string;
  month: string;
  report_status: string;
  is_approved: boolean;
  is_pending_approval: boolean;
  is_in_progress: boolean;
  is_not_yet_routed: boolean;
  is_routed: boolean;
};

async function kpiRows(): Promise<KpiRow[]> {
  const { rows } = await db.query<KpiRow>(
    `SELECT collection_id, amount::text AS amount, month, report_status, is_approved,
            is_pending_approval, is_in_progress, is_not_yet_routed, is_routed
       FROM v_kpi_collections ORDER BY collection_id`,
  );
  return rows;
}

describe('v_kpi_collections', () => {
  it('excludes voided collections and includes every active one', async () => {
    const ids = (await kpiRows()).map((r) => r.collection_id);
    expect(ids).not.toContain(s.collections.aVoid999);
    expect(ids).not.toContain(s.collections.aVoid5);
    expect(ids.sort()).toEqual(
      [
        s.collections.a1000,
        s.collections.a250,
        s.collections.a300,
        s.collections.a40,
        s.collections.a10,
        s.collections.b500,
      ].sort(),
    );
  });

  it('puts every row in exactly one status bucket and splits approved rows by routing', async () => {
    const rows = await kpiRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const buckets = [r.is_approved, r.is_pending_approval, r.is_in_progress].filter(Boolean);
      expect(buckets, r.collection_id).toHaveLength(1);
      if (r.is_approved) {
        expect([r.is_routed, r.is_not_yet_routed].filter(Boolean)).toHaveLength(1);
      } else {
        expect(r.is_routed).toBe(false);
        expect(r.is_not_yet_routed).toBe(false);
      }
    }
    const routed = rows.find((r) => r.collection_id === s.collections.a250)!;
    expect(routed.is_routed).toBe(true);
    const draft = rows.find((r) => r.collection_id === s.collections.a10)!;
    expect(draft.report_status).toBe('draft');
    expect(draft.is_in_progress).toBe(true);
    const returned = rows.find((r) => r.collection_id === s.collections.a40)!;
    expect(returned.is_in_progress).toBe(true);
  });

  it('takes the month from collected_on, not from week_start', async () => {
    const rows = await kpiRows();
    expect(rows.find((r) => r.collection_id === s.collections.a1000)!.month).toBe('2026-08');
    expect(rows.find((r) => r.collection_id === s.collections.a250)!.month).toBe('2026-09');
  });
});

describe('v_report_figures', () => {
  it('has one row per report with live totals over active collections', async () => {
    const { rows } = await db.query<{
      report_id: string;
      status: string;
      frozen_amount: string | null;
      frozen_count: number | null;
      live_amount: string;
      live_count: number;
    }>(
      `SELECT report_id, status, frozen_amount::text AS frozen_amount, frozen_count,
              live_amount::text AS live_amount, live_count
         FROM v_report_figures`,
    );
    expect(rows).toHaveLength(6);
    const byId = new Map(rows.map((r) => [r.report_id, r]));
    expect(byId.get(s.reports.aApproved)).toMatchObject({
      status: 'approved',
      live_amount: '1250.50',
      live_count: 2,
      frozen_amount: '1250.50',
      frozen_count: 2,
    });
    expect(byId.get(s.reports.aReturned)).toMatchObject({ live_amount: '40.25', live_count: 1 });
    expect(byId.get(s.reports.aDraft)).toMatchObject({
      live_amount: '10.00',
      live_count: 1,
      frozen_amount: null,
      frozen_count: null,
    });
    expect(byId.get(s.reports.bNil)).toMatchObject({
      status: 'approved',
      live_amount: '0.00',
      live_count: 0,
    });
  });

  it('gives 0.00 and 0 for a fresh draft without collections', async () => {
    const empty = await seedReport(db, { branchId: s.branches.c.id, weekStart: '2026-10-12' });
    const { rows } = await db.query<{ live_amount: string; live_count: number }>(
      'SELECT live_amount::text AS live_amount, live_count FROM v_report_figures WHERE report_id = $1',
      [empty.reportId],
    );
    expect(rows).toEqual([{ live_amount: '0.00', live_count: 0 }]);
  });
});
