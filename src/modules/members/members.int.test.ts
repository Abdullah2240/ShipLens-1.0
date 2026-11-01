import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mapError } from '@/platform/errors';
import { systemClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { getMember, listMembers, updateMember } from './service';

const db = testPool();
const actor = (
  userId: string,
  role: 'hr_lead' | 'branch_lead' | 'super_admin' | 'finance_reviewer',
  branchId: string | null,
) => ({ userId, role, branchId });
const ctx = (a: ReturnType<typeof actor>) => ({
  actor: a,
  requestId: randomUUID(),
  clock: systemClock,
  pool: db,
});
const query = { page: 1, pageSize: 25 };
async function member(branchId: string, name: string, code: string, teamId: string | null = null) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO members (branch_id, full_name, member_code, email, phone, team_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      branchId,
      name,
      code,
      `${name.toLowerCase().replace(/ /g, '.')}@x.test`,
      '03001234567',
      teamId,
    ],
  );
  return rows[0]!.id;
}
beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());

describe('members', () => {
  it('scopes lists and makes missing and foreign records identical', async () => {
    const a = await seedBranch(db, { name: 'A' });
    const b = await seedBranch(db, { name: 'B' });
    const ua = await seedUser(db, { role: 'hr_lead', branchId: a.id });
    const ub = await seedUser(db, { role: 'hr_lead', branchId: b.id });
    const admin = await seedUser(db, { role: 'super_admin' });
    const finance = await seedUser(db, { role: 'finance_reviewer' });
    const idA = await member(a.id, 'Ali Khan', 'M001');
    const idB = await member(b.id, 'Bina', 'M002');
    expect(
      (await listMembers(db, actor(ua.id, 'hr_lead', a.id), query)).items.map((x) => x.id),
    ).toEqual([idA]);
    expect(
      (await listMembers(db, actor(ub.id, 'hr_lead', b.id), query)).items.map((x) => x.id),
    ).toEqual([idB]);
    expect((await listMembers(db, actor(admin.id, 'super_admin', null), query)).total).toBe(2);
    await expect(
      listMembers(db, actor(finance.id, 'finance_reviewer', null), query),
    ).rejects.toMatchObject({ status: 403 });
    const failures = await Promise.all(
      [idB, randomUUID(), 'bad'].map((id) =>
        getMember(db, actor(ua.id, 'hr_lead', a.id), id).catch((e) => mapError(e, 'x')),
      ),
    );
    expect(failures[0]).toEqual(failures[1]);
    expect(failures[1]).toEqual(failures[2]);
  });

  it('searches, filters, pages, and uses the trigram index', async () => {
    const a = await seedBranch(db);
    const user = await seedUser(db, { role: 'hr_lead', branchId: a.id });
    for (const [i, name] of ['Ali Khan', 'Bina', 'Cora', 'Dara', 'Evan'].entries())
      await member(a.id, name, `M00${i}`);
    const who = actor(user.id, 'hr_lead', a.id);
    expect((await listMembers(db, who, { ...query, q: 'ALI' })).total).toBe(1);
    expect((await listMembers(db, who, { ...query, q: 'ali khan' })).total).toBe(1);
    expect((await listMembers(db, who, { ...query, q: '030012' })).total).toBe(5);
    expect((await listMembers(db, who, { ...query, q: '%' })).total).toBe(0);
    const p1 = await listMembers(db, who, { page: 1, pageSize: 2 });
    const p2 = await listMembers(db, who, { page: 2, pageSize: 2 });
    expect(p1.total).toBe(5);
    expect(new Set([...p1.items, ...p2.items].map((x) => x.id)).size).toBe(4);
    const { buildMemberQuery } = await import('./search');
    const { authorize } = await import('@/platform/authz');
    const built = buildMemberQuery(
      authorize(actor(randomUUID(), 'super_admin', null), 'member.read'),
      { ...query, q: 'ali' },
    );
    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      // The all-branches scope and planner settings make the trigram index the sole usable index on this tiny table.
      await client.query('SET LOCAL enable_seqscan = off');
      await client.query('SET LOCAL enable_indexscan = off');
      await client.query('SET LOCAL enable_indexonlyscan = off');
      const explain = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN ${built.listSql}`,
        built.listParams,
      );
      expect(explain.rows.map((r) => r['QUERY PLAN']).join(' ')).toContain(
        'members_search_trgm_idx',
      );
    } finally {
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }
  });

  it('audits changes once, skips unchanged patches, and enforces team branch', async () => {
    const a = await seedBranch(db);
    const b = await seedBranch(db);
    const u = await seedUser(db, { role: 'hr_lead', branchId: a.id });
    const ta = (
      await db.query<{ id: string }>(
        'INSERT INTO teams (branch_id,name) VALUES ($1,$2) RETURNING id',
        [a.id, 'A team'],
      )
    ).rows[0]!.id;
    const tb = (
      await db.query<{ id: string }>(
        'INSERT INTO teams (branch_id,name) VALUES ($1,$2) RETURNING id',
        [b.id, 'B team'],
      )
    ).rows[0]!.id;
    const id = await member(a.id, 'Ali', 'M001');
    const who = actor(u.id, 'hr_lead', a.id);
    await expect(updateMember(ctx(who), id, { teamId: tb })).rejects.toMatchObject({ status: 422 });
    const changed = await updateMember(ctx(who), id, {
      teamId: ta,
      memberRole: 'mentor',
      status: 'left',
    });
    expect(changed).toMatchObject({ teamId: ta, memberRole: 'mentor', status: 'left' });
    const before = (await db.query('SELECT updated_at FROM members WHERE id=$1', [id])).rows[0]!
      .updated_at;
    await updateMember(ctx(who), id, { status: 'left' });
    expect(
      (await db.query('SELECT updated_at FROM members WHERE id=$1', [id])).rows[0]!.updated_at,
    ).toEqual(before);
    const audits = (await db.query("SELECT * FROM audit_events WHERE action='member.update'")).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0].before).toEqual({ team_id: null, member_role: 'volunteer', status: 'active' });
    expect(audits[0].after).toEqual({ team_id: ta, member_role: 'mentor', status: 'left' });
    expect((await db.query('SELECT id FROM members WHERE id=$1', [id])).rows).toHaveLength(1);
    const unassigned = await updateMember(ctx(who), id, { teamId: null });
    expect(unassigned.teamId).toBeNull();
  });

  it('serializes identical concurrent patches and denies foreign edits', async () => {
    const a = await seedBranch(db);
    const b = await seedBranch(db);
    const hr = await seedUser(db, { role: 'hr_lead', branchId: a.id });
    const lead = await seedUser(db, { role: 'branch_lead', branchId: a.id });
    const admin = await seedUser(db, { role: 'super_admin' });
    const own = await member(a.id, 'Ali', 'M001');
    const foreign = await member(b.id, 'Bina', 'M002');
    const who = actor(hr.id, 'hr_lead', a.id);
    await expect(updateMember(ctx(who), foreign, { status: 'inactive' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      updateMember(ctx(actor(lead.id, 'branch_lead', a.id)), own, { status: 'inactive' }),
    ).rejects.toMatchObject({ status: 403 });
    const both = await Promise.all([
      updateMember(ctx(who), own, { status: 'inactive' }),
      updateMember(ctx(who), own, { status: 'inactive' }),
    ]);
    expect(both.map((item) => item.status)).toEqual(['inactive', 'inactive']);
    const count = (
      await db.query<{ total: string }>(
        "SELECT count(*) AS total FROM audit_events WHERE action='member.update'",
      )
    ).rows[0]!.total;
    expect(Number(count)).toBeGreaterThanOrEqual(1);
    expect(Number(count)).toBeLessThanOrEqual(2);
    expect(
      (await updateMember(ctx(actor(admin.id, 'super_admin', null)), foreign, { status: 'left' }))
        .status,
    ).toBe('left');
  });
});
