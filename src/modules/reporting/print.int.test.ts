import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { Forbidden, NotFound, ValidationFailed } from '@/platform/errors';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, testPool } from '../../../tests/support/db';
import {
  buildReportingScenario,
  type ReportingScenario,
} from '../../../tests/support/reporting-fixtures';
import { getPrintableReport, recordPrint } from './service-print';
import { getReportCollections } from './service-trace';

const db = testPool();
const NOW = '2026-10-31T12:00:00.000Z';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RANDOM_UUID = '0f0f0f0f-0000-4000-8000-000000000000';
let s: ReportingScenario;

const ctx = (actor: Actor): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: fixedClock(NOW),
  pool: db,
});

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

/** Report events written the way the report service writes them, at fixed instants. */
async function seedReportEvents(reportId: string) {
  await db.query(
    `INSERT INTO report_events (report_id, event_type, from_status, to_status, actor_id, reason, occurred_at)
     VALUES ($1, 'submitted', 'draft', 'submitted', $2, NULL, '2026-09-07T05:00:00Z'),
            ($1, 'approved', 'submitted', 'approved', $3, NULL, '2026-09-08T05:00:00Z')`,
    [reportId, s.users.leadA.id, s.users.finance.id],
  );
}

beforeEach(async () => {
  await resetDb(db);
  s = await buildReportingScenario(db);
});

afterAll(async () => {
  await closeTestPool();
});

describe('recordPrint', () => {
  it('writes one export.create event with the kind and row count only', async () => {
    const before = (await audits()).length;
    await recordPrint(ctx(s.actors.finance), {
      kind: 'print_report',
      reportId: s.reports.aApproved,
      rowCount: 3,
    });
    const rows = (await audits()).slice(before);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('export.create');
    expect(row.entity_type).toBe('export');
    expect(row.entity_id).toMatch(UUID4);
    expect(row.actor_id).toBe(s.users.finance.id);
    expect(row.branch_id).toBeNull();
    expect(row.report_id).toBeNull();
    expect(row.before).toBeNull();
    expect(row.after).toEqual({ kind: 'print_report', row_count: 3 });
    expect(JSON.stringify(row)).not.toContain(s.reports.aApproved);
  });

  it('records a printed summary for the super admin', async () => {
    const before = (await audits()).length;
    await recordPrint(ctx(s.actors.superAdmin), { kind: 'print_summary', rowCount: 22 });
    const rows = (await audits()).slice(before);
    expect(rows.map((r) => r.after)).toEqual([{ kind: 'print_summary', row_count: 22 }]);
  });

  it('an unknown or malformed report is NotFound and writes nothing', async () => {
    const before = (await audits()).length;
    for (const reportId of [RANDOM_UUID, 'not-a-uuid']) {
      await expect(
        recordPrint(ctx(s.actors.finance), { kind: 'print_report', reportId, rowCount: 1 }),
      ).rejects.toBeInstanceOf(NotFound);
    }
    expect((await audits()).length).toBe(before);
  });

  it('rejects a report print without a report and a summary print with one', async () => {
    const before = (await audits()).length;
    await expect(
      recordPrint(ctx(s.actors.finance), { kind: 'print_report', rowCount: 1 }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    await expect(
      recordPrint(ctx(s.actors.finance), {
        kind: 'print_summary',
        reportId: s.reports.aApproved,
        rowCount: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    await expect(
      recordPrint(ctx(s.actors.finance), {
        kind: 'summary' as 'print_summary',
        rowCount: 1,
      }),
    ).rejects.toBeInstanceOf(ValidationFailed);
    expect((await audits()).length).toBe(before);
  });

  it.each(['leadA', 'hrA', 'editor'] as const)(
    'is forbidden for %s and writes nothing',
    async (who) => {
      const before = (await audits()).length;
      await expect(
        recordPrint(ctx(s.actors[who]), { kind: 'print_summary', rowCount: 1 }),
      ).rejects.toBeInstanceOf(Forbidden);
      // Authorization comes first: an unknown report still gives Forbidden.
      await expect(
        recordPrint(ctx(s.actors[who]), {
          kind: 'print_report',
          reportId: RANDOM_UUID,
          rowCount: 1,
        }),
      ).rejects.toBeInstanceOf(Forbidden);
      expect((await audits()).length).toBe(before);
    },
  );
});

describe('getPrintableReport', () => {
  it('reconciles with the approved trace level and leaves out voided collections', async () => {
    await seedReportEvents(s.reports.aApproved);
    const printable = await getPrintableReport(db, s.actors.finance, s.reports.aApproved);
    const level = await getReportCollections(
      db,
      s.actors.finance,
      'approved',
      s.branches.a.id,
      s.reports.aApproved,
      {},
    );

    expect(printable.branch).toEqual(level.branch);
    expect(printable.report).toEqual(level.report);
    expect(printable.total).toBe('1250.50');
    expect(printable.total).toBe(level.total);
    expect(printable.count).toBe(2);
    expect(printable.count).toBe(level.recordCount);
    expect(printable.collections).toEqual([
      { collectedOn: '2026-08-31', purpose: 'Food parcels', amount: '1000.00', routedAt: null },
      {
        collectedOn: '2026-09-01',
        purpose: 'School fees',
        amount: '250.50',
        routedAt: '2026-09-10T06:00:00.000Z',
      },
    ]);
    expect(printable.collections.map((c) => c.amount)).not.toContain('999.99');
    expect(printable.report.frozenAmount).toBe('1250.50');
    expect(printable.report.frozenMatchesLive).toBe(true);
    expect(printable.events.map((e) => [e.type, e.actorName, e.occurredAt])).toEqual([
      ['submitted', 'Lead Alpha', '2026-09-07T05:00:00.000Z'],
      ['approved', 'Faraz Finance', '2026-09-08T05:00:00.000Z'],
    ]);
    expect(printable.events).toEqual(level.reportEvents);
    expect(printable.asOf).toMatch(ISO);
  });

  it('prints a report in any status with its live collections', async () => {
    const draft = await getPrintableReport(db, s.actors.superAdmin, s.reports.aDraft);
    expect(draft.report.status).toBe('draft');
    expect(draft.report.frozenAmount).toBeNull();
    expect(draft.report.frozenMatchesLive).toBeNull();
    expect(draft.total).toBe('10.00');
    expect(draft.count).toBe(1);
    expect(draft.events).toEqual([]);

    const returned = await getPrintableReport(db, s.actors.finance, s.reports.aReturned);
    expect(returned.collections.map((c) => c.amount)).toEqual(['40.25']);
    expect(returned.total).toBe('40.25');

    const nil = await getPrintableReport(db, s.actors.finance, s.reports.bNil);
    expect(nil.branch.branchCode).toBe('BR-B');
    expect(nil.collections).toEqual([]);
    expect(nil.total).toBe('0.00');
    expect(nil.count).toBe(0);
  });

  it('unknown and malformed ids are NotFound', async () => {
    for (const id of [RANDOM_UUID, 'not-a-uuid', '']) {
      await expect(getPrintableReport(db, s.actors.finance, id)).rejects.toBeInstanceOf(NotFound);
    }
  });

  it.each(['leadA', 'hrA', 'editor'] as const)('is forbidden for %s', async (who) => {
    await expect(getPrintableReport(db, s.actors[who], s.reports.aApproved)).rejects.toBeInstanceOf(
      Forbidden,
    );
    await expect(getPrintableReport(db, s.actors[who], RANDOM_UUID)).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});
