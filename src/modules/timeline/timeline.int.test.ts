import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@/platform/authz';
import { Forbidden, mapError } from '@/platform/errors';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type UserRow,
} from '../../../tests/support/db';
import { seedReport } from '../../../tests/support/finance-fixtures';
import { getCollectionTimeline, getReportTimeline } from './service';

const db = testPool();

const actorOf = (u: UserRow): Actor => ({
  userId: u.id,
  role: u.role as Actor['role'],
  branchId: u.branch_id,
});

type AuditInput = {
  occurredAt: string;
  actorId: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  branchId: string | null;
  reportId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string | null;
};

async function insertAudit(row: AuditInput): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO audit_events
       (occurred_at, request_id, actor_id, actor_role, action, entity_type, entity_id, branch_id, report_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id::text AS id`,
    [
      row.occurredAt,
      row.requestId ?? null,
      row.actorId,
      row.actorRole,
      row.action,
      row.entityType,
      row.entityId,
      row.branchId,
      row.reportId,
      row.before ? JSON.stringify(row.before) : null,
      row.after ? JSON.stringify(row.after) : null,
    ],
  );
  return rows[0]!.id;
}

type Fixture = {
  admin: Actor;
  finance: Actor;
  editor: Actor;
  leadA: Actor;
  leadB: Actor;
  hrA: Actor;
  leadAName: string;
  reportA: string;
  reportB: string;
  collectionA: string;
  collectionB: string;
  ids: Record<'create' | 'draft' | 'amend' | 'submit' | 'otherB' | 'decoy', string>;
};
let f: Fixture;

beforeEach(async () => {
  await resetDb(db);
  const a = await seedBranch(db, { name: 'Alpha' });
  const b = await seedBranch(db, { name: 'Bravo' });
  const admin = await seedUser(db, { role: 'super_admin' });
  const finance = await seedUser(db, { role: 'finance_reviewer' });
  const editor = await seedUser(db, { role: 'content_editor' });
  const leadA = await seedUser(db, { role: 'branch_lead', branchId: a.id, name: 'Ayesha Lead' });
  const leadB = await seedUser(db, { role: 'branch_lead', branchId: b.id });
  const hrA = await seedUser(db, { role: 'hr_lead', branchId: a.id });

  const rA = await seedReport(db, {
    branchId: a.id,
    weekStart: '2026-10-26',
    collections: [{ amount: '100.00', createdBy: leadA.id }],
  });
  const rB = await seedReport(db, {
    branchId: b.id,
    weekStart: '2026-10-26',
    collections: [{ amount: '75.00', createdBy: leadB.id }],
  });
  const cA = rA.collectionIds[0]!;
  const cB = rB.collectionIds[0]!;

  // Inserted out of time order on purpose; amend and submit share a timestamp.
  const create = await insertAudit({
    occurredAt: '2026-10-26T05:05:00Z',
    actorId: leadA.id,
    actorRole: 'branch_lead',
    action: 'collection.create',
    entityType: 'collection',
    entityId: cA,
    branchId: a.id,
    reportId: rA.reportId,
    after: { amount: '100.00', collected_on: '2026-10-26', status: 'active' },
    requestId: 'req-create',
  });
  const otherB = await insertAudit({
    occurredAt: '2026-10-26T05:06:00Z',
    actorId: leadB.id,
    actorRole: 'branch_lead',
    action: 'collection.create',
    entityType: 'collection',
    entityId: cB,
    branchId: b.id,
    reportId: rB.reportId,
    after: { amount: '75.00' },
  });
  const draft = await insertAudit({
    occurredAt: '2026-10-26T05:00:00Z',
    actorId: null,
    actorRole: 'system',
    action: 'report.create_draft',
    entityType: 'report',
    entityId: rA.reportId,
    branchId: a.id,
    reportId: rA.reportId,
    after: { status: 'draft', week_start: '2026-10-26' },
  });
  const amend = await insertAudit({
    occurredAt: '2026-10-27T09:00:00Z',
    actorId: leadA.id,
    actorRole: 'branch_lead',
    action: 'collection.amend',
    entityType: 'collection',
    entityId: cA,
    branchId: a.id,
    reportId: rA.reportId,
    before: { amount: '100.00' },
    after: { amount: '150.00' },
  });
  const submit = await insertAudit({
    occurredAt: '2026-10-27T09:00:00Z',
    actorId: leadA.id,
    actorRole: 'branch_lead',
    action: 'report.submit',
    entityType: 'report',
    entityId: rA.reportId,
    branchId: a.id,
    reportId: rA.reportId,
    before: { status: 'draft' },
    after: { status: 'submitted', total_amount: '150.00', collection_count: 1, version: 1 },
  });
  // Same entity id under another entity type must not reach the collection timeline.
  const decoy = await insertAudit({
    occurredAt: '2026-10-27T10:00:00Z',
    actorId: leadA.id,
    actorRole: 'branch_lead',
    action: 'member.update',
    entityType: 'member',
    entityId: cA,
    branchId: a.id,
    reportId: null,
  });

  f = {
    admin: actorOf(admin),
    finance: actorOf(finance),
    editor: actorOf(editor),
    leadA: actorOf(leadA),
    leadB: actorOf(leadB),
    hrA: actorOf(hrA),
    leadAName: leadA.name,
    reportA: rA.reportId,
    reportB: rB.reportId,
    collectionA: cA,
    collectionB: cB,
    ids: { create, draft, amend, submit, otherB, decoy },
  };
});

afterAll(async () => {
  await closeTestPool();
});

async function notFoundBodies(read: (id: string) => Promise<unknown>, ids: string[]) {
  const bodies = [];
  for (const id of ids) {
    const error = await read(id).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 404 });
    bodies.push(mapError(error, 'req').body);
  }
  return bodies;
}

describe('getReportTimeline', () => {
  it('lists every row of the report in occurred_at then id order with field changes', async () => {
    const entries = await getReportTimeline(db, f.leadA, f.reportA);
    expect(entries.map((e) => e.id)).toEqual([
      f.ids.draft,
      f.ids.create,
      f.ids.amend,
      f.ids.submit,
    ]);
    expect(entries.map((e) => e.action)).toEqual([
      'report.create_draft',
      'collection.create',
      'collection.amend',
      'report.submit',
    ]);

    const [draft, create, amend, submit] = entries;
    expect(draft).toMatchObject({
      actorName: null,
      actorRole: 'system',
      entityType: 'report',
      entityId: f.reportA,
      occurredAt: '2026-10-26T05:00:00.000Z',
      requestId: null,
    });
    expect(create).toMatchObject({
      actorName: f.leadAName,
      actorRole: 'branch_lead',
      entityType: 'collection',
      entityId: f.collectionA,
      requestId: 'req-create',
    });
    expect(create!.changes).toEqual([
      { field: 'amount', before: null, after: '100.00' },
      { field: 'collected_on', before: null, after: '2026-10-26' },
      { field: 'status', before: null, after: 'active' },
    ]);
    expect(amend!.changes).toEqual([{ field: 'amount', before: '100.00', after: '150.00' }]);
    expect(submit!.changes).toEqual([
      { field: 'collection_count', before: null, after: 1 },
      { field: 'status', before: 'draft', after: 'submitted' },
      { field: 'total_amount', before: null, after: '150.00' },
      { field: 'version', before: null, after: 1 },
    ]);
    expect(entries.some((e) => e.id === f.ids.otherB)).toBe(false);
  });

  it('gives the same 404 for another branch, a missing id and a malformed id', async () => {
    const bodies = await notFoundBodies(
      (id) => getReportTimeline(db, f.leadA, id),
      [f.reportB, randomUUID(), 'not-a-uuid'],
    );
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('lets finance and super admin read every branch', async () => {
    for (const actor of [f.finance, f.admin]) {
      expect((await getReportTimeline(db, actor, f.reportA)).map((e) => e.id)).toHaveLength(4);
      expect((await getReportTimeline(db, actor, f.reportB)).map((e) => e.id)).toEqual([
        f.ids.otherB,
      ]);
    }
  });

  it('forbids HR leads and content editors', async () => {
    await expect(getReportTimeline(db, f.hrA, f.reportA)).rejects.toBeInstanceOf(Forbidden);
    await expect(getReportTimeline(db, f.editor, f.reportA)).rejects.toBeInstanceOf(Forbidden);
  });

  it('returns an empty list for a visible report with no audit rows', async () => {
    const r = await seedReport(db, {
      branchId: f.leadA.branchId!,
      weekStart: '2026-10-19',
    });
    expect(await getReportTimeline(db, f.leadA, r.reportId)).toEqual([]);
  });
});

describe('getCollectionTimeline', () => {
  it('lists only collection rows for that collection, in order', async () => {
    const entries = await getCollectionTimeline(db, f.leadA, f.collectionA);
    expect(entries.map((e) => e.id)).toEqual([f.ids.create, f.ids.amend]);
    expect(entries.every((e) => e.entityType === 'collection')).toBe(true);
  });

  it('gives the same 404 for another branch, a missing id and a malformed id', async () => {
    const bodies = await notFoundBodies(
      (id) => getCollectionTimeline(db, f.leadA, id),
      [f.collectionB, randomUUID(), 'not-a-uuid'],
    );
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('applies the same role rules', async () => {
    expect(await getCollectionTimeline(db, f.leadB, f.collectionB)).toHaveLength(1);
    expect(await getCollectionTimeline(db, f.finance, f.collectionA)).toHaveLength(2);
    expect(await getCollectionTimeline(db, f.admin, f.collectionB)).toHaveLength(1);
    await expect(getCollectionTimeline(db, f.hrA, f.collectionA)).rejects.toBeInstanceOf(Forbidden);
    await expect(getCollectionTimeline(db, f.editor, f.collectionA)).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});
