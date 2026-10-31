import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from '@/platform/authz';
import { Forbidden, NotFound, mapError } from '@/platform/errors';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { getApplication, listApplications } from './service-review';

const db = testPool();
type Role = Actor['role'];

async function fixture() {
  const a = await seedBranch(db, { name: 'Lahore' });
  const b = await seedBranch(db, { name: 'Karachi' });
  const make = async (role: Role, branchId: string | null = null): Promise<Actor> => {
    const user = await seedUser(db, { role, branchId });
    return { userId: user.id, role, branchId: user.branch_id };
  };
  const hrA = await make('hr_lead', a.id);
  const hrB = await make('hr_lead', b.id);
  const leadA = await make('branch_lead', a.id);
  const admin = await make('super_admin');
  const finance = await make('finance_reviewer');
  const editor = await make('content_editor');
  return { a, b, hrA, hrB, leadA, admin, finance, editor };
}

let seq = 0;
async function application(
  branchId: string,
  opts: { status?: 'pending' | 'accepted' | 'declined'; minutesAgo?: number; name?: string } = {},
): Promise<string> {
  seq += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO applications (branch_id, full_name, email, phone, message, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-10-01T09:00:00Z'::timestamptz - ($7 * interval '1 minute'))
     RETURNING id`,
    [
      branchId,
      opts.name ?? `Applicant ${seq}`,
      `applicant${seq}@example.test`,
      '+923001234567',
      `Message ${seq}`,
      opts.status ?? 'pending',
      opts.minutesAgo ?? seq,
    ],
  );
  return rows[0]!.id;
}

const query = { page: 1, pageSize: 25 };

beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());

describe('listApplications', () => {
  it('scopes HR Leads to their own branch and lets Super Admin see all', async () => {
    const f = await fixture();
    const a1 = await application(f.a.id, { minutesAgo: 30 });
    const a2 = await application(f.a.id, { minutesAgo: 10, status: 'accepted' });
    const b1 = await application(f.b.id, { minutesAgo: 20 });

    const own = await listApplications(db, f.hrA, query);
    expect(own.items.map((x) => x.id)).toEqual([a2, a1]);
    expect(own.total).toBe(2);
    expect(own).toMatchObject({ page: 1, pageSize: 25 });
    expect(own.items[0]).toMatchObject({
      branchId: f.a.id,
      branchName: 'Lahore',
      status: 'accepted',
      email: expect.stringMatching(/@example\.test$/),
      phone: '+923001234567',
    });
    expect(own.items[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(own.items[0]).not.toHaveProperty('message');

    const other = await listApplications(db, f.hrB, query);
    expect(other.items.map((x) => x.id)).toEqual([b1]);

    const all = await listApplications(db, f.admin, query);
    expect(all.total).toBe(3);
    expect(all.items.map((x) => x.id)).toEqual([a2, b1, a1]);
    expect(new Set(all.items.map((x) => x.branchName))).toEqual(new Set(['Lahore', 'Karachi']));
  });

  it('filters by status', async () => {
    const f = await fixture();
    const pending = await application(f.a.id);
    await application(f.a.id, { status: 'accepted' });
    await application(f.a.id, { status: 'declined' });
    await application(f.b.id);
    const result = await listApplications(db, f.hrA, { ...query, status: 'pending' });
    expect(result.items.map((x) => x.id)).toEqual([pending]);
    expect(result.total).toBe(1);
    expect((await listApplications(db, f.hrA, { ...query, status: 'declined' })).total).toBe(1);
  });

  it('pages newest first with a stable id tie-break', async () => {
    const f = await fixture();
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await application(f.a.id, { minutesAgo: 5 }));
    await application(f.b.id, { minutesAgo: 5 });
    const pages = await Promise.all(
      [1, 2, 3].map((page) => listApplications(db, f.hrA, { page, pageSize: 2 })),
    );
    expect(pages.map((p) => p.items.length)).toEqual([2, 2, 1]);
    expect(pages.every((p) => p.total === 5)).toBe(true);
    const seen = pages.flatMap((p) => p.items.map((x) => x.id));
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual([...ids].sort());
  });

  it('refuses roles without application.read', async () => {
    const f = await fixture();
    for (const actor of [f.leadA, f.finance, f.editor]) {
      await expect(listApplications(db, actor, query)).rejects.toBeInstanceOf(Forbidden);
    }
  });
});

describe('getApplication', () => {
  it('returns own-branch detail including the message', async () => {
    const f = await fixture();
    const id = await application(f.a.id, { name: 'Ayesha Malik' });
    const detail = await getApplication(db, f.hrA, id);
    expect(detail).toMatchObject({
      id,
      fullName: 'Ayesha Malik',
      branchId: f.a.id,
      branchName: 'Lahore',
      status: 'pending',
      message: expect.stringMatching(/^Message /),
      decisionNote: null,
      decidedAt: null,
      decidedByName: null,
      memberId: null,
      memberCode: null,
    });
    expect((await getApplication(db, f.admin, id)).id).toBe(id);
  });

  it('gives identical NotFound for another branch, a random UUID and a non-UUID', async () => {
    const f = await fixture();
    const foreign = await application(f.b.id);
    const failures = await Promise.all(
      [foreign, randomUUID(), 'not-a-uuid'].map((id) =>
        getApplication(db, f.hrA, id).then(
          () => {
            throw new Error('expected NotFound');
          },
          (error: unknown) => {
            expect(error).toBeInstanceOf(NotFound);
            return mapError(error, 'req');
          },
        ),
      ),
    );
    expect(failures[0]).toEqual(failures[1]);
    expect(failures[1]).toEqual(failures[2]);
    expect(failures[0]!.status).toBe(404);
  });

  it('fills decision and member fields for an accepted application', async () => {
    const f = await fixture();
    const id = await application(f.a.id);
    const decider = await seedUser(db, { role: 'hr_lead', branchId: f.a.id, name: 'Sana HR' });
    await db.query(
      `UPDATE applications SET status='accepted', decided_by=$2, decided_at=now(), decision_note='ok' WHERE id=$1`,
      [id, decider.id],
    );
    const member = await db.query<{ id: string }>(
      `INSERT INTO members (branch_id, member_code, full_name, application_id) VALUES ($1, 'M00042', 'X', $2) RETURNING id`,
      [f.a.id, id],
    );
    const detail = await getApplication(db, f.hrA, id);
    expect(detail).toMatchObject({
      status: 'accepted',
      decisionNote: 'ok',
      decidedByName: 'Sana HR',
      memberId: member.rows[0]!.id,
      memberCode: 'M00042',
    });
    expect(detail.decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('refuses roles without application.read', async () => {
    const f = await fixture();
    const id = await application(f.a.id);
    for (const actor of [f.leadA, f.finance, f.editor]) {
      await expect(getApplication(db, actor, id)).rejects.toBeInstanceOf(Forbidden);
    }
  });
});
