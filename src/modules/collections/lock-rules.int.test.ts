import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { fixedClock, type Clock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { seedReport } from '../../../tests/support/finance-fixtures';
import { amendCollection, getCollection, voidCollection } from './service';

// The lock turns at 00:00 PKT on day 8. PKT is UTC+5, so for a collection dated
// 2026-11-02 the last editable instant is 2026-11-09T18:59:59Z.
const db = testPool();
const LAST_EDITABLE = '2026-11-09T18:59:59Z';
const LOCKED = '2026-11-09T19:00:00Z';

let lead: Actor;
let finance: Actor;
let branchId: string;
let clock: ReturnType<typeof fixedClock>;

const ctx = (c: Clock = clock): CommandContext => ({
  actor: lead,
  requestId: randomUUID(),
  clock: c,
  pool: db,
});
const lastAction = async () =>
  (await db.query<{ action: string }>('SELECT action FROM audit_events ORDER BY id DESC LIMIT 1'))
    .rows[0]?.action;

async function seedWeek(status: 'draft' | 'returned') {
  return seedReport(db, {
    branchId,
    weekStart: '2026-11-02',
    status,
    ...(status === 'returned' ? { submittedBy: lead.userId, reviewedBy: finance.userId } : {}),
    collections: [
      { amount: '100', collectedOn: '2026-11-02', createdBy: lead.userId },
      { amount: '200', collectedOn: '2026-11-02', createdBy: lead.userId },
    ],
  });
}

beforeEach(async () => {
  await resetDb(db);
  const branch = await seedBranch(db, { status: 'active' });
  branchId = branch.id;
  const u = await seedUser(db, { role: 'branch_lead', branchId });
  lead = { userId: u.id, role: 'branch_lead', branchId };
  const fin = await seedUser(db, { role: 'finance_reviewer' });
  finance = { userId: fin.id, role: 'finance_reviewer', branchId: null };
  clock = fixedClock(LAST_EDITABLE);
});
afterAll(() => closeTestPool());

describe('lock boundary at PKT midnight', () => {
  it('allows an amend at 23:59:59 PKT on day 7 and refuses it from 00:00 on day 8', async () => {
    const { collectionIds } = await seedWeek('draft');
    const id = collectionIds[0]!;
    const item = await getCollection(db, lead, clock, id);
    expect(item.lock).toEqual({ lastEditableOn: '2026-11-09', locked: false, daysLeft: 0 });

    await expect(amendCollection(ctx(), id, { amount: '110' })).resolves.toMatchObject({
      amount: '110.00',
    });
    expect(await lastAction()).toBe('collection.amend');

    clock.set(LOCKED);
    expect((await getCollection(db, lead, clock, id)).editability).toBe('locked');
    await expect(amendCollection(ctx(), id, { amount: '120' })).rejects.toMatchObject({
      status: 409,
      code: 'collection_locked',
    });
    await expect(
      voidCollection(ctx(), collectionIds[1]!, { reason: 'Too late' }),
    ).rejects.toMatchObject({ status: 409, code: 'collection_locked' });
    const amounts = await db.query<{ amount: string; status: string }>(
      'SELECT amount, status FROM collections WHERE id = ANY($1) ORDER BY amount',
      [collectionIds],
    );
    expect(amounts.rows).toEqual([
      { amount: '110.00', status: 'active' },
      { amount: '200.00', status: 'active' },
    ]);
  });
});

describe('returned report exemption', () => {
  it('reopens locked collections with exempt audit actions', async () => {
    const { collectionIds } = await seedWeek('returned');
    clock.set(LOCKED);
    expect((await getCollection(db, lead, clock, collectionIds[0]!)).editability).toBe(
      'editable_exempt',
    );
    await expect(
      amendCollection(ctx(), collectionIds[0]!, { purpose: 'Corrected purpose' }),
    ).resolves.toMatchObject({ purpose: 'Corrected purpose' });
    expect(await lastAction()).toBe('collection.amend_exempt');
    await expect(
      voidCollection(ctx(), collectionIds[1]!, { reason: 'Finance asked' }),
    ).resolves.toMatchObject({ status: 'voided', voidReason: 'Finance asked' });
    expect(await lastAction()).toBe('collection.void_exempt');
  });

  it('uses the plain actions inside the window', async () => {
    const { collectionIds } = await seedWeek('returned');
    await amendCollection(ctx(), collectionIds[0]!, { purpose: 'Corrected purpose' });
    expect(await lastAction()).toBe('collection.amend');
    await voidCollection(ctx(), collectionIds[1]!, { reason: 'Finance asked' });
    expect(await lastAction()).toBe('collection.void');
  });
});
