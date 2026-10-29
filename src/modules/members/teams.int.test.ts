import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { systemClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { createTeam, listTeams, renameTeam } from './service-teams';

const db = testPool();
beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());
it('scopes teams, rejects duplicate names, and audits exact actions', async () => {
  const a = await seedBranch(db);
  const b = await seedBranch(db);
  const ua = await seedUser(db, { role: 'hr_lead', branchId: a.id });
  const actor = { userId: ua.id, role: 'hr_lead' as const, branchId: a.id };
  const ctx = () => ({ actor, requestId: randomUUID(), clock: systemClock, pool: db });
  const team = await createTeam(ctx(), { name: 'Outreach' });
  expect(team.branchId).toBe(a.id);
  await expect(createTeam(ctx(), { name: 'outreach' })).rejects.toMatchObject({
    code: 'duplicate_team',
  });
  await expect(createTeam(ctx(), { name: 'Other', branchId: b.id })).rejects.toMatchObject({
    status: 404,
  });
  expect((await listTeams(db, actor)).map((x) => x.id)).toEqual([team.id]);
  await renameTeam(ctx(), team.id, { name: 'Updated' });
  expect(
    (await db.query('SELECT action FROM audit_events ORDER BY id')).rows.map((x) => x.action),
  ).toEqual(['team.create', 'team.rename']);
});

it('requires a real branch for administrators and denies foreign renames', async () => {
  const a = await seedBranch(db);
  const b = await seedBranch(db);
  const hr = await seedUser(db, { role: 'hr_lead', branchId: a.id });
  const lead = await seedUser(db, { role: 'branch_lead', branchId: a.id });
  const admin = await seedUser(db, { role: 'super_admin' });
  const hrActor = { userId: hr.id, role: 'hr_lead' as const, branchId: a.id };
  const adminActor = { userId: admin.id, role: 'super_admin' as const, branchId: null };
  const context = (
    actor:
      | typeof hrActor
      | typeof adminActor
      | { userId: string; role: 'branch_lead'; branchId: string },
  ) => ({ actor, requestId: randomUUID(), clock: systemClock, pool: db });
  await expect(createTeam(context(adminActor), { name: 'Missing' })).rejects.toMatchObject({
    details: { fields: [{ path: 'branchId', code: 'required', message: 'required' }] },
  });
  await expect(
    createTeam(context(adminActor), { name: 'Unknown', branchId: randomUUID() }),
  ).rejects.toMatchObject({ status: 422 });
  const foreign = await createTeam(context(adminActor), { name: 'Outreach', branchId: b.id });
  await expect(renameTeam(context(hrActor), foreign.id, { name: 'Other' })).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    createTeam(context({ userId: lead.id, role: 'branch_lead', branchId: a.id }), {
      name: 'Denied',
    }),
  ).rejects.toMatchObject({ status: 403 });
  const local = await createTeam(context(hrActor), { name: 'Outreach' });
  expect(local.branchId).toBe(a.id);
  const second = await createTeam(context(hrActor), { name: 'Second' });
  await expect(renameTeam(context(hrActor), second.id, { name: 'outreach' })).rejects.toMatchObject(
    { code: 'duplicate_team' },
  );
});
