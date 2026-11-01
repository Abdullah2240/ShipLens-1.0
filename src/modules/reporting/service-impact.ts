// Public impact (PUB-05): the public consumer of the reporting read model (TRC-04).
// No actor and no filters: approved money across every branch, all time, plus the
// active branch list. Served from a short in-process cache keyed by an approval
// watermark, so a new approval shows on the very next request.
import type { Queryable } from '@/platform/db';
import { systemClock, type Clock } from '@/platform/time';
import { REPORTING_LIMITS } from './figures';
import { monthsBetween } from './filters';
import { selectImpactAggregates, selectImpactWatermark } from './repo-impact';
import { selectAsOf } from './repo-kpi';
import { withReadSnapshot } from './service-dashboard';

export interface PublicImpact {
  /** ISO instant of the computation (the snapshot's now()). */
  asOf: string;
  /** Equals the dashboard 'approved' figure for all time and all branches. */
  approvedTotal: string;
  /** Approved weekly reports with at least one active collection. */
  approvedReportCount: number;
  /** Distinct PKT months with approved money. */
  monthsCovered: number;
  /** Gap-filled from the first to the last approved month, ascending. */
  monthly: { month: string; approved: string }[];
  activeBranchCount: number;
  /** Ordered by city (branches without a city last), then name. */
  activeBranches: { name: string; city: string | null }[];
  cities: number;
}

interface CacheEntry {
  watermark: string;
  value: PublicImpact;
  /** Clock time of the computation, in milliseconds. */
  at: number;
}

let cache: CacheEntry | null = null;

/** Drops the cached value. Tests only. */
export function resetImpactCache(): void {
  cache = null;
}

function gapFill(rows: { month: string; approved: string }[]): PublicImpact['monthly'] {
  const first = rows[0]?.month;
  const last = rows.at(-1)?.month;
  if (!first || !last) return [];
  const byMonth = new Map(rows.map((r) => [r.month, r.approved]));
  return monthsBetween(first, last).map((month) => ({
    month,
    approved: byMonth.get(month) ?? '0.00',
  }));
}

async function compute(db: Queryable): Promise<{ watermark: string; value: PublicImpact }> {
  return withReadSnapshot(db, async (q) => {
    // The watermark is read inside the same snapshot as the figures, so the cached value
    // is never newer or older than the watermark stored with it.
    const watermark = await selectImpactWatermark(q);
    const asOf = await selectAsOf(q);
    const { monthlyRows, ...figures } = await selectImpactAggregates(q);
    const value: PublicImpact = {
      asOf,
      approvedTotal: figures.approvedTotal,
      approvedReportCount: figures.approvedReportCount,
      monthsCovered: figures.monthsCovered,
      monthly: gapFill(monthlyRows),
      activeBranchCount: figures.activeBranchCount,
      activeBranches: figures.activeBranches,
      cities: figures.cities,
    };
    return { watermark, value };
  });
}

/**
 * The public impact figures. Serves the cached value while the watermark is unchanged
 * and the value is younger than REPORTING_LIMITS.impactCacheSeconds; otherwise recomputes.
 */
export async function getPublicImpact(
  db: Queryable,
  clock: Clock = systemClock,
): Promise<PublicImpact> {
  const now = clock.now().getTime();
  const current = cache;
  if (current && now - current.at < REPORTING_LIMITS.impactCacheSeconds * 1000) {
    const watermark = await selectImpactWatermark(db);
    if (watermark === current.watermark) return current.value;
  }
  const fresh = await compute(db);
  cache = { watermark: fresh.watermark, value: fresh.value, at: now };
  return fresh.value;
}
