import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { addDays, fixedClock, type Clock, type DateString } from '@/platform/time';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
} from '../../../tests/support/db';
import { seedCollection, seedReport } from '../../../tests/support/finance-fixtures';
import { approveReport, getReport, returnReport, submitReport } from './service';

const db = testPool();
type Role = Actor['role'];
const WEEK = '2026-11-02';

const ctx = (actor: Actor, clock: Clock = fixedClock('2026-11-04T06:00:00Z')): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock,
  pool: db,
});

let a: BranchRow;
let leadA: Actor;
let r1: Actor;
let r2: Actor;

beforeEach(async () => {
  await resetDb(db);
  a = await seedBranch(db, { name: 'Alpha', status: 'active' });
  const make = async (role: Role, name: string, branchId: string | null = null): Promise<Actor> => {
    const user = await seedUser(db, { role, branchId, name });
    return { userId: user.id, role, branchId: user.branch_id };
  };
  leadA = await make('branch_lead', 'Lead Alpha', a.id);
  r1 = await make('finance_reviewer', 'Reviewer One');
  r2 = await make('finance_reviewer', 'Reviewer Two');
});
afterAll(() => closeTestPool());

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);
}
const eventCount = (reportId: string, type: string) =>
  count('SELECT count(*) AS n FROM report_events WHERE report_id = $1 AND event_type = $2', [
    reportId,
    type,
  ]);
const auditCount = (reportId: string, action: string) =>
  count('SELECT count(*) AS n FROM audit_events WHERE report_id = $1 AND action = $2', [
    reportId,
    action,
  ]);

function submittedReport(weekStart: DateString) {
  return seedReport(db, {
    branchId: a.id,
    weekStart,
    status: 'submitted',
    submittedBy: leadA.userId,
    collections: [{ amount: '25.00', createdBy: leadA.userId, collectedOn: weekStart }],
  });
}

function settle<T>(results: PromiseSettledResult<T>[]) {
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return { fulfilled, rejected };
}

describe('full lifecycle', () => {
  it('draft, submit, return, resubmit, approve: every step writes an event then an audit row', async () => {
    const draft = await seedReport(db, {
      branchId: a.id,
      weekStart: WEEK,
      collections: [{ amount: '10.00', createdBy: leadA.userId }],
    });
    const id = draft.reportId;
    const clock = fixedClock('2026-11-04T06:00:00Z');
    const step = async <T>(fn: () => Promise<T>) => {
      const result = await fn();
      clock.advance(60_000);
      return result;
    };

    expect((await step(() => submitReport(ctx(leadA, clock), id, {}))).version).toBe(1);
    expect(
      (await step(() => returnReport(ctx(r1, clock), id, { reason: 'Missing receipt' }))).version,
    ).toBe(2);
    await seedCollection(db, {
      branchId: a.id,
      reportId: id,
      amount: '5.00',
      collectedOn: '2026-11-05',
      createdBy: leadA.userId,
    });
    expect((await step(() => submitReport(ctx(leadA, clock), id, {}))).version).toBe(3);
    const approved = await step(() => approveReport(ctx(r2, clock), id));
    expect(approved).toMatchObject({
      status: 'approved',
      amount: '15.00',
      count: 2,
      version: 4,
      allowedActions: [],
    });

    const { rows: evs } = await db.query<{
      event_type: string;
      from_status: string;
      to_status: string;
      occurred_at: Date;
      tx: string;
    }>(
      `SELECT event_type, from_status, to_status, occurred_at, xmin::text AS tx
       FROM report_events WHERE report_id = $1 ORDER BY id`,
      [id],
    );
    expect(evs.map((e) => `${e.event_type}:${e.from_status}>${e.to_status}`)).toEqual([
      'submitted:draft>submitted',
      'returned:submitted>returned',
      'resubmitted:returned>submitted',
      'approved:submitted>approved',
    ]);
    expect(evs.map((e) => e.occurred_at.toISOString())).toEqual([
      '2026-11-04T06:00:00.000Z',
      '2026-11-04T06:01:00.000Z',
      '2026-11-04T06:02:00.000Z',
      '2026-11-04T06:03:00.000Z',
    ]);

    const { rows: auditRows } = await db.query<{
      action: string;
      occurred_at: Date;
      tx: string;
      branch_id: string;
      entity_id: string;
    }>(
      `SELECT action, occurred_at, xmin::text AS tx, branch_id, entity_id
       FROM audit_events WHERE report_id = $1 ORDER BY id`,
      [id],
    );
    expect(auditRows.map((r) => r.action)).toEqual([
      'report.submit',
      'report.return',
      'report.resubmit',
      'report.approve',
    ]);
    expect(auditRows.every((r) => r.branch_id === a.id && r.entity_id === id)).toBe(true);
    // audit time order matches the step order, and each step's event and audit row share a transaction
    const times = auditRows.map((r) => r.occurred_at.getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(auditRows.map((r) => r.tx)).toEqual(evs.map((e) => e.tx));
    expect(new Set(evs.map((e) => e.tx)).size).toBe(4);

    const detail = await getReport(db, leadA, id);
    expect(detail.events.map((e) => [e.type, e.actorName])).toEqual([
      ['submitted', 'Lead Alpha'],
      ['returned', 'Reviewer One'],
      ['resubmitted', 'Lead Alpha'],
      ['approved', 'Reviewer Two'],
    ]);
    expect(detail.events[1]!.reason).toBe('Missing receipt');
  });
});

describe('concurrent reviewers', () => {
  it('two reviewers approving at once: exactly one wins, repeated on 5 fresh reports', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { reportId } = await submittedReport(addDays(WEEK, -7 * (i + 1)));
      const results = await Promise.allSettled([
        approveReport(ctx(r1), reportId),
        approveReport(ctx(r2), reportId),
      ]);
      const { fulfilled, rejected } = settle(results);
      expect(fulfilled, `round ${i}`).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ status: 409, code: 'invalid_transition' });
      expect(await eventCount(reportId, 'approved')).toBe(1);
      expect(await auditCount(reportId, 'report.approve')).toBe(1);
      const { rows } = await db.query<{ status: string; version: number }>(
        'SELECT status, version FROM weekly_reports WHERE id = $1',
        [reportId],
      );
      expect(rows[0]).toEqual({ status: 'approved', version: 2 });
    }
  });

  it('approve and return at once: exactly one wins and the state matches the winner', async () => {
    for (let i = 0; i < 3; i += 1) {
      const { reportId } = await submittedReport(addDays(WEEK, -7 * (i + 1)));
      const results = await Promise.allSettled([
        approveReport(ctx(r1), reportId),
        returnReport(ctx(r2), reportId, { reason: 'Recount please' }),
      ]);
      const { fulfilled, rejected } = settle(results);
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject({ status: 409, code: 'invalid_transition' });
      const winner = results[0]!.status === 'fulfilled' ? 'approved' : 'returned';
      const { rows } = await db.query<{ status: string }>(
        'SELECT status FROM weekly_reports WHERE id = $1',
        [reportId],
      );
      expect(rows[0]!.status).toBe(winner);
      expect(
        await count('SELECT count(*) AS n FROM report_events WHERE report_id = $1', [reportId]),
      ).toBe(1);
      expect(
        await count('SELECT count(*) AS n FROM audit_events WHERE report_id = $1', [reportId]),
      ).toBe(1);
    }
  });

  it('two submits by the same lead at once: one wins', async () => {
    const { reportId } = await seedReport(db, {
      branchId: a.id,
      weekStart: WEEK,
      collections: [{ amount: '4.00', createdBy: leadA.userId }],
    });
    const results = await Promise.allSettled([
      submitReport(ctx(leadA), reportId, {}),
      submitReport(ctx(leadA), reportId, {}),
    ]);
    const { fulfilled, rejected } = settle(results);
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ status: 409, code: 'invalid_transition' });
    expect(await eventCount(reportId, 'submitted')).toBe(1);
    expect(await auditCount(reportId, 'report.submit')).toBe(1);
  });

  it('a resubmit racing a second resubmit: one wins with one resubmitted event', async () => {
    const { reportId } = await seedReport(db, {
      branchId: a.id,
      weekStart: WEEK,
      status: 'returned',
      submittedBy: leadA.userId,
      reviewedBy: r1.userId,
      collections: [{ amount: '4.00', createdBy: leadA.userId }],
    });
    const results = await Promise.allSettled([
      submitReport(ctx(leadA), reportId, {}),
      submitReport(ctx(leadA), reportId, {}),
    ]);
    expect(settle(results).fulfilled).toHaveLength(1);
    expect(await eventCount(reportId, 'resubmitted')).toBe(1);
    expect(await auditCount(reportId, 'report.resubmit')).toBe(1);
  });
});
