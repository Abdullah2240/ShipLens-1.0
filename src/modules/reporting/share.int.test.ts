import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { AppError, Forbidden, NotFound } from '@/platform/errors';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, testPool } from '../../../tests/support/db';
import {
  actorOf,
  buildReportingScenario,
  type ReportingScenario,
} from '../../../tests/support/reporting-fixtures';
import { resolveSharedReport, shareReport } from './service-share';

const db = testPool();
const NOW = '2026-10-31T12:00:00.000Z';
const ORIGIN = 'https://shiplens.example';
let s: ReportingScenario;

const ctx = (actor: Actor | null): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: fixedClock(NOW),
  pool: db,
});

type AuditRow = {
  action: string;
  actor_id: string | null;
  actor_role: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  report_id: string | null;
  before: unknown;
  after: Record<string, unknown> | null;
};
const audits = async () =>
  (await db.query<AuditRow>('SELECT * FROM audit_events ORDER BY occurred_at, id')).rows;

/** Runs the promise and returns the AppError it rejected with. */
async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error('expected a rejection');
}

const share = (actor: Actor, reportId: string, locale: 'en' | 'ur' = 'en') =>
  shareReport(ctx(actor), reportId, { appOrigin: ORIGIN, locale });

beforeEach(async () => {
  await resetDb(db);
  s = await buildReportingScenario(db);
});

afterAll(async () => {
  await closeTestPool();
});

describe('shareReport', () => {
  it("gives the frozen total and count of the lead's submitted report", async () => {
    const { summary, link } = await share(s.actors.leadA, s.reports.aSubmitted, 'ur');
    expect(summary).toEqual({
      reportId: s.reports.aSubmitted,
      branchName: 'Alpha',
      branchCode: 'BR-A',
      weekStart: '2026-09-07',
      weekEnd: '2026-09-13',
      status: 'submitted',
      amount: '300.00',
      collectionCount: 1,
      amountIsFrozen: true,
    });
    expect(link).toBe(`${ORIGIN}/ur/share/reports/${s.reports.aSubmitted}`);
  });

  it('gives the frozen figures of an approved report (voided collections excluded)', async () => {
    const { summary } = await share(s.actors.leadA, s.reports.aApproved);
    expect(summary).toMatchObject({
      status: 'approved',
      amount: '1250.50',
      collectionCount: 2,
      amountIsFrozen: true,
      weekStart: '2026-08-31',
      weekEnd: '2026-09-06',
    });
  });

  it('gives the live sum of a draft and of a returned report', async () => {
    const draft = await share(s.actors.leadA, s.reports.aDraft);
    expect(draft.summary).toMatchObject({
      status: 'draft',
      amount: '10.00',
      collectionCount: 1,
      amountIsFrozen: false,
    });
    expect(draft.link).toBe(`${ORIGIN}/en/share/reports/${s.reports.aDraft}`);

    const returned = await share(s.actors.leadA, s.reports.aReturned);
    expect(returned.summary).toMatchObject({
      status: 'returned',
      amount: '40.25',
      collectionCount: 1,
      amountIsFrozen: false,
    });
  });

  it('writes exactly one minimal report.share audit row', async () => {
    await share(s.actors.leadA, s.reports.aSubmitted);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      action: 'report.share',
      actor_id: s.users.leadA.id,
      actor_role: 'branch_lead',
      entity_type: 'share',
      entity_id: s.reports.aSubmitted,
      branch_id: s.branches.a.id,
      report_id: s.reports.aSubmitted,
      before: null,
      after: { channel: 'whatsapp' },
    });
    const serialised = JSON.stringify(row);
    for (const forbidden of ['300.00', 'amount', 'Medicine', 'Lead Alpha', 'Alpha', 'BR-A']) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
  });

  it('audits every share, one row each', async () => {
    await share(s.actors.leadA, s.reports.aSubmitted);
    await share(s.actors.leadA, s.reports.aSubmitted, 'ur');
    await share(s.actors.leadA, s.reports.aDraft);
    const rows = await audits();
    expect(rows.map((r) => r.entity_id)).toEqual([
      s.reports.aSubmitted,
      s.reports.aSubmitted,
      s.reports.aDraft,
    ]);
    expect(rows.every((r) => r.action === 'report.share')).toBe(true);
  });

  it('carries no line items or personal data in the summary', async () => {
    const { summary } = await share(s.actors.leadA, s.reports.aApproved);
    const text = JSON.stringify(summary);
    const forbidden = [
      s.collections.a1000,
      s.collections.a250,
      s.collections.aVoid999,
      'Food parcels',
      'School fees',
      'Entered twice',
      s.users.leadA.name,
      s.users.leadA.email,
      s.users.finance.name,
      s.users.finance.email,
      s.users.leadA.id,
      s.users.finance.id,
      '@',
    ];
    for (const value of forbidden) expect(text, value).not.toContain(value);
    expect(Object.keys(summary).sort()).toEqual(
      [
        'amount',
        'amountIsFrozen',
        'branchCode',
        'branchName',
        'collectionCount',
        'reportId',
        'status',
        'weekEnd',
        'weekStart',
      ].sort(),
    );
  });

  it("gives the identical NotFound for another branch's report and a random id, unaudited", async () => {
    const other = await failure(share(s.actors.leadA, s.reports.bApproved));
    const random = await failure(share(s.actors.leadA, randomUUID()));
    const malformed = await failure(share(s.actors.leadA, 'not-a-uuid'));
    for (const err of [other, random, malformed]) {
      expect(err).toBeInstanceOf(NotFound);
      expect({ status: err.status, code: err.code, message: err.message }).toEqual({
        status: other.status,
        code: other.code,
        message: other.message,
      });
    }
    expect(await audits()).toHaveLength(0);
  });

  it('is forbidden for every role other than branch lead, unaudited', async () => {
    for (const actor of [s.actors.finance, s.actors.superAdmin, s.actors.hrA, s.actors.editor]) {
      const err = await failure(share(actor, s.reports.aSubmitted));
      expect(err, actor.role).toBeInstanceOf(Forbidden);
    }
    expect(await audits()).toHaveLength(0);
  });

  it('requires an actor', async () => {
    const err = await failure(
      shareReport(ctx(null), s.reports.aSubmitted, { appOrigin: ORIGIN, locale: 'en' }),
    );
    expect(err.status).toBe(401);
  });
});

describe('resolveSharedReport', () => {
  it("lets a branch lead open their own branch's report only", async () => {
    await expect(resolveSharedReport(db, s.actors.leadA, s.reports.aSubmitted)).resolves.toEqual({
      reportId: s.reports.aSubmitted,
    });
    const err = await failure(resolveSharedReport(db, s.actors.leadA, s.reports.bApproved));
    expect(err).toBeInstanceOf(NotFound);
    const leadB = actorOf(s.users.leadB);
    await expect(resolveSharedReport(db, leadB, s.reports.bApproved)).resolves.toEqual({
      reportId: s.reports.bApproved,
    });
    expect(await failure(resolveSharedReport(db, leadB, s.reports.aSubmitted))).toBeInstanceOf(
      NotFound,
    );
  });

  it('lets Finance and Super Admin open reports of every branch', async () => {
    for (const actor of [s.actors.finance, s.actors.superAdmin]) {
      for (const id of [s.reports.aSubmitted, s.reports.bApproved]) {
        await expect(resolveSharedReport(db, actor, id)).resolves.toEqual({ reportId: id });
      }
    }
  });

  it('is NotFound for a random or malformed id', async () => {
    for (const id of [randomUUID(), 'nope', '']) {
      expect(await failure(resolveSharedReport(db, s.actors.finance, id))).toBeInstanceOf(NotFound);
    }
  });

  it('is forbidden for HR lead and content editor', async () => {
    for (const actor of [s.actors.hrA, s.actors.editor]) {
      expect(
        await failure(resolveSharedReport(db, actor, s.reports.aSubmitted)),
        actor.role,
      ).toBeInstanceOf(Forbidden);
    }
  });

  it('writes no audit row', async () => {
    await resolveSharedReport(db, s.actors.leadA, s.reports.aSubmitted);
    expect(await audits()).toHaveLength(0);
  });
});
