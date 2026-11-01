import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { getProfile } from './service';
import type { SessionUser } from './types';

const pool = testPool();

function sessionUser(row: {
  id: string;
  email: string;
  name: string;
  role: string;
  branch_id: string | null;
}): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as SessionUser['role'],
    branchId: row.branch_id,
  };
}

beforeEach(async () => {
  await resetDb(pool);
});

afterAll(async () => {
  await closeTestPool();
});

describe('getProfile', () => {
  it('adds the branch name for a branch-scoped user', async () => {
    const branch = await seedBranch(pool, { name: 'Lahore Central', city: 'Lahore' });
    const lead = await seedUser(pool, {
      role: 'branch_lead',
      branchId: branch.id,
      name: 'Omar Siddiqui',
    });

    const profile = await getProfile(pool, sessionUser(lead));

    expect(profile).toEqual({
      id: lead.id,
      email: lead.email,
      name: 'Omar Siddiqui',
      role: 'branch_lead',
      branchId: branch.id,
      branchName: 'Lahore Central',
    });
  });

  it('returns a null branch name for head-office roles', async () => {
    await seedBranch(pool);
    const admin = await seedUser(pool, { role: 'super_admin', name: 'Amina Khan' });

    const profile = await getProfile(pool, sessionUser(admin));

    expect(profile.branchId).toBeNull();
    expect(profile.branchName).toBeNull();
    expect(profile.name).toBe('Amina Khan');
  });

  it('reads the branch name from the database, not from the caller', async () => {
    const own = await seedBranch(pool, { name: 'Own Branch' });
    const other = await seedBranch(pool, { name: 'Other Branch' });
    const hr = await seedUser(pool, { role: 'hr_lead', branchId: own.id });

    // A stale branchId on the session user cannot surface another branch's name.
    const profile = await getProfile(pool, { ...sessionUser(hr), branchId: other.id });

    expect(profile.branchName).toBe('Own Branch');
  });

  it('only reads: no rows change', async () => {
    const branch = await seedBranch(pool);
    const lead = await seedUser(pool, { role: 'branch_lead', branchId: branch.id });
    const before = await pool.query('SELECT count(*)::int AS n FROM audit_events');

    await getProfile(pool, sessionUser(lead));

    const after = await pool.query('SELECT count(*)::int AS n FROM audit_events');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
