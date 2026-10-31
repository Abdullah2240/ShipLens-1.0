// Public impact read model (PUB-05). Aggregates only: approved money from the shared view
// and the name and city of active branches. No per-row money, no people, no contact data,
// no figure other than approved is ever selected here (a unit test scans this file).
// Public by definition, so there is no Scope: every branch counts.
import type { Queryable } from '@/platform/db';

export interface ImpactMonthRow {
  month: string;
  approved: string;
}

export interface ImpactAggregates {
  approvedTotal: string;
  approvedReportCount: number;
  monthsCovered: number;
  activeBranchCount: number;
  activeBranches: { name: string; city: string | null }[];
  cities: number;
  monthlyRows: ImpactMonthRow[];
}

/**
 * Changes whenever a report is approved (count and latest review instant) or a branch
 * changes (latest update instant, active count). One small aggregate per table.
 */
export async function selectImpactWatermark(db: Queryable): Promise<string> {
  const { rows } = await db.query<{ watermark: string }>(
    `SELECT concat_ws(':',
              r.n::text, COALESCE(r.latest::text, '-'),
              b.n::text, COALESCE(b.latest::text, '-')) AS watermark
       FROM (SELECT count(*) AS n, max(reviewed_at) AS latest
               FROM weekly_reports WHERE status = 'approved') r,
            (SELECT count(*) FILTER (WHERE status = 'active') AS n, max(updated_at) AS latest
               FROM branches) b`,
  );
  return rows[0]!.watermark;
}

/** Every public figure, from the approved predicate of v_kpi_collections only. */
export async function selectImpactAggregates(db: Queryable): Promise<ImpactAggregates> {
  const totals = await db.query<{ total: string; reports: number; months: number }>(
    `SELECT COALESCE(SUM(k.amount), 0)::numeric(14,2)::text AS total,
            count(DISTINCT k.report_id)::int AS reports,
            count(DISTINCT k.month)::int AS months
       FROM v_kpi_collections k
      WHERE k.is_approved`,
  );
  const monthly = await db.query<ImpactMonthRow>(
    `SELECT k.month, COALESCE(SUM(k.amount), 0)::numeric(14,2)::text AS approved
       FROM v_kpi_collections k
      WHERE k.is_approved
      GROUP BY k.month
      ORDER BY k.month`,
  );
  const branches = await db.query<{ name: string; city: string | null }>(
    `SELECT b.name, NULLIF(btrim(b.city), '') AS city
       FROM branches b
      WHERE b.status = 'active'
      ORDER BY NULLIF(btrim(b.city), '') NULLS LAST, b.name, b.id`,
  );
  const row = totals.rows[0]!;
  const cities = new Set(branches.rows.flatMap((b) => (b.city ? [b.city] : []))).size;
  return {
    approvedTotal: row.total,
    approvedReportCount: row.reports,
    monthsCovered: row.months,
    activeBranchCount: branches.rows.length,
    activeBranches: branches.rows.map((b) => ({ name: b.name, city: b.city })),
    cities,
    monthlyRows: monthly.rows.map((m) => ({ month: m.month, approved: m.approved })),
  };
}
