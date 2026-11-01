import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import {
  amendCollection,
  createCollection,
  getCollection,
  getCurrentWeek,
  listCollections,
  voidCollection,
} from './service';

const db = testPool();
// PKT Wednesday 2026-11-04, 11:00. The previous PKT week runs Mon 2026-10-26 to Sun 2026-11-01.
const NOW = '2026-11-04T06:00:00Z';

const ctx = (actor: Actor | null): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: fixedClock(NOW),
  pool: db,
});

const count = async (table: 'collections' | 'weekly_reports' | 'audit_events') =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;

const invalid = (path: string, code: string) => ({
  status: 422,
  details: { fields: [expect.objectContaining({ path, code })] },
});

let lead: Actor;

beforeEach(async () => {
  await resetDb(db);
  const branch = await seedBranch(db, { status: 'active' });
  const user = await seedUser(db, { role: 'branch_lead', branchId: branch.id });
  lead = { userId: user.id, role: 'branch_lead', branchId: branch.id };
});
afterAll(() => closeTestPool());

describe('collections service without a session', () => {
  it('answers every entry point with 401 and writes nothing', async () => {
    const id = randomUUID();
    const q = { limit: 25 };
    const calls = [
      () => listCollections(db, null as unknown as Actor, fixedClock(NOW), q),
      () => getCollection(db, null as unknown as Actor, fixedClock(NOW), id),
      () => getCurrentWeek(db, null as unknown as Actor, fixedClock(NOW)),
      () =>
        createCollection(ctx(null), {
          amount: '100',
          collectedOn: '2026-11-03',
          purpose: 'Ration packs',
        }),
      () => amendCollection(ctx(null), id, { amount: '200' }),
      () => voidCollection(ctx(null), id, { reason: 'Duplicate entry' }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    }
    expect(await count('collections')).toBe(0);
    expect(await count('audit_events')).toBe(0);
  });
});

describe('a lead whose branch row no longer exists', () => {
  it('gets NotFound for the current week and cannot create a draft or a collection', async () => {
    const stale: Actor = { ...lead, branchId: randomUUID() };
    await expect(getCurrentWeek(db, stale, fixedClock(NOW))).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      createCollection(ctx(stale), {
        amount: '100',
        collectedOn: '2026-11-03',
        purpose: 'Ration packs',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await count('weekly_reports')).toBe(0);
    expect(await count('collections')).toBe(0);
    expect(await count('audit_events')).toBe(0);
  });
});

describe('input that is not an object', () => {
  it('reports the whole body as invalid instead of a blank path', async () => {
    await expect(
      createCollection(ctx(lead), null as unknown as Parameters<typeof createCollection>[1]),
    ).rejects.toMatchObject({
      status: 422,
      details: { fields: [expect.objectContaining({ path: 'body' })] },
    });
    expect(await count('weekly_reports')).toBe(0);
  });
});

describe('moving a date inside its week across the 7-day lock boundary', () => {
  it('accepts day 7 (today) and refuses day 8 even though the row itself is still editable', async () => {
    // Sunday of last week: editable through 2026-11-08, so the row is in normal mode.
    const item = await createCollection(ctx(lead), {
      amount: '500',
      collectedOn: '2026-11-01',
      purpose: 'Ration packs',
    });
    expect(item).toMatchObject({ weekStart: '2026-10-26', editability: 'editable' });
    const auditsBefore = await count('audit_events');

    // 2026-10-27 + 7 = 2026-11-03, already past: locked from 00:00 PKT on 2026-11-04.
    await expect(
      amendCollection(ctx(lead), item.id, { collectedOn: '2026-10-27' }),
    ).rejects.toMatchObject(invalid('collectedOn', 'outside_lock_window'));
    expect(await count('audit_events')).toBe(auditsBefore);
    expect((await getCollection(db, lead, fixedClock(NOW), item.id)).collectedOn).toBe(
      '2026-11-01',
    );

    // 2026-10-28 + 7 = 2026-11-04, which is today: still inside the window.
    const moved = await amendCollection(ctx(lead), item.id, { collectedOn: '2026-10-28' });
    expect(moved.collectedOn).toBe('2026-10-28');
    expect(moved.lock).toEqual({ lastEditableOn: '2026-11-04', locked: false, daysLeft: 0 });
    expect(await count('audit_events')).toBe(auditsBefore + 1);
  });
});
