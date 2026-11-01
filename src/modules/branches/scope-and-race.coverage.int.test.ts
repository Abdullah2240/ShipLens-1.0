import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import { authorize, type Actor } from '@/platform/authz';
import { fixedClock } from '@/platform/time';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
} from '../../../tests/support/db';
import {
  branchVisible,
  countOpenReports,
  lockBranch,
  lockUserForAssignment,
  updateBranchFields,
  updateBranchStatus,
} from './repo';
import { transitionBranch } from './service';

const db = testPool();

let a: BranchRow;
let b: BranchRow;
let admin: Actor;
let leadA: Actor;

const allScope = () => authorize(admin, 'branch.read');
const ownScope = () => authorize(leadA, 'branch.read');

const ctx = (actor: Actor): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: fixedClock('2026-11-04T06:00:00Z'),
  pool: db,
});

const branchRow = async (id: string) =>
  (
    await db.query<{ name: string; city: string | null; status: string; updated_at: Date }>(
      'SELECT name, city, status, updated_at FROM branches WHERE id = $1',
      [id],
    )
  ).rows[0]!;

beforeEach(async () => {
  await resetDb(db);
  a = await seedBranch(db, { name: 'Alpha', status: 'forming' });
  b = await seedBranch(db, { name: 'Bravo', status: 'active' });
  const adminRow = await seedUser(db, { role: 'super_admin' });
  const leadRow = await seedUser(db, { role: 'branch_lead', branchId: a.id });
  admin = { userId: adminRow.id, role: 'super_admin', branchId: null };
  leadA = { userId: leadRow.id, role: 'branch_lead', branchId: a.id };
});
afterAll(() => closeTestPool());

describe('branch row lookups stay inside the caller scope', () => {
  it('lockBranch returns the own branch and answers malformed and foreign ids with NotFound', async () => {
    const own = await db.connect();
    try {
      await own.query('BEGIN');
      await expect(lockBranch(own, ownScope(), a.id)).resolves.toMatchObject({
        id: a.id,
        name: 'Alpha',
        status: 'forming',
      });
      await expect(lockBranch(own, ownScope(), b.id)).rejects.toMatchObject({ status: 404 });
      await expect(lockBranch(own, allScope(), 'not-a-uuid')).rejects.toMatchObject({
        status: 404,
      });
      await expect(lockBranch(own, allScope(), randomUUID())).rejects.toMatchObject({
        status: 404,
      });
    } finally {
      await own.query('ROLLBACK');
      own.release();
    }
  });

  it('branchVisible is false for malformed, unknown and foreign ids and true in scope', async () => {
    expect(await branchVisible(db, ownScope(), a.id)).toBe(true);
    expect(await branchVisible(db, ownScope(), b.id)).toBe(false);
    expect(await branchVisible(db, allScope(), b.id)).toBe(true);
    expect(await branchVisible(db, allScope(), randomUUID())).toBe(false);
    expect(await branchVisible(db, allScope(), "x' OR 1=1 --")).toBe(false);
  });

  it('lockUserForAssignment returns null for malformed and unknown ids', async () => {
    expect(await lockUserForAssignment(db, 'nope', { forUpdate: false })).toBeNull();
    expect(await lockUserForAssignment(db, randomUUID(), { forUpdate: false })).toBeNull();
    await expect(lockUserForAssignment(db, leadA.userId, { forUpdate: false })).resolves.toEqual({
      id: leadA.userId,
      role: 'branch_lead',
      branchId: a.id,
      isActive: true,
    });
  });

  it('countOpenReports is zero for an unknown branch', async () => {
    expect(await countOpenReports(db, randomUUID())).toBe(0);
    expect(await countOpenReports(db, a.id)).toBe(0);
  });
});

describe('branch writes', () => {
  it('updateBranchFields with nothing to change issues no update', async () => {
    const before = await branchRow(a.id);
    await updateBranchFields(db, allScope(), a.id, {});
    expect(await branchRow(a.id)).toEqual(before);
  });

  it('updateBranchFields only writes rows inside the scope', async () => {
    await updateBranchFields(db, ownScope(), b.id, { name: 'Hijacked', city: 'Nowhere' });
    expect(await branchRow(b.id)).toMatchObject({ name: 'Bravo', city: null });
    await updateBranchFields(db, ownScope(), a.id, { city: 'Lahore' });
    expect(await branchRow(a.id)).toMatchObject({ name: 'Alpha', city: 'Lahore' });
  });

  it('updateBranchStatus changes nothing when the expected from status is stale', async () => {
    expect(await updateBranchStatus(db, allScope(), a.id, 'active', 'paused')).toBe(0);
    expect((await branchRow(a.id)).status).toBe('forming');
    expect(await updateBranchStatus(db, ownScope(), b.id, 'active', 'paused')).toBe(0);
    expect((await branchRow(b.id)).status).toBe('active');
    expect(await updateBranchStatus(db, allScope(), a.id, 'forming', 'active')).toBe(1);
    expect((await branchRow(a.id)).status).toBe('active');
  });
});

describe('concurrent branch transitions', () => {
  it('lets exactly one of two identical transitions win and audits it once (5 rounds)', async () => {
    for (let round = 0; round < 5; round += 1) {
      const branch = await seedBranch(db, { status: 'forming' });
      const results = await Promise.allSettled([
        transitionBranch(ctx(admin), branch.id, { to: 'active' }),
        transitionBranch(ctx(admin), branch.id, { to: 'active' }),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({
        status: 409,
        code: 'invalid_transition',
      });
      const { rows } = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_events
          WHERE action = 'branch.transition' AND entity_id = $1`,
        [branch.id],
      );
      expect(rows[0]!.n).toBe(1);
      expect((await branchRow(branch.id)).status).toBe('active');
    }
  });

  it('answers a transition on an id outside every branch with NotFound', async () => {
    await expect(
      transitionBranch(ctx(admin), randomUUID(), { to: 'active' }),
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
