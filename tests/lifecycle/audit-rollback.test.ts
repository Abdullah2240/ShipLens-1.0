import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { submitReport } from '@/modules/reports';
import { closePool } from '@/platform/db';
import { fixedClock } from '@/platform/time';
import { closeTestPool } from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import {
  call,
  count,
  ctxOf,
  currentWeek,
  db,
  lifecycleWorld,
  pastWeek,
  seedApplication,
  today,
  type World,
} from './support';

let w: World;

/** Makes every audit insert for `action` raise, in this lane database only. */
async function failAuditFor(action: string): Promise<void> {
  if (!/^[a-z_]+\.[a-z_]+$/.test(action)) throw new Error(`unexpected action name ${action}`);
  await db.query(`
    CREATE OR REPLACE FUNCTION test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = '${action}' THEN
        RAISE EXCEPTION 'forced audit failure';
      END IF;
      RETURN NEW;
    END $$`);
  await db.query(`
    CREATE TRIGGER test_fail_audit BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION test_fail_audit()`);
}

async function dropFailAudit(): Promise<void> {
  await db.query('DROP TRIGGER IF EXISTS test_fail_audit ON audit_events');
  await db.query('DROP FUNCTION IF EXISTS test_fail_audit()');
}

beforeEach(async () => {
  await dropFailAudit();
  w = await lifecycleWorld();
});
afterEach(dropFailAudit);
afterAll(async () => {
  expect(await count(`SELECT count(*) AS n FROM pg_trigger WHERE tgname = 'test_fail_audit'`)).toBe(
    0,
  );
  await closePool();
  await closeTestPool();
});

const auditForRequest = (requestId: string) =>
  count('SELECT count(*) AS n FROM audit_events WHERE request_id = $1', [requestId]);

function expectInternalError(res: { status: number; json: unknown }, requestId: string): void {
  expect(res.status).toBe(500);
  expect(res.json).toEqual({
    error: { code: 'internal_error', message: 'Internal error', requestId },
  });
}

describe('a failed audit insert rolls the whole command back', () => {
  it('report.approve: the report stays submitted with no reviewer, event or audit row', async () => {
    const { reportId } = await seedReport(db, {
      branchId: w.branchA,
      weekStart: pastWeek(1),
      status: 'submitted',
      submittedBy: w.leadA.id,
      collections: [{ amount: '60.00', createdBy: w.leadA.id }],
    });
    await failAuditFor('report.approve');
    const requestId = randomUUID();
    const res = await call('reports/[id]/approve', 'POST', `/reports/${reportId}/approve`, {
      cookie: w.finance1.cookie,
      params: { id: reportId },
      requestId,
    });
    expectInternalError(res, requestId);

    const row = await db.query(
      'SELECT status, reviewed_by, reviewed_at, version FROM weekly_reports WHERE id = $1',
      [reportId],
    );
    expect(row.rows[0]).toEqual({
      status: 'submitted',
      reviewed_by: null,
      reviewed_at: null,
      version: 1,
    });
    expect(
      await count(
        `SELECT count(*) AS n FROM report_events WHERE report_id = $1 AND event_type = 'approved'`,
        [reportId],
      ),
    ).toBe(0);
    expect(await auditForRequest(requestId)).toBe(0);
  });

  it('report.submit: the report stays a draft with no frozen totals and the same version', async () => {
    const { reportId } = await seedReport(db, {
      branchId: w.branchA,
      weekStart: pastWeek(1),
      collections: [{ amount: '25.00', createdBy: w.leadA.id }],
    });
    await failAuditFor('report.submit');
    const ctx = ctxOf(w.leadA, fixedClock(new Date()));
    await expect(submitReport(ctx, reportId, {})).rejects.toThrow('forced audit failure');

    const row = await db.query(
      `SELECT status, total_amount, collection_count, submitted_at, submitted_by, version
         FROM weekly_reports WHERE id = $1`,
      [reportId],
    );
    expect(row.rows[0]).toEqual({
      status: 'draft',
      total_amount: null,
      collection_count: null,
      submitted_at: null,
      submitted_by: null,
      version: 0,
    });
    expect(
      await count('SELECT count(*) AS n FROM report_events WHERE report_id = $1', [reportId]),
    ).toBe(0);
    expect(await auditForRequest(ctx.requestId)).toBe(0);
  });

  it('collection.create: neither the collection nor the new week draft survives', async () => {
    await failAuditFor('collection.create');
    const requestId = randomUUID();
    const res = await call('collections', 'POST', '/collections', {
      cookie: w.leadA.cookie,
      body: { amount: '500.00', collectedOn: today(), purpose: 'Weekly dues' },
      requestId,
    });
    expectInternalError(res, requestId);

    expect(await count('SELECT count(*) AS n FROM collections')).toBe(0);
    expect(
      await count(
        'SELECT count(*) AS n FROM weekly_reports WHERE branch_id = $1 AND week_start = $2::date',
        [w.branchA, currentWeek()],
      ),
    ).toBe(0);
    expect(
      await count(`SELECT count(*) AS n FROM audit_events WHERE action = 'report.create_draft'`),
    ).toBe(0);
    expect(await auditForRequest(requestId)).toBe(0);
  });

  it('collection.void: the collection stays active with no void reason', async () => {
    const {
      collectionIds: [id],
    } = await seedReport(db, {
      branchId: w.branchA,
      weekStart: currentWeek(),
      collections: [{ amount: '80.00', collectedOn: today(), createdBy: w.leadA.id }],
    });
    await failAuditFor('collection.void');
    const requestId = randomUUID();
    const res = await call('collections/[id]/void', 'POST', `/collections/${id}/void`, {
      cookie: w.leadA.cookie,
      body: { reason: 'Entered twice' },
      params: { id: id! },
      requestId,
    });
    expectInternalError(res, requestId);

    const row = await db.query(
      'SELECT status, void_reason, voided_at, voided_by FROM collections WHERE id = $1',
      [id],
    );
    expect(row.rows[0]).toEqual({
      status: 'active',
      void_reason: null,
      voided_at: null,
      voided_by: null,
    });
    expect(await auditForRequest(requestId)).toBe(0);
  });

  it('branch.transition: the branch status is unchanged', async () => {
    await failAuditFor('branch.transition');
    const requestId = randomUUID();
    const res = await call('branches/[id]/status', 'POST', `/branches/${w.branchB}/status`, {
      cookie: w.admin.cookie,
      body: { to: 'paused' },
      params: { id: w.branchB },
      requestId,
    });
    expectInternalError(res, requestId);

    const row = await db.query<{ status: string }>('SELECT status FROM branches WHERE id = $1', [
      w.branchB,
    ]);
    expect(row.rows[0]!.status).toBe('active');
    expect(await auditForRequest(requestId)).toBe(0);
  });

  it.each(['application.accept', 'member.create'])(
    '%s: the application stays pending and no member exists',
    async (action) => {
      const id = await seedApplication(w.branchA, 'Rollback Applicant');
      await failAuditFor(action);
      const requestId = randomUUID();
      const res = await call('applications/[id]/accept', 'POST', `/applications/${id}/accept`, {
        cookie: w.hrA.cookie,
        params: { id },
        requestId,
      });
      expectInternalError(res, requestId);

      const app = await db.query('SELECT status, decided_by FROM applications WHERE id = $1', [id]);
      expect(app.rows[0]).toEqual({ status: 'pending', decided_by: null });
      expect(await count('SELECT count(*) AS n FROM members')).toBe(0);
      expect(await auditForRequest(requestId)).toBe(0);
    },
  );
});
