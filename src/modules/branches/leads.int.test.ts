import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { fixedClock } from '@/platform/time';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
  type UserRow,
} from '../../../tests/support/db';
import { assignLead, listLeadCandidates } from './service';

const db = testPool();

let a: BranchRow;
let b: BranchRow;
let admin: Actor;
let finance: UserRow;
let editor: UserRow;
let leadA: UserRow;
let hrB: UserRow;

const ctx = (actor: Actor): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: fixedClock('2026-11-02T06:00:00Z'),
  pool: db,
});
const audits = async () =>
  (
    await db.query<{
      action: string;
      entity_type: string;
      entity_id: string;
      branch_id: string | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>(
      'SELECT action, entity_type, entity_id, branch_id, before, after FROM audit_events ORDER BY id',
    )
  ).rows;
const branchOf = async (userId: string) =>
  (
    await db.query<{ branch_id: string | null }>('SELECT branch_id FROM users WHERE id = $1', [
      userId,
    ])
  ).rows[0]!.branch_id;

beforeEach(async () => {
  await resetDb(db);
  a = await seedBranch(db, { name: 'Alpha Branch' });
  b = await seedBranch(db, { name: 'Bravo Branch' });
  const adminRow = await seedUser(db, { role: 'super_admin' });
  admin = { userId: adminRow.id, role: 'super_admin', branchId: null };
  finance = await seedUser(db, { role: 'finance_reviewer' });
  editor = await seedUser(db, { role: 'content_editor' });
  leadA = await seedUser(db, { role: 'branch_lead', branchId: a.id, name: 'Zara Lead' });
  hrB = await seedUser(db, { role: 'hr_lead', branchId: b.id, name: 'Hina HR' });
});
afterAll(() => closeTestPool());

describe('assignLead', () => {
  it('moves the user to the branch with one audit row on the user', async () => {
    const detail = await assignLead(ctx(admin), a.id, { userId: hrB.id });
    expect(await branchOf(hrB.id)).toBe(a.id);
    expect(detail.leads.map((x) => x.userId).sort()).toEqual([leadA.id, hrB.id].sort());
    expect(detail.leads.find((x) => x.userId === hrB.id)).toEqual({
      userId: hrB.id,
      name: 'Hina HR',
      email: hrB.email,
      role: 'hr_lead',
    });
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'branch.assign_lead',
      entity_type: 'user',
      entity_id: hrB.id,
      branch_id: a.id,
    });
    expect(rows[0]!.before).toMatchObject({ branch_id: b.id });
    expect(rows[0]!.after).toMatchObject({ branch_id: a.id, role: 'hr_lead' });
  });

  it('refuses users who are not active branch or HR leads', async () => {
    const inactive = await seedUser(db, { role: 'branch_lead', branchId: b.id });
    await db.query('UPDATE users SET is_active = false WHERE id = $1', [inactive.id]);
    for (const userId of [finance.id, editor.id, randomUUID(), inactive.id]) {
      await expect(assignLead(ctx(admin), a.id, { userId })).rejects.toMatchObject({
        status: 422,
        details: { fields: [{ path: 'userId', code: 'invalid_user' }] },
      });
    }
    expect(await audits()).toHaveLength(0);
  });

  it('refuses assignment to a closed branch', async () => {
    await db.query("UPDATE branches SET status = 'closed' WHERE id = $1", [a.id]);
    await expect(assignLead(ctx(admin), a.id, { userId: hrB.id })).rejects.toMatchObject({
      status: 409,
      code: 'branch_closed',
    });
    expect(await branchOf(hrB.id)).toBe(b.id);
    expect(await audits()).toHaveLength(0);
  });

  it('writes nothing when the user is already on the branch', async () => {
    const detail = await assignLead(ctx(admin), a.id, { userId: leadA.id });
    expect(detail.leads.map((x) => x.userId)).toEqual([leadA.id]);
    expect(await audits()).toHaveLength(0);
  });

  it('is limited to super admins and to existing branches', async () => {
    const leadActor: Actor = { userId: leadA.id, role: 'branch_lead', branchId: a.id };
    await expect(assignLead(ctx(leadActor), a.id, { userId: hrB.id })).rejects.toMatchObject({
      status: 403,
    });
    await expect(assignLead(ctx(admin), randomUUID(), { userId: hrB.id })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('listLeadCandidates', () => {
  it('lists active leads with their branch names for super admins', async () => {
    const candidates = await listLeadCandidates(db, admin);
    expect(candidates).toEqual([
      {
        userId: leadA.id,
        name: 'Zara Lead',
        email: leadA.email,
        role: 'branch_lead',
        branchId: a.id,
        branchName: 'Alpha Branch',
      },
      {
        userId: hrB.id,
        name: 'Hina HR',
        email: hrB.email,
        role: 'hr_lead',
        branchId: b.id,
        branchName: 'Bravo Branch',
      },
    ]);
  });

  it('is refused for finance reviewers', async () => {
    await expect(
      listLeadCandidates(db, { userId: finance.id, role: 'finance_reviewer', branchId: null }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
