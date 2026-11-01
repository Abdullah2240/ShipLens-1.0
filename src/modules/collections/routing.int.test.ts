import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { AppError, Conflict, Forbidden, mapError, NotFound } from '@/platform/errors';
import { fixedClock } from '@/platform/time';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
} from '../../../tests/support/db';
import { seedReport } from '../../../tests/support/finance-fixtures';
import { markCollectionRouted, unmarkCollectionRouted } from './index';

const db = testPool();
const NOW = '2026-11-04T06:00:00.000Z';

type Fixture = {
  a: BranchRow;
  leadA: Actor;
  finance: Actor;
  admin: Actor;
  hrA: Actor;
  editor: Actor;
  approvedReport: string;
  approved: [string, string];
  voided: string;
  submitted: string;
  draft: string;
};
let f: Fixture;

const actorOf = (u: { id: string; role: string; branch_id: string | null }): Actor => ({
  userId: u.id,
  role: u.role as Actor['role'],
  branchId: u.branch_id,
});
const ctx = (actor: Actor, at: string = NOW): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: fixedClock(at),
  pool: db,
});

type AuditRow = {
  action: string;
  entity_type: string;
  entity_id: string;
  branch_id: string | null;
  report_id: string | null;
  actor_id: string | null;
  actor_role: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
const audits = async (action?: string) =>
  (
    await db.query<AuditRow>(
      `SELECT action, entity_type, entity_id, branch_id, report_id, actor_id, actor_role, before, after
         FROM audit_events WHERE $1::text IS NULL OR action = $1 ORDER BY id`,
      [action ?? null],
    )
  ).rows;

type RoutingState = { routed_at: Date | null; routed_by: string | null; updated_at: Date };
const state = async (id: string): Promise<RoutingState> =>
  (
    await db.query<RoutingState>(
      'SELECT routed_at, routed_by, updated_at FROM collections WHERE id = $1',
      [id],
    )
  ).rows[0]!;

async function expectRejected(
  promise: Promise<unknown>,
  type: abstract new (...args: never[]) => AppError,
  code?: string,
) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type);
  if (code) expect((error as AppError).code).toBe(code);
}

let week = 0;
/** A fresh approved report in its own week, for race rounds. */
async function freshApproved(n: number): Promise<string[]> {
  week += 1;
  const start = new Date(Date.UTC(2026, 6, 6 + 7 * week)).toISOString().slice(0, 10);
  const report = await seedReport(db, {
    branchId: f.a.id,
    weekStart: start,
    status: 'approved',
    submittedBy: f.leadA.userId,
    reviewedBy: f.finance.userId,
    collections: Array.from({ length: n }, (_, i) => ({
      amount: `${100 + i}.00`,
      createdBy: f.leadA.userId,
    })),
  });
  return report.collectionIds;
}

beforeEach(async () => {
  await resetDb(db);
  week = 0;
  const a = await seedBranch(db, { name: 'Alpha', status: 'active' });
  const leadA = actorOf(await seedUser(db, { role: 'branch_lead', branchId: a.id }));
  const finance = actorOf(await seedUser(db, { role: 'finance_reviewer' }));
  const admin = actorOf(await seedUser(db, { role: 'super_admin' }));
  const hrA = actorOf(await seedUser(db, { role: 'hr_lead', branchId: a.id }));
  const editor = actorOf(await seedUser(db, { role: 'content_editor' }));
  const by = leadA.userId;

  const approved = await seedReport(db, {
    branchId: a.id,
    weekStart: '2026-10-19',
    status: 'approved',
    submittedBy: by,
    reviewedBy: finance.userId,
    collections: [
      { amount: '1500.00', createdBy: by },
      { amount: '250.50', createdBy: by },
      { amount: '99.00', createdBy: by, status: 'voided' },
    ],
  });
  const submitted = await seedReport(db, {
    branchId: a.id,
    weekStart: '2026-10-26',
    status: 'submitted',
    submittedBy: by,
    collections: [{ amount: '700.00', createdBy: by }],
  });
  const draft = await seedReport(db, {
    branchId: a.id,
    weekStart: '2026-11-02',
    collections: [{ amount: '300.00', createdBy: by }],
  });

  f = {
    a,
    leadA,
    finance,
    admin,
    hrA,
    editor,
    approvedReport: approved.reportId,
    approved: [approved.collectionIds[0]!, approved.collectionIds[1]!],
    voided: approved.collectionIds[2]!,
    submitted: submitted.collectionIds[0]!,
    draft: draft.collectionIds[0]!,
  };
});
afterAll(() => closeTestPool());

describe('markCollectionRouted', () => {
  it('marks an active approved collection routed at the clock instant and audits it', async () => {
    const id = f.approved[0];
    const result = await markCollectionRouted(ctx(f.finance), id);
    expect(result).toEqual({ collectionId: id, routedAt: NOW });

    const row = await state(id);
    expect(row.routed_at?.toISOString()).toBe(NOW);
    expect(row.routed_by).toBe(f.finance.userId);
    expect(row.updated_at.toISOString()).toBe(NOW);

    expect(await audits()).toEqual([
      {
        action: 'collection.mark_routed',
        entity_type: 'collection',
        entity_id: id,
        branch_id: f.a.id,
        report_id: f.approvedReport,
        actor_id: f.finance.userId,
        actor_role: 'finance_reviewer',
        before: { routed_at: null },
        after: { routed_at: NOW },
      },
    ]);
  });

  it('refuses an already routed collection with already_routed and writes nothing', async () => {
    const id = f.approved[0];
    await markCollectionRouted(ctx(f.finance), id);
    const before = await state(id);
    await expectRejected(
      markCollectionRouted(ctx(f.admin, '2026-11-05T06:00:00.000Z'), id),
      Conflict,
      'already_routed',
    );
    expect(await state(id)).toEqual(before);
    expect(await audits()).toHaveLength(1);
  });

  it('refuses submitted, draft and voided collections with not_approved and writes nothing', async () => {
    for (const id of [f.submitted, f.draft, f.voided]) {
      const before = await state(id);
      await expectRejected(markCollectionRouted(ctx(f.finance), id), Conflict, 'not_approved');
      expect(await state(id)).toEqual(before);
    }
    expect(await audits()).toEqual([]);
  });

  it('lets a super admin mark too', async () => {
    const result = await markCollectionRouted(ctx(f.admin), f.approved[1]);
    expect(result.routedAt).toBe(NOW);
    const [row] = await audits('collection.mark_routed');
    expect(row?.actor_role).toBe('super_admin');
  });
});

describe('unmarkCollectionRouted', () => {
  it('clears routed_at and routed_by and audits the undo', async () => {
    const id = f.approved[0];
    await markCollectionRouted(ctx(f.finance), id);
    const later = '2026-11-04T07:30:00.000Z';
    const result = await unmarkCollectionRouted(ctx(f.admin, later), id);
    expect(result).toEqual({ collectionId: id, routedAt: null });

    const row = await state(id);
    expect(row.routed_at).toBeNull();
    expect(row.routed_by).toBeNull();
    expect(row.updated_at.toISOString()).toBe(later);

    expect(await audits('collection.unmark_routed')).toEqual([
      {
        action: 'collection.unmark_routed',
        entity_type: 'collection',
        entity_id: id,
        branch_id: f.a.id,
        report_id: f.approvedReport,
        actor_id: f.admin.userId,
        actor_role: 'super_admin',
        before: { routed_at: NOW },
        after: { routed_at: null },
      },
    ]);
  });

  it('refuses an unrouted collection with not_routed and writes nothing', async () => {
    const id = f.approved[0];
    await markCollectionRouted(ctx(f.finance), id);
    await unmarkCollectionRouted(ctx(f.finance), id);
    const before = await state(id);
    await expectRejected(unmarkCollectionRouted(ctx(f.finance), id), Conflict, 'not_routed');
    expect(await state(id)).toEqual(before);
    expect(await audits()).toHaveLength(2);

    for (const other of [f.approved[1], f.submitted, f.draft, f.voided]) {
      await expectRejected(unmarkCollectionRouted(ctx(f.admin), other), Conflict, 'not_routed');
    }
    expect(await audits()).toHaveLength(2);
  });

  it('allows marking again after an undo', async () => {
    const id = f.approved[0];
    await markCollectionRouted(ctx(f.finance), id);
    await unmarkCollectionRouted(ctx(f.finance), id);
    const again = await markCollectionRouted(ctx(f.finance, '2026-11-06T06:00:00.000Z'), id);
    expect(again.routedAt).toBe('2026-11-06T06:00:00.000Z');
    expect((await audits()).map((r) => r.action)).toEqual([
      'collection.mark_routed',
      'collection.unmark_routed',
      'collection.mark_routed',
    ]);
  });
});

describe('races', () => {
  it('two concurrent marks: exactly one wins and exactly one audit row exists (5 rounds)', async () => {
    const ids = await freshApproved(5);
    for (const id of ids) {
      const results = await Promise.allSettled([
        markCollectionRouted(ctx(f.finance), id),
        markCollectionRouted(ctx(f.admin), id),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      const reason = (lost[0] as PromiseRejectedResult).reason as AppError;
      expect(reason).toBeInstanceOf(Conflict);
      expect(reason.code).toBe('already_routed');

      const rows = (await audits('collection.mark_routed')).filter((r) => r.entity_id === id);
      expect(rows).toHaveLength(1);
      expect((await state(id)).routed_at?.toISOString()).toBe(NOW);
    }
  });

  it('mark against undo on a routed collection ends consistent with one audit row per success', async () => {
    const ids = await freshApproved(5);
    for (const id of ids) {
      await markCollectionRouted(ctx(f.finance), id);
      const results = await Promise.allSettled([
        markCollectionRouted(ctx(f.admin, '2026-11-05T06:00:00.000Z'), id),
        unmarkCollectionRouted(ctx(f.finance, '2026-11-05T06:00:00.000Z'), id),
      ]);
      const [mark, undo] = results;
      expect(undo.status).toBe('fulfilled');
      const rows = (await audits()).filter((r) => r.entity_id === id);
      const row = await state(id);
      if (mark.status === 'fulfilled') {
        // the undo ran first, then the mark re-routed it
        expect(rows.map((r) => r.action)).toEqual([
          'collection.mark_routed',
          'collection.unmark_routed',
          'collection.mark_routed',
        ]);
        expect(row.routed_at).not.toBeNull();
      } else {
        expect((mark.reason as AppError).code).toBe('already_routed');
        expect(rows.map((r) => r.action)).toEqual([
          'collection.mark_routed',
          'collection.unmark_routed',
        ]);
        expect(row.routed_at).toBeNull();
      }
    }
  });
});

describe('finance guard interplay', () => {
  it('approved fields stay immutable while routed_at can change through the service', async () => {
    const id = f.approved[0];
    for (const sql of [
      "UPDATE collections SET amount = '1.00' WHERE id = $1",
      'UPDATE collections SET collected_on = collected_on + 1 WHERE id = $1',
      "UPDATE collections SET purpose = 'Changed' WHERE id = $1",
      "UPDATE collections SET status = 'voided', void_reason = 'x', voided_at = now() WHERE id = $1",
    ]) {
      await expect(db.query(sql, [id])).rejects.toThrow(/finance_guard:/);
    }
    await markCollectionRouted(ctx(f.finance), id);
    expect((await state(id)).routed_at?.toISOString()).toBe(NOW);
    await expect(
      db.query("UPDATE collections SET amount = '1.00' WHERE id = $1", [id]),
    ).rejects.toThrow(/finance_guard:/);
    const amount = await db.query<{ amount: string }>(
      'SELECT amount::text AS amount FROM collections WHERE id = $1',
      [id],
    );
    expect(amount.rows[0]!.amount).toBe('1500.00');
  });
});

describe('authorization and not found', () => {
  it('refuses branch lead, hr lead and content editor for both actions without writing', async () => {
    const id = f.approved[0];
    await markCollectionRouted(ctx(f.finance), id);
    const routedId = id;
    const unroutedId = f.approved[1];
    const routedBefore = await state(routedId);
    const unroutedBefore = await state(unroutedId);
    for (const actor of [f.leadA, f.hrA, f.editor]) {
      await expectRejected(markCollectionRouted(ctx(actor), unroutedId), Forbidden);
      await expectRejected(unmarkCollectionRouted(ctx(actor), routedId), Forbidden);
    }
    expect(await state(routedId)).toEqual(routedBefore);
    expect(await state(unroutedId)).toEqual(unroutedBefore);
    expect(await audits()).toHaveLength(1);
  });

  it('gives an identical NotFound for a random uuid and a malformed id', async () => {
    for (const fn of [markCollectionRouted, unmarkCollectionRouted]) {
      const errors: unknown[] = [];
      for (const id of [randomUUID(), 'not-a-uuid']) {
        const error = await fn(ctx(f.finance), id).then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(NotFound);
        errors.push(error);
      }
      const bodies = errors.map((e) => mapError(e, 'req').body);
      expect(bodies[0]).toEqual(bodies[1]);
    }
    expect(await audits()).toEqual([]);
  });
});
