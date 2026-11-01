import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '@/platform/db';
import { closeTestPool } from '../support/db';
import { seedReport } from '../support/finance-fixtures';
import {
  call,
  count,
  currentWeek,
  db,
  lifecycleWorld,
  pastWeek,
  today,
  type User,
  type World,
} from './support';

let w: World;

beforeEach(async () => {
  w = await lifecycleWorld();
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

const submit = (id: string, u: User, body: unknown = {}) =>
  call('reports/[id]/submit', 'POST', `/reports/${id}/submit`, {
    cookie: u.cookie,
    body,
    params: { id },
  });
const returnIt = (id: string, u: User, reason: string) =>
  call('reports/[id]/return', 'POST', `/reports/${id}/return`, {
    cookie: u.cookie,
    body: { reason },
    params: { id },
  });
const approve = (id: string, u: User) =>
  call('reports/[id]/approve', 'POST', `/reports/${id}/approve`, {
    cookie: u.cookie,
    params: { id },
  });
const detail = (id: string, u: User) =>
  call('reports/[id]', 'GET', `/reports/${id}`, { cookie: u.cookie, params: { id } });
const logCollection = (u: User, amount: string, collectedOn = today()) =>
  call('collections', 'POST', '/collections', {
    cookie: u.cookie,
    body: { amount, collectedOn, purpose: 'Weekly dues' },
  });

describe('weekly report lifecycle over HTTP', () => {
  it('goes draft, submit, return, resubmit, approve, with every step evented and audited in order', async () => {
    const first = await logCollection(w.leadA, '1500.00');
    expect(first.status).toBe(201);
    const second = await logCollection(w.leadA, '250.50');
    expect(second.status).toBe(201);
    const reportId = String(first.json.data.reportId);
    expect(second.json.data.reportId).toBe(reportId);

    const list = await call('reports', 'GET', '/reports', { cookie: w.leadA.cookie });
    expect(list.status).toBe(200);
    expect(list.json.data.items).toEqual([
      expect.objectContaining({
        id: reportId,
        weekStart: currentWeek(),
        status: 'draft',
        amount: '1750.50',
        count: 2,
        amountIsFrozen: false,
        version: 0,
      }),
    ]);

    const submitted = await submit(reportId, w.leadA);
    expect(submitted.status).toBe(200);
    expect(submitted.json.data).toMatchObject({
      status: 'submitted',
      frozenAmount: '1750.50',
      frozenCount: 2,
      amountIsFrozen: true,
      version: 1,
    });

    const returned = await returnIt(
      reportId,
      w.finance1,
      'Receipt for the second entry is missing',
    );
    expect(returned.status).toBe(200);
    expect(returned.json.data).toMatchObject({
      status: 'returned',
      returnReason: 'Receipt for the second entry is missing',
      version: 2,
    });

    const secondId = String(second.json.data.id);
    const amended = await call('collections/[id]', 'PATCH', `/collections/${secondId}`, {
      cookie: w.leadA.cookie,
      body: { amount: '300.00' },
      params: { id: secondId },
    });
    expect(amended.status).toBe(200);
    expect(amended.json.data.amount).toBe('300.00');

    const resubmitted = await submit(reportId, w.leadA);
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.json.data).toMatchObject({
      status: 'submitted',
      frozenAmount: '1800.00',
      frozenCount: 2,
      version: 3,
    });

    const approved = await approve(reportId, w.finance1);
    expect(approved.status).toBe(200);
    expect(approved.json.data).toMatchObject({ status: 'approved', amount: '1800.00', version: 4 });

    const events = await db.query(
      `SELECT event_type, from_status, to_status, actor_id, reason
         FROM report_events WHERE report_id = $1 ORDER BY id`,
      [reportId],
    );
    expect(events.rows).toEqual([
      {
        event_type: 'submitted',
        from_status: 'draft',
        to_status: 'submitted',
        actor_id: w.leadA.id,
        reason: null,
      },
      {
        event_type: 'returned',
        from_status: 'submitted',
        to_status: 'returned',
        actor_id: w.finance1.id,
        reason: 'Receipt for the second entry is missing',
      },
      {
        event_type: 'resubmitted',
        from_status: 'returned',
        to_status: 'submitted',
        actor_id: w.leadA.id,
        reason: null,
      },
      {
        event_type: 'approved',
        from_status: 'submitted',
        to_status: 'approved',
        actor_id: w.finance1.id,
        reason: null,
      },
    ]);

    const audit = await db.query<{
      action: string;
      actor_id: string;
      actor_role: string;
      report_id: string;
    }>(
      'SELECT action, actor_id, actor_role, report_id FROM audit_events WHERE report_id = $1 ORDER BY id',
      [reportId],
    );
    const lead = { actor_id: w.leadA.id, actor_role: 'branch_lead', report_id: reportId };
    const finance = {
      actor_id: w.finance1.id,
      actor_role: 'finance_reviewer',
      report_id: reportId,
    };
    expect(audit.rows).toEqual([
      { action: 'report.create_draft', ...lead },
      { action: 'collection.create', ...lead },
      { action: 'collection.create', ...lead },
      { action: 'report.submit', ...lead },
      { action: 'report.return', ...finance },
      { action: 'collection.amend', ...lead },
      { action: 'report.resubmit', ...lead },
      { action: 'report.approve', ...finance },
    ]);
  });

  it('locks the approved report for good: no transition, no collection write, no override, no SQL edit', async () => {
    const logged = await logCollection(w.leadA, '400.00');
    const reportId = String(logged.json.data.reportId);
    const collectionId = String(logged.json.data.id);
    expect((await submit(reportId, w.leadA)).status).toBe(200);
    expect((await approve(reportId, w.finance1)).status).toBe(200);
    const auditBefore = await count('SELECT count(*) AS n FROM audit_events');
    const eventsBefore = await count('SELECT count(*) AS n FROM report_events');

    for (const res of [
      await submit(reportId, w.leadA, { confirmNil: true }),
      await returnIt(reportId, w.finance2, 'Second thoughts'),
      await approve(reportId, w.finance2),
    ]) {
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('invalid_transition');
    }

    const adminApprove = await approve(reportId, w.admin);
    const adminReturn = await returnIt(reportId, w.admin, 'Override attempt');
    expect([adminApprove.status, adminReturn.status]).toEqual([403, 403]);

    const create = await logCollection(w.leadA, '10.00');
    expect(create.status).toBe(409);
    expect(create.json.error.code).toBe('report_not_open');

    const amend = await call('collections/[id]', 'PATCH', `/collections/${collectionId}`, {
      cookie: w.leadA.cookie,
      body: { amount: '1.00' },
      params: { id: collectionId },
    });
    expect(amend.status).toBe(409);
    expect(amend.json.error.code).toBe('report_not_open');

    const voided = await call(
      'collections/[id]/void',
      'POST',
      `/collections/${collectionId}/void`,
      {
        cookie: w.leadA.cookie,
        body: { reason: 'Entered twice' },
        params: { id: collectionId },
      },
    );
    expect(voided.status).toBe(409);
    expect(voided.json.error.code).toBe('report_not_open');

    await expect(
      db.query(`UPDATE weekly_reports SET return_reason = 'x' WHERE id = $1`, [reportId]),
    ).rejects.toThrow(/approved report is locked/);

    for (const u of [w.leadA, w.finance1, w.finance2, w.admin]) {
      const res = await detail(reportId, u);
      expect(res.status).toBe(200);
      expect(res.json.data.allowedActions).toEqual([]);
    }

    const row = await db.query(
      'SELECT status, total_amount, return_reason FROM weekly_reports WHERE id = $1',
      [reportId],
    );
    expect(row.rows[0]).toEqual({
      status: 'approved',
      total_amount: '400.00',
      return_reason: null,
    });
    const coll = await db.query('SELECT amount, status FROM collections WHERE report_id = $1', [
      reportId,
    ]);
    expect(coll.rows).toEqual([{ amount: '400.00', status: 'active' }]);
    expect(await count('SELECT count(*) AS n FROM audit_events')).toBe(auditBefore);
    expect(await count('SELECT count(*) AS n FROM report_events')).toBe(eventsBefore);
  });

  it('needs nil confirmation to submit an empty draft', async () => {
    const list = await call('reports', 'GET', '/reports', { cookie: w.leadA.cookie });
    const reportId = String(list.json.data.items[0]!.id);

    const refused = await submit(reportId, w.leadA, {});
    expect(refused.status).toBe(422);
    expect(refused.json.error.details.fields).toEqual([
      expect.objectContaining({ path: 'confirmNil', code: 'nil_confirmation_required' }),
    ]);
    expect(
      await count('SELECT count(*) AS n FROM report_events WHERE report_id = $1', [reportId]),
    ).toBe(0);

    const ok = await submit(reportId, w.leadA, { confirmNil: true });
    expect(ok.status).toBe(200);
    expect(ok.json.data).toMatchObject({
      status: 'submitted',
      frozenAmount: '0.00',
      frozenCount: 0,
    });
  });

  it('refuses self-approval and lets another reviewer approve', async () => {
    const { reportId } = await seedReport(db, {
      branchId: w.branchA,
      weekStart: pastWeek(1),
      status: 'submitted',
      submittedBy: w.finance2.id,
      collections: [{ amount: '75.00', createdBy: w.leadA.id }],
    });
    const self = await approve(reportId, w.finance2);
    expect(self.status).toBe(409);
    expect(self.json.error.code).toBe('self_approval');
    const other = await approve(reportId, w.finance1);
    expect(other.status).toBe(200);
    expect(other.json.data.status).toBe('approved');
  });
});
