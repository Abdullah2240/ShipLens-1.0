import type { Pool, PoolClient } from 'pg';
import type { ReportStatus } from '@/platform/config/constants';
import { sumMoney, type MoneyString } from '@/platform/money';
import type { DateString } from '@/platform/time';

// Builds weekly reports and collections in any lifecycle state without fighting the
// database guards: the report starts as a draft, collections go in, then the status
// moves along the allowed transitions. Fixtures only: no audit_events, no report_events.

export interface FixtureCollection {
  amount: string;
  collectedOn?: DateString;
  purpose?: string;
  status?: 'active' | 'voided';
  createdBy: string;
  routedAt?: string | null;
}

export interface SeedReportOptions {
  branchId: string;
  weekStart: DateString;
  status?: ReportStatus;
  submittedBy?: string;
  reviewedBy?: string;
  collections?: FixtureCollection[];
  returnReason?: string;
}

export interface SeededReport {
  reportId: string;
  collectionIds: string[];
  total: MoneyString;
  count: number;
}

const DEFAULT_PURPOSE = 'Fixture purpose';
const DEFAULT_VOID_REASON = 'Fixture void';
const DEFAULT_RETURN_REASON = 'Fixture return';

type Db = Pick<PoolClient, 'query'>;

async function insertCollection(
  db: Db,
  opts: Omit<FixtureCollection, 'collectedOn'> & {
    branchId: string;
    reportId: string;
    collectedOn: DateString | null;
  },
): Promise<string> {
  const voided = opts.status === 'voided';
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO collections
       (branch_id, report_id, amount, collected_on, purpose, status, void_reason, voided_at, voided_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $8::boolean THEN now() END, $9, $10)
     RETURNING id`,
    [
      opts.branchId,
      opts.reportId,
      opts.amount,
      opts.collectedOn,
      opts.purpose ?? DEFAULT_PURPOSE,
      voided ? 'voided' : 'active',
      voided ? DEFAULT_VOID_REASON : null,
      voided,
      voided ? opts.createdBy : null,
      opts.createdBy,
    ],
  );
  return rows[0]!.id;
}

/** Insert a report in the requested status, with its collections, in one transaction. */
export async function seedReport(p: Pool, opts: SeedReportOptions): Promise<SeededReport> {
  const status: ReportStatus = opts.status ?? 'draft';
  const collections = opts.collections ?? [];

  if (status !== 'draft' && !opts.submittedBy) {
    throw new Error(`seedReport: submittedBy is required for status ${status}`);
  }
  if ((status === 'returned' || status === 'approved') && !opts.reviewedBy) {
    throw new Error(`seedReport: reviewedBy is required for status ${status}`);
  }
  if (status !== 'approved' && collections.some((c) => c.routedAt != null)) {
    throw new Error('seedReport: routedAt is only allowed on an approved report');
  }

  const active = collections.filter((c) => (c.status ?? 'active') === 'active');
  const total = sumMoney(active.map((c) => c.amount));
  const count = active.length;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, $2) RETURNING id',
      [opts.branchId, opts.weekStart],
    );
    const reportId = rows[0]!.id;

    const collectionIds: string[] = [];
    for (const c of collections) {
      collectionIds.push(
        await insertCollection(client, {
          ...c,
          branchId: opts.branchId,
          reportId,
          collectedOn: c.collectedOn ?? opts.weekStart,
        }),
      );
    }

    if (status !== 'draft') {
      await client.query(
        `UPDATE weekly_reports
            SET status = 'submitted', submitted_at = now(), submitted_by = $2,
                total_amount = $3, collection_count = $4, version = version + 1, updated_at = now()
          WHERE id = $1`,
        [reportId, opts.submittedBy, total, count],
      );
    }
    if (status === 'returned') {
      await client.query(
        `UPDATE weekly_reports
            SET status = 'returned', return_reason = $2, reviewed_at = now(), reviewed_by = $3,
                version = version + 1, updated_at = now()
          WHERE id = $1`,
        [reportId, opts.returnReason ?? DEFAULT_RETURN_REASON, opts.reviewedBy],
      );
    }
    if (status === 'approved') {
      await client.query(
        `UPDATE weekly_reports
            SET status = 'approved', reviewed_at = now(), reviewed_by = $2, version = version + 1, updated_at = now()
          WHERE id = $1`,
        [reportId, opts.reviewedBy],
      );
      for (const [i, c] of collections.entries()) {
        if (c.routedAt == null) continue;
        await client.query(
          'UPDATE collections SET routed_at = $2, routed_by = $3, updated_at = now() WHERE id = $1',
          [collectionIds[i], c.routedAt, opts.reviewedBy],
        );
      }
    }

    await client.query('COMMIT');
    return { reportId, collectionIds, total, count };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Insert one collection into an existing draft or returned report. collectedOn defaults to its week_start. */
export async function seedCollection(
  p: Pool,
  opts: FixtureCollection & { branchId: string; reportId: string },
): Promise<string> {
  if (opts.routedAt != null) {
    throw new Error(
      'seedCollection: a new collection cannot be routed; use seedReport with status approved',
    );
  }
  let collectedOn = opts.collectedOn ?? null;
  if (!collectedOn) {
    const { rows } = await p.query<{ week_start: DateString }>(
      'SELECT week_start::text AS week_start FROM weekly_reports WHERE id = $1',
      [opts.reportId],
    );
    collectedOn = rows[0]?.week_start ?? null;
  }
  return insertCollection(p, { ...opts, collectedOn });
}
