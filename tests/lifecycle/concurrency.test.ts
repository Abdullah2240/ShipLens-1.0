import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { transitionBranch } from '@/modules/branches';
import {
  approveReport,
  ensureCurrentWeekDrafts,
  returnReport,
  submitReport,
} from '@/modules/reports';
import { closePool } from '@/platform/db';
import { addDays, fixedClock } from '@/platform/time';
import { closeTestPool, seedBranch } from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import {
  call,
  count,
  ctxOf,
  db,
  lifecycleWorld,
  pastWeek,
  seedApplication,
  type User,
  type World,
} from './support';

const ROUNDS = 5;

let w: World;
const clock = fixedClock('2026-11-04T06:00:00Z');

beforeEach(async () => {
  w = await lifecycleWorld();
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

/** Exactly one call won; returns the winner's value and the loser's error. */
function oneWinner<T>(results: PromiseSettledResult<T>[]): {
  value: T;
  index: number;
  error: unknown;
} {
  const won = results.flatMap((r, index) =>
    r.status === 'fulfilled' ? [{ value: r.value, index }] : [],
  );
  const lost = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
  expect(won).toHaveLength(1);
  expect(lost).toHaveLength(results.length - 1);
  return { ...won[0]!, error: lost[0] };
}

const submittedReport = (weeksAgo: number) =>
  seedReport(db, {
    branchId: w.branchA,
    weekStart: pastWeek(weeksAgo),
    status: 'submitted',
    submittedBy: w.leadA.id,
    collections: [{ amount: '40.00', createdBy: w.leadA.id }],
  });

const approve = (id: string, u: User) =>
  call('reports/[id]/approve', 'POST', `/reports/${id}/approve`, {
    cookie: u.cookie,
    params: { id },
  });

describe('report races', () => {
  it('lets one of two concurrent HTTP approvals win, every time', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const { reportId } = await submittedReport(round);
      const [one, two] = await Promise.all([
        approve(reportId, w.finance1),
        approve(reportId, w.finance2),
      ]);
      expect([one.status, two.status].sort()).toEqual([200, 409]);
      const winner = one.status === 200 ? w.finance1 : w.finance2;
      const loser = one.status === 200 ? two : one;
      expect(loser.json.error.code).toBe('invalid_transition');

      const row = await db.query(
        'SELECT status, reviewed_by, version FROM weekly_reports WHERE id = $1',
        [reportId],
      );
      expect(row.rows[0]).toEqual({ status: 'approved', reviewed_by: winner.id, version: 2 });
      expect(
        await count(
          `SELECT count(*) AS n FROM report_events WHERE report_id = $1 AND event_type = 'approved'`,
          [reportId],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_events WHERE report_id = $1 AND action = 'report.approve'`,
          [reportId],
        ),
      ).toBe(1);
    }
  });

  it('lets exactly one of approve and return win, and the status matches the winner', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const { reportId } = await submittedReport(round);
      const results = await Promise.allSettled([
        approveReport(ctxOf(w.finance1, clock), reportId),
        returnReport(ctxOf(w.finance2, clock), reportId, { reason: 'Receipt missing' }),
      ]);
      const { value, index, error } = oneWinner(results);
      expect(error).toMatchObject({ status: 409, code: 'invalid_transition' });
      const expected = index === 0 ? 'approved' : 'returned';
      expect(value.status).toBe(expected);

      const row = await db.query<{ status: string }>(
        'SELECT status FROM weekly_reports WHERE id = $1',
        [reportId],
      );
      expect(row.rows[0]!.status).toBe(expected);
      const events = await db.query<{ event_type: string }>(
        'SELECT event_type FROM report_events WHERE report_id = $1',
        [reportId],
      );
      expect(events.rows).toEqual([{ event_type: expected }]);
      const audit = await db.query<{ action: string }>(
        'SELECT action FROM audit_events WHERE report_id = $1',
        [reportId],
      );
      expect(audit.rows).toEqual([{ action: index === 0 ? 'report.approve' : 'report.return' }]);
    }
  });

  it('lets one of two concurrent submits by the same lead win', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const { reportId } = await seedReport(db, {
        branchId: w.branchA,
        weekStart: pastWeek(round),
        collections: [{ amount: '15.00', createdBy: w.leadA.id }],
      });
      const results = await Promise.allSettled([
        submitReport(ctxOf(w.leadA, clock), reportId, {}),
        submitReport(ctxOf(w.leadA, clock), reportId, {}),
      ]);
      const { value, error } = oneWinner(results);
      expect(error).toMatchObject({ status: 409, code: 'invalid_transition' });
      expect(value).toMatchObject({ status: 'submitted', version: 1, frozenAmount: '15.00' });
      expect(
        await count(
          `SELECT count(*) AS n FROM report_events WHERE report_id = $1 AND event_type = 'submitted'`,
          [reportId],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_events WHERE report_id = $1 AND action = 'report.submit'`,
          [reportId],
        ),
      ).toBe(1);
    }
  });

  it('creates one current-week draft when two requests ensure it at once', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const weekStart = addDays('2026-11-02', 7 * round);
      const at = fixedClock(`${weekStart}T06:00:00Z`);
      const inserted = await Promise.all([
        ensureCurrentWeekDrafts(ctxOf(w.leadA, at)),
        ensureCurrentWeekDrafts(ctxOf(w.leadA, at)),
      ]);
      expect(inserted[0] + inserted[1]).toBe(1);
      const drafts = await db.query<{ id: string }>(
        'SELECT id FROM weekly_reports WHERE branch_id = $1 AND week_start = $2::date',
        [w.branchA, weekStart],
      );
      expect(drafts.rows).toHaveLength(1);
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_events WHERE report_id = $1 AND action = 'report.create_draft'`,
          [drafts.rows[0]!.id],
        ),
      ).toBe(1);
    }
    expect(
      await count(`SELECT count(*) AS n FROM audit_events WHERE action = 'report.create_draft'`),
    ).toBe(ROUNDS);
  });
});

describe('branch race', () => {
  it('lets one of two concurrent active-to-paused transitions win', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const branch = await seedBranch(db, { status: 'active' });
      const results = await Promise.allSettled([
        transitionBranch(ctxOf(w.admin, clock), branch.id, { to: 'paused' }),
        transitionBranch(ctxOf(w.admin, clock), branch.id, { to: 'paused' }),
      ]);
      const { error } = oneWinner(results);
      expect(error).toMatchObject({ status: 409, code: 'invalid_transition' });
      const row = await db.query<{ status: string }>('SELECT status FROM branches WHERE id = $1', [
        branch.id,
      ]);
      expect(row.rows[0]!.status).toBe('paused');
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_events WHERE entity_id = $1 AND action = 'branch.transition'`,
          [branch.id],
        ),
      ).toBe(1);
    }
  });
});

describe('application race', () => {
  it('lets one of two HR Leads accepting the same application win, with one member', async () => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      const id = await seedApplication(w.branchA, `Applicant Round ${round}`);
      const accept = (u: User) =>
        call('applications/[id]/accept', 'POST', `/applications/${id}/accept`, {
          cookie: u.cookie,
          params: { id },
        });
      const [one, two] = await Promise.all([accept(w.hrA), accept(w.hrA2)]);
      expect([one.status, two.status].sort()).toEqual([200, 409]);
      const winner = one.status === 200 ? one : two;
      const loser = one.status === 200 ? two : one;
      expect(loser.json.error.code).toBe('already_decided');

      const members = await db.query<{ id: string }>(
        'SELECT id FROM members WHERE application_id = $1',
        [id],
      );
      expect(members.rows).toEqual([{ id: winner.json.data.memberId }]);
      const app = await db.query<{ status: string }>(
        'SELECT status FROM applications WHERE id = $1',
        [id],
      );
      expect(app.rows[0]!.status).toBe('accepted');
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_events WHERE entity_id = $1 AND action = 'application.accept'`,
          [id],
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT count(*) AS n FROM audit_events WHERE entity_id = $1 AND action = 'member.create'`,
          [members.rows[0]!.id],
        ),
      ).toBe(1);
    }
    expect(await count('SELECT count(*) AS n FROM members')).toBe(ROUNDS);
    expect(
      await count(`SELECT count(*) AS n FROM audit_events WHERE action = 'member.create'`),
    ).toBe(ROUNDS);
  });
});
