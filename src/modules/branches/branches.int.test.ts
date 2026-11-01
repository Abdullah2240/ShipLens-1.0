import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { mapError } from '@/platform/errors';
import { fixedClock } from '@/platform/time';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
  type BranchRow,
} from '../../../tests/support/db';
import { createBranch, getBranch, listBranches, transitionBranch, updateBranch } from './service';

const db = testPool();

type Fixture = {
  a: BranchRow;
  b: BranchRow;
  admin: Actor;
  finance: Actor;
  editor: Actor;
  leadA: Actor;
  hrA: Actor;
  leadB: Actor;
};
let f: Fixture;

const ctx = (actor: Actor | null): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock: fixedClock('2026-11-02T06:00:00Z'),
  pool: db,
});
const actorOf = (u: { id: string; role: string; branch_id: string | null }): Actor => ({
  userId: u.id,
  role: u.role as Actor['role'],
  branchId: u.branch_id,
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
const statusOf = async (id: string) =>
  (await db.query<{ status: string }>('SELECT status FROM branches WHERE id = $1', [id])).rows[0]!
    .status;

async function insertReport(
  branchId: string,
  weekStart: string,
  path: ('submitted' | 'returned' | 'approved')[] = [],
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO weekly_reports (branch_id, week_start, status) VALUES ($1, $2, 'draft') RETURNING id",
    [branchId, weekStart],
  );
  const id = rows[0]!.id;
  for (const status of path)
    await db.query('UPDATE weekly_reports SET status = $2 WHERE id = $1', [id, status]);
  return id;
}
async function insertCollection(
  branchId: string,
  reportId: string,
  collectedOn: string,
  status: 'active' | 'voided' = 'active',
): Promise<void> {
  await db.query(
    `INSERT INTO collections (branch_id, report_id, amount, collected_on, purpose, status, void_reason, created_by)
     VALUES ($1, $2, '100.00', $3, 'general', $4, $5, $6)`,
    [
      branchId,
      reportId,
      collectedOn,
      status,
      status === 'voided' ? 'duplicate' : null,
      f.leadA.userId,
    ],
  );
}

beforeEach(async () => {
  await resetDb(db);
  const a = await seedBranch(db, { name: 'Alpha Branch', status: 'active' });
  const b = await seedBranch(db, { name: 'Bravo Branch', status: 'active' });
  f = {
    a,
    b,
    admin: actorOf(await seedUser(db, { role: 'super_admin' })),
    finance: actorOf(await seedUser(db, { role: 'finance_reviewer' })),
    editor: actorOf(await seedUser(db, { role: 'content_editor' })),
    leadA: actorOf(await seedUser(db, { role: 'branch_lead', branchId: a.id })),
    hrA: actorOf(await seedUser(db, { role: 'hr_lead', branchId: a.id })),
    leadB: actorOf(await seedUser(db, { role: 'branch_lead', branchId: b.id })),
  };
});
afterAll(() => closeTestPool());

describe('createBranch', () => {
  it('creates a forming branch with a sequence code and one allowlisted audit row', async () => {
    const created = await createBranch(ctx(f.admin), {
      name: 'Karachi East',
      city: 'Karachi',
      summary: 'New hub',
    });
    expect(created.status).toBe('forming');
    expect(created.code).toMatch(/^BR\d{3,}$/);
    expect(created).toMatchObject({
      name: 'Karachi East',
      city: 'Karachi',
      summary: 'New hub',
      leads: [],
      leadCount: 0,
      allowedTransitions: ['active', 'closed'],
      openReportCount: 0,
    });
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'branch.create',
      entity_type: 'branch',
      entity_id: created.id,
      branch_id: created.id,
      before: null,
    });
    expect(rows[0]!.after).toEqual({
      code: created.code,
      name: 'Karachi East',
      city: 'Karachi',
      status: 'forming',
      summary: 'New hub',
    });
  });

  it('refuses a duplicate name in any case', async () => {
    await createBranch(ctx(f.admin), { name: 'Multan' });
    await expect(createBranch(ctx(f.admin), { name: 'MULTAN' })).rejects.toMatchObject({
      status: 409,
      code: 'duplicate_branch_name',
    });
    await expect(createBranch(ctx(f.admin), { name: 'alpha branch' })).rejects.toMatchObject({
      code: 'duplicate_branch_name',
    });
    expect(await audits()).toHaveLength(1);
  });

  it('gives concurrent creates distinct codes', async () => {
    const created = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => createBranch(ctx(f.admin), { name: `Parallel ${n}` })),
    );
    expect(new Set(created.map((x) => x.code)).size).toBe(5);
    for (const branch of created) expect(branch.code).toMatch(/^BR\d{3,}$/);
  });

  it('is refused for roles without branch.create and for a missing actor', async () => {
    await expect(createBranch(ctx(f.leadA), { name: 'Nope' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(createBranch(ctx(f.finance), { name: 'Nope' })).rejects.toMatchObject({
      status: 403,
    });
    await expect(createBranch(ctx(null), { name: 'Nope' })).rejects.toMatchObject({ status: 401 });
    expect(await audits()).toHaveLength(0);
  });
});

describe('listBranches and getBranch', () => {
  it('scopes reads by role', async () => {
    const ids = (items: { id: string }[]) => items.map((x) => x.id).sort();
    const both = [f.a.id, f.b.id].sort();
    expect(ids(await listBranches(db, f.admin))).toEqual(both);
    expect(ids(await listBranches(db, f.finance))).toEqual(both);
    expect(ids(await listBranches(db, f.leadA))).toEqual([f.a.id]);
    expect(ids(await listBranches(db, f.hrA))).toEqual([f.a.id]);
    await expect(listBranches(db, f.editor)).rejects.toMatchObject({ status: 403 });
  });

  it('filters by status', async () => {
    await db.query("UPDATE branches SET status = 'forming' WHERE id = $1", [f.b.id]);
    expect((await listBranches(db, f.admin, { status: 'forming' })).map((x) => x.id)).toEqual([
      f.b.id,
    ]);
  });

  it('returns identical NotFound for out-of-scope, missing and malformed ids', async () => {
    const bodies: unknown[] = [];
    for (const id of [f.b.id, randomUUID(), 'not-a-uuid']) {
      const error = await getBranch(db, f.leadA, id).catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 404 });
      bodies.push(mapError(error, 'req').body);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  it('includes leads, allowed transitions and the open report count', async () => {
    const detail = await getBranch(db, f.leadA, f.a.id);
    expect(detail.leads.map((x) => x.userId).sort()).toEqual([f.leadA.userId, f.hrA.userId].sort());
    expect(detail.leadCount).toBe(2);
    expect(detail.allowedTransitions).toEqual(['paused', 'closed']);
    expect(detail.openReportCount).toBe(0);
    await insertReport(f.a.id, '2026-10-19', ['submitted']);
    expect((await getBranch(db, f.admin, f.a.id)).openReportCount).toBe(1);
  });
});

describe('transitionBranch', () => {
  it('walks the allowed path with one audit row per move', async () => {
    const created = await createBranch(ctx(f.admin), { name: 'Walker' });
    const path = ['active', 'paused', 'active', 'closed'] as const;
    let from = 'forming';
    for (const to of path) {
      const detail = await transitionBranch(ctx(f.admin), created.id, { to });
      expect(detail.status).toBe(to);
      const last = (await audits()).at(-1)!;
      expect(last).toMatchObject({
        action: 'branch.transition',
        entity_type: 'branch',
        entity_id: created.id,
        branch_id: created.id,
        before: { status: from },
        after: { status: to },
      });
      from = to;
    }
    expect(await audits()).toHaveLength(5);
    expect((await getBranch(db, f.admin, created.id)).allowedTransitions).toEqual([]);
  });

  it('refuses invalid moves with no audit row', async () => {
    const forming = await createBranch(ctx(f.admin), { name: 'Former' });
    const before = (await audits()).length;
    const invalid = async (id: string, to: 'forming' | 'active' | 'paused' | 'closed') =>
      expect(transitionBranch(ctx(f.admin), id, { to })).rejects.toMatchObject({
        status: 409,
        code: 'invalid_transition',
      });
    await invalid(forming.id, 'paused');
    await invalid(f.a.id, 'forming');
    await invalid(f.a.id, 'active');
    await db.query("UPDATE branches SET status = 'closed' WHERE id = $1", [f.b.id]);
    await invalid(f.b.id, 'active');
    expect(await audits()).toHaveLength(before);
  });

  it('lets exactly one of two concurrent transitions win', async () => {
    const results = await Promise.allSettled([
      transitionBranch(ctx(f.admin), f.a.id, { to: 'paused' }),
      transitionBranch(ctx(f.admin), f.a.id, { to: 'paused' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'invalid_transition',
    });
    expect(await statusOf(f.a.id)).toBe('paused');
    expect((await audits()).filter((r) => r.action === 'branch.transition')).toHaveLength(1);
  });

  it('gives NotFound for missing or out-of-scope branches and Forbidden without the action', async () => {
    await expect(
      transitionBranch(ctx(f.admin), randomUUID(), { to: 'paused' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      transitionBranch(ctx(f.admin), 'not-a-uuid', { to: 'paused' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(transitionBranch(ctx(f.leadA), f.a.id, { to: 'paused' })).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('close guard', () => {
  const blocked = async (id: string) => {
    await expect(transitionBranch(ctx(f.admin), id, { to: 'closed' })).rejects.toMatchObject({
      status: 409,
      code: 'branch_has_open_reports',
    });
    expect(await statusOf(id)).toBe('active');
    expect(await audits()).toHaveLength(0);
  };

  it('blocks closing while a report is submitted', async () => {
    await insertReport(f.a.id, '2026-10-19', ['submitted']);
    await blocked(f.a.id);
  });

  it('blocks closing while a report is returned', async () => {
    await insertReport(f.a.id, '2026-10-19', ['submitted', 'returned']);
    await blocked(f.a.id);
  });

  it('blocks closing while a draft holds an active collection', async () => {
    const report = await insertReport(f.a.id, '2026-10-26');
    await insertCollection(f.a.id, report, '2026-10-26');
    await blocked(f.a.id);
  });

  it('does not count empty drafts, voided-only drafts or approved reports', async () => {
    await insertReport(f.a.id, '2026-10-26');
    const voidedOnly = await insertReport(f.a.id, '2026-10-19');
    await insertCollection(f.a.id, voidedOnly, '2026-10-19', 'voided');
    const approved = await insertReport(f.a.id, '2026-10-12');
    await insertCollection(f.a.id, approved, '2026-10-12');
    await db.query("UPDATE weekly_reports SET status = 'submitted' WHERE id = $1", [approved]);
    await db.query("UPDATE weekly_reports SET status = 'approved' WHERE id = $1", [approved]);
    await insertReport(f.b.id, '2026-10-19', ['submitted']);
    expect((await getBranch(db, f.admin, f.a.id)).openReportCount).toBe(0);
    const closed = await transitionBranch(ctx(f.admin), f.a.id, { to: 'closed' });
    expect(closed.status).toBe('closed');
  });
});

describe('updateBranch', () => {
  it('audits only the changed fields', async () => {
    await db.query("UPDATE branches SET city = 'Lahore' WHERE id = $1", [f.a.id]);
    const updated = await updateBranch(ctx(f.admin), f.a.id, {
      name: 'Alpha Renamed',
      city: 'Lahore',
      summary: 'About',
    });
    expect(updated).toMatchObject({ name: 'Alpha Renamed', city: 'Lahore', summary: 'About' });
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'branch.update',
      entity_type: 'branch',
      entity_id: f.a.id,
      branch_id: f.a.id,
      before: { name: 'Alpha Branch', summary: null },
      after: { name: 'Alpha Renamed', summary: 'About' },
    });
    expect(Object.keys(rows[0]!.after!).sort()).toEqual(['name', 'summary']);
  });

  it('writes nothing for a no-op patch', async () => {
    const detail = await updateBranch(ctx(f.admin), f.a.id, { name: 'Alpha Branch', city: null });
    expect(detail.id).toBe(f.a.id);
    expect(await audits()).toHaveLength(0);
  });

  it('refuses a name another branch already uses', async () => {
    await expect(
      updateBranch(ctx(f.admin), f.a.id, { name: 'BRAVO BRANCH' }),
    ).rejects.toMatchObject({ code: 'duplicate_branch_name' });
    const renamed = await updateBranch(ctx(f.admin), f.a.id, { name: 'ALPHA BRANCH' });
    expect(renamed.name).toBe('ALPHA BRANCH');
  });

  it('refuses edits to a closed branch', async () => {
    await db.query("UPDATE branches SET status = 'closed' WHERE id = $1", [f.a.id]);
    await expect(updateBranch(ctx(f.admin), f.a.id, { name: 'Changed' })).rejects.toMatchObject({
      status: 409,
      code: 'branch_closed',
    });
    expect(await audits()).toHaveLength(0);
  });

  it('is scoped and authorized', async () => {
    await expect(updateBranch(ctx(f.admin), randomUUID(), { name: 'Ghost' })).rejects.toMatchObject(
      { status: 404 },
    );
    await expect(updateBranch(ctx(f.leadA), f.a.id, { name: 'Mine' })).rejects.toMatchObject({
      status: 403,
    });
  });
});
