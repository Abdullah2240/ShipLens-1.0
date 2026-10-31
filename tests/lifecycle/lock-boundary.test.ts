import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  amendCollection,
  createCollection,
  getCollection,
  voidCollection,
} from '@/modules/collections';
import { ensureCurrentWeekDrafts, returnReport, submitReport } from '@/modules/reports';
import { closePool } from '@/platform/db';
import { fixedClock, type DateString } from '@/platform/time';
import { closeTestPool } from '../support/db';
import { ctxOf, db, lifecycleWorld, type World } from './support';

// PKT is UTC+5 with no daylight saving: 00:00 PKT is 19:00Z on the previous UTC day.
// A collection dated 2026-11-02 (Monday) stays editable through 2026-11-09 PKT (day 7).
const DAY0 = '2026-11-02';
const DAY6 = '2026-11-08T10:00:00Z';
const DAY7_LAST_SECOND = '2026-11-09T18:59:59Z';
const DAY8_MIDNIGHT = '2026-11-09T19:00:00Z';

let w: World;
let clock: ReturnType<typeof fixedClock>;

beforeEach(async () => {
  w = await lifecycleWorld();
  clock = fixedClock('2026-11-02T05:00:00Z');
});
afterAll(async () => {
  await closePool();
  await closeTestPool();
});

const lead = () => ctxOf(w.leadA, clock);
const leadActor = () => ({ userId: w.leadA.id, role: w.leadA.role, branchId: w.leadA.branchId });
const log = (collectedOn: DateString, amount = '100.00') =>
  createCollection(lead(), { amount, collectedOn, purpose: 'Weekly dues' });
const fieldCode = (code: string) => ({
  status: 422,
  details: { fields: [expect.objectContaining({ path: 'collectedOn', code })] },
});
const lastAction = async () =>
  (await db.query<{ action: string }>('SELECT action FROM audit_events ORDER BY id DESC LIMIT 1'))
    .rows[0]?.action;

describe('7-day lock at PKT midnight', () => {
  it('keeps a collection editable through 23:59:59 PKT on day 7 and locks it at 00:00 PKT on day 8', async () => {
    const first = await log(DAY0, '100.00');
    const second = await log(DAY0, '200.00');

    clock.set(DAY6);
    await expect(amendCollection(lead(), first.id, { amount: '110.00' })).resolves.toMatchObject({
      amount: '110.00',
    });

    clock.set(DAY7_LAST_SECOND);
    expect((await getCollection(db, leadActor(), clock, first.id)).lock).toEqual({
      lastEditableOn: '2026-11-09',
      locked: false,
      daysLeft: 0,
    });
    await expect(amendCollection(lead(), first.id, { amount: '120.00' })).resolves.toMatchObject({
      amount: '120.00',
    });

    clock.set(DAY8_MIDNIGHT);
    expect((await getCollection(db, leadActor(), clock, first.id)).lock).toEqual({
      lastEditableOn: '2026-11-09',
      locked: true,
      daysLeft: 0,
    });
    await expect(amendCollection(lead(), first.id, { amount: '130.00' })).rejects.toMatchObject({
      status: 409,
      code: 'collection_locked',
    });

    clock.set('2026-11-10T00:00:00Z');
    await expect(
      voidCollection(lead(), second.id, { reason: 'Entered twice' }),
    ).rejects.toMatchObject({ status: 409, code: 'collection_locked' });

    const rows = await db.query(
      'SELECT amount, status, void_reason FROM collections ORDER BY amount',
    );
    expect(rows.rows).toEqual([
      { amount: '120.00', status: 'active', void_reason: null },
      { amount: '200.00', status: 'active', void_reason: null },
    ]);
  });

  it('turns tomorrow into today and the oldest date into a locked one at the same instant', async () => {
    clock.set(DAY7_LAST_SECOND);
    await expect(log('2026-11-10')).rejects.toMatchObject(fieldCode('future_date'));
    await expect(log(DAY0)).resolves.toMatchObject({ collectedOn: DAY0, weekStart: DAY0 });

    clock.set(DAY8_MIDNIGHT);
    await expect(log('2026-11-10')).resolves.toMatchObject({
      collectedOn: '2026-11-10',
      weekStart: '2026-11-09',
    });
    await expect(log(DAY0)).rejects.toMatchObject(fieldCode('outside_lock_window'));
    expect(
      Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM collections')).rows[0]!.n),
    ).toBe(2);
  });
});

describe('PKT week rollover', () => {
  it('puts Sunday 23:59 PKT in the old week and Monday 00:00 PKT in the new one', async () => {
    clock.set('2026-11-08T18:59:00Z');
    const sunday = await log('2026-11-08');
    expect(sunday.weekStart).toBe('2026-11-02');
    await expect(log('2026-11-09')).rejects.toMatchObject(fieldCode('future_date'));

    clock.set('2026-11-08T19:00:00Z');
    const monday = await log('2026-11-09');
    expect(monday.weekStart).toBe('2026-11-09');
    expect(monday.reportId).not.toBe(sunday.reportId);

    const reports = await db.query<{ id: string; week_start: string }>(
      'SELECT id, week_start FROM weekly_reports WHERE branch_id = $1 ORDER BY week_start',
      [w.branchA],
    );
    expect(reports.rows).toEqual([
      { id: sunday.reportId, week_start: '2026-11-02' },
      { id: monday.reportId, week_start: '2026-11-09' },
    ]);
  });

  it('creates the current-week draft for the old week before midnight and the new week after', async () => {
    const weeksOf = async () =>
      (
        await db.query<{ week_start: string }>(
          'SELECT week_start FROM weekly_reports WHERE branch_id = $1 ORDER BY week_start',
          [w.branchB],
        )
      ).rows.map((r) => r.week_start);

    clock.set('2026-11-08T18:59:00Z');
    expect(await ensureCurrentWeekDrafts(ctxOf(w.leadB, clock))).toBe(1);
    expect(await weeksOf()).toEqual(['2026-11-02']);

    clock.set('2026-11-08T19:00:00Z');
    expect(await ensureCurrentWeekDrafts(ctxOf(w.leadB, clock))).toBe(1);
    expect(await weeksOf()).toEqual(['2026-11-02', '2026-11-09']);
  });
});

describe('returned-report exemption', () => {
  it('lets a locked collection be amended once its report is returned, audited as an exemption', async () => {
    const item = await log(DAY0, '100.00');

    clock.set('2026-11-11T10:00:00Z');
    await expect(amendCollection(lead(), item.id, { amount: '90.00' })).rejects.toMatchObject({
      status: 409,
      code: 'collection_locked',
    });

    await submitReport(lead(), item.reportId, {});
    await returnReport(ctxOf(w.finance1, clock), item.reportId, { reason: 'Amount looks wrong' });

    const amended = await amendCollection(lead(), item.id, { amount: '90.00' });
    expect(amended.amount).toBe('90.00');
    expect(await lastAction()).toBe('collection.amend_exempt');
  });
});
