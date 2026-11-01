import { afterAll, beforeEach, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { listBranchOptions } from './service-teams';

const db = testPool();
beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());
it('returns only scoped branch id and name', async () => {
  const a = await seedBranch(db, { name: 'Alpha' });
  const b = await seedBranch(db, { name: 'Beta' });
  const hr = await seedUser(db, { role: 'hr_lead', branchId: a.id });
  const lead = await seedUser(db, { role: 'branch_lead', branchId: a.id });
  const admin = await seedUser(db, { role: 'super_admin' });
  const finance = await seedUser(db, { role: 'finance_reviewer' });
  expect(await listBranchOptions(db, { userId: hr.id, role: 'hr_lead', branchId: a.id })).toEqual([
    { id: a.id, name: a.name },
  ]);
  expect(
    await listBranchOptions(db, { userId: lead.id, role: 'branch_lead', branchId: a.id }),
  ).toEqual([{ id: a.id, name: a.name }]);
  expect(
    await listBranchOptions(db, { userId: admin.id, role: 'super_admin', branchId: null }),
  ).toEqual([
    { id: a.id, name: a.name },
    { id: b.id, name: b.name },
  ]);
  await expect(
    listBranchOptions(db, { userId: finance.id, role: 'finance_reviewer', branchId: null }),
  ).rejects.toMatchObject({ status: 403 });
});
