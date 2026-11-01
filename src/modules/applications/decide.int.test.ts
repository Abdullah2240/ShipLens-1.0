import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { CommandContext } from '@/platform/audit/types';
import type { Actor } from '@/platform/authz';
import { ID_FORMATS } from '@/platform/config/constants';
import { Conflict, Forbidden, NotFound, Unauthenticated, mapError } from '@/platform/errors';
import { fixedClock, pktDate, systemClock, type Clock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../../../tests/support/db';
import { acceptApplication, declineApplication } from './service-review';

const db = testPool();
type Role = Actor['role'];

// One context per call: a context is never shared between concurrent commands.
const ctx = (actor: Actor | null, clock: Clock = systemClock): CommandContext => ({
  actor,
  requestId: randomUUID(),
  clock,
  pool: db,
});

async function fixture() {
  const a = await seedBranch(db, { name: 'Lahore' });
  const b = await seedBranch(db, { name: 'Karachi' });
  const make = async (role: Role, branchId: string | null = null): Promise<Actor> => {
    const user = await seedUser(db, { role, branchId });
    return { userId: user.id, role, branchId: user.branch_id };
  };
  return {
    a,
    b,
    hrA: await make('hr_lead', a.id),
    hrB: await make('hr_lead', b.id),
    leadA: await make('branch_lead', a.id),
    admin: await make('super_admin'),
    finance: await make('finance_reviewer'),
    editor: await make('content_editor'),
  };
}

let seq = 0;
const APPLICANT = {
  name: (n: number) => `Zarnigar Applicant${n}`,
  email: (n: number) => `zarnigar.${n}@private.test`,
  phone: (n: number) => `+9230055${String(n).padStart(5, '0')}`,
  message: (n: number) => `Secret motivation text ${n}`,
};
async function application(branchId: string): Promise<{ id: string; n: number }> {
  seq += 1;
  const n = seq;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO applications (branch_id, full_name, email, phone, message)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [branchId, APPLICANT.name(n), APPLICANT.email(n), APPLICANT.phone(n), APPLICANT.message(n)],
  );
  return { id: rows[0]!.id, n };
}

async function appRow(id: string) {
  const { rows } = await db.query<{
    status: string;
    decided_by: string | null;
    decided_at: Date | null;
    decision_note: string | null;
  }>('SELECT status, decided_by, decided_at, decision_note FROM applications WHERE id = $1', [id]);
  return rows[0]!;
}
async function membersFor(applicationId: string) {
  return (
    await db.query<{
      id: string;
      member_code: string;
      branch_id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      member_role: string;
      status: string;
      joined_on: string | null;
      team_id: string | null;
    }>('SELECT * FROM members WHERE application_id = $1', [applicationId])
  ).rows;
}
async function audits(where = 'TRUE', params: unknown[] = []) {
  return (
    await db.query<{
      request_id: string;
      action: string;
      entity_type: string;
      entity_id: string;
      branch_id: string | null;
      actor_id: string | null;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    }>(`SELECT * FROM audit_events WHERE ${where} ORDER BY id`, params)
  ).rows;
}
async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await db.query<{ n: string }>(sql, params)).rows[0]!.n);
}

const conflict = { status: 409, code: 'already_decided' };

beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());

describe('acceptApplication', () => {
  it('creates exactly one member with an automatic code in the same transaction', async () => {
    const f = await fixture();
    const app = await application(f.a.id);
    // 20:00 UTC is already the next calendar day in Pakistan.
    const clock = fixedClock('2026-10-31T20:00:00Z');
    const context = ctx(f.hrA, clock);
    const result = await acceptApplication(context, app.id);

    expect(result.applicationId).toBe(app.id);
    expect(result.memberCode).toMatch(/^M\d{5}$/);
    const members = await membersFor(app.id);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      id: result.memberId,
      member_code: result.memberCode,
      branch_id: f.a.id,
      full_name: APPLICANT.name(app.n),
      email: APPLICANT.email(app.n),
      phone: APPLICANT.phone(app.n),
      member_role: 'volunteer',
      status: 'active',
      team_id: null,
      joined_on: '2026-11-01',
    });
    expect(members[0]!.joined_on).toBe(pktDate(clock.now()));

    const row = await appRow(app.id);
    expect(row.status).toBe('accepted');
    expect(row.decided_by).toBe(f.hrA.userId);
    expect(row.decided_at?.toISOString()).toBe('2026-10-31T20:00:00.000Z');

    const rows = await audits();
    expect(rows.map((r) => [r.action, r.entity_type])).toEqual([
      ['application.accept', 'application'],
      ['member.create', 'member'],
    ]);
    expect(new Set(rows.map((r) => r.request_id))).toEqual(new Set([context.requestId]));
    expect(rows.every((r) => r.actor_id === f.hrA.userId && r.branch_id === f.a.id)).toBe(true);
    expect(rows[0]).toMatchObject({
      entity_id: app.id,
      before: { status: 'pending' },
      after: { status: 'accepted' },
    });
    expect(rows[1]).toMatchObject({ entity_id: result.memberId, before: null });
    expect(rows[1]!.after).toEqual({
      member_code: result.memberCode,
      branch_id: f.a.id,
      member_role: 'volunteer',
      status: 'active',
    });
    const serialised = JSON.stringify(rows);
    for (const secret of [
      APPLICANT.name(app.n),
      'Zarnigar',
      APPLICANT.email(app.n),
      APPLICANT.phone(app.n),
      APPLICANT.message(app.n),
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('takes codes from member_id_seq using the configured format without truncation', async () => {
    const f = await fixture();
    const first = await acceptApplication(ctx(f.hrA), (await application(f.a.id)).id);
    const second = await acceptApplication(ctx(f.hrA), (await application(f.a.id)).id);
    expect(first.memberCode).not.toBe(second.memberCode);

    const { prefix, digits } = ID_FORMATS.memberId;
    const saved = (
      await db.query<{ last_value: string; is_called: boolean }>(
        'SELECT last_value::text, is_called FROM member_id_seq',
      )
    ).rows[0]!;
    try {
      await db.query("SELECT setval('member_id_seq', 41)");
      const padded = await acceptApplication(ctx(f.hrA), (await application(f.a.id)).id);
      expect(padded.memberCode).toBe(`${prefix}${'42'.padStart(digits, '0')}`);
      const wide = 10 ** digits;
      await db.query("SELECT setval('member_id_seq', $1)", [wide - 1]);
      const wideCode = await acceptApplication(ctx(f.hrA), (await application(f.a.id)).id);
      expect(wideCode.memberCode).toBe(`${prefix}${wide}`);
    } finally {
      await db.query("SELECT setval('member_id_seq', $1, $2)", [saved.last_value, saved.is_called]);
    }
  });

  it('refuses a missing actor', async () => {
    const f = await fixture();
    const app = await application(f.a.id);
    await expect(acceptApplication(ctx(null), app.id)).rejects.toBeInstanceOf(Unauthenticated);
    await expect(declineApplication(ctx(null), app.id, {})).rejects.toBeInstanceOf(Unauthenticated);
    expect((await appRow(app.id)).status).toBe('pending');
  });

  it('rolls everything back when the member insert fails', async () => {
    const f = await fixture();
    const app = await application(f.a.id);
    await db.query(
      `INSERT INTO members (branch_id, member_code, full_name, application_id)
       VALUES ($1, 'X-PRESET', 'Preset', $2)`,
      [f.a.id, app.id],
    );
    const error = await acceptApplication(ctx(f.hrA), app.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Conflict);
    expect(error).toMatchObject(conflict);
    expect((await appRow(app.id)).status).toBe('pending');
    expect(await audits()).toHaveLength(0);
    expect(await membersFor(app.id)).toHaveLength(1);
  });
});

describe('declineApplication', () => {
  it('declines with a note, creates no member and audits only status and note', async () => {
    const f = await fixture();
    const app = await application(f.a.id);
    const context = ctx(f.hrA, fixedClock('2026-10-30T08:00:00Z'));
    await declineApplication(context, app.id, { note: 'Not this season' });
    const row = await appRow(app.id);
    expect(row).toMatchObject({
      status: 'declined',
      decision_note: 'Not this season',
      decided_by: f.hrA.userId,
    });
    expect(row.decided_at?.toISOString()).toBe('2026-10-30T08:00:00.000Z');
    expect(await membersFor(app.id)).toHaveLength(0);
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'application.decline',
      entity_type: 'application',
      entity_id: app.id,
      branch_id: f.a.id,
      request_id: context.requestId,
    });
    expect(rows[0]!.after).toEqual({ status: 'declined', decision_note: 'Not this season' });
    const serialised = JSON.stringify(rows);
    for (const secret of ['Zarnigar', APPLICANT.email(app.n), APPLICANT.message(app.n)]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('declines without a note', async () => {
    const f = await fixture();
    const app = await application(f.a.id);
    await declineApplication(ctx(f.hrA), app.id, {});
    expect(await appRow(app.id)).toMatchObject({ status: 'declined', decision_note: null });
    expect((await audits())[0]!.after).toEqual({ status: 'declined' });
  });
});

describe('second decisions', () => {
  const steps = {
    accept: (c: CommandContext, id: string) => acceptApplication(c, id),
    decline: (c: CommandContext, id: string) => declineApplication(c, id, { note: 'again' }),
  };
  it.each([
    ['accept', 'accept'],
    ['accept', 'decline'],
    ['decline', 'accept'],
    ['decline', 'decline'],
  ] as const)('%s then %s is refused with already_decided', async (firstStep, secondStep) => {
    const f = await fixture();
    const app = await application(f.a.id);
    await steps[firstStep](ctx(f.hrA), app.id);
    const statusBefore = await appRow(app.id);
    const auditCount = (await audits()).length;
    const error = await steps[secondStep](ctx(f.hrA), app.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Conflict);
    expect(error).toMatchObject(conflict);
    expect(await appRow(app.id)).toEqual(statusBefore);
    expect(await membersFor(app.id)).toHaveLength(firstStep === 'accept' ? 1 : 0);
    expect(await audits()).toHaveLength(auditCount);
  });
});

describe('concurrency', () => {
  it('two concurrent accepts create exactly one member (repeated 5 times)', async () => {
    const f = await fixture();
    for (let round = 0; round < 5; round += 1) {
      const app = await application(f.a.id);
      const outcomes = await Promise.allSettled([
        acceptApplication(ctx(f.hrA), app.id),
        acceptApplication(ctx(f.hrA), app.id),
      ]);
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      expect(fulfilled, `round ${round}`).toHaveLength(1);
      expect(rejected, `round ${round}`).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(Conflict);
      expect(rejected[0]!.reason).toMatchObject(conflict);
      expect(await membersFor(app.id)).toHaveLength(1);
      expect(
        await count(
          "SELECT count(*) AS n FROM audit_events WHERE action = 'member.create' AND entity_id = $1",
          [(await membersFor(app.id))[0]!.id],
        ),
      ).toBe(1);
      expect(
        await count(
          "SELECT count(*) AS n FROM audit_events WHERE action = 'application.accept' AND entity_id = $1",
          [app.id],
        ),
      ).toBe(1);
    }
    expect(await count('SELECT count(*) AS n FROM members')).toBe(5);
  });

  it('a concurrent accept and decline produce exactly one decision', async () => {
    const f = await fixture();
    for (let round = 0; round < 3; round += 1) {
      const app = await application(f.a.id);
      const outcomes = await Promise.allSettled([
        acceptApplication(ctx(f.hrA), app.id),
        declineApplication(ctx(f.hrA), app.id, {}),
      ]);
      const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject(conflict);
      const status = (await appRow(app.id)).status;
      const accepted = outcomes[0]!.status === 'fulfilled';
      expect(status).toBe(accepted ? 'accepted' : 'declined');
      expect(await membersFor(app.id)).toHaveLength(accepted ? 1 : 0);
      expect(
        await count('SELECT count(*) AS n FROM audit_events WHERE entity_id = $1', [app.id]),
      ).toBe(1);
    }
  });
});

describe('scope', () => {
  it('hides other-branch applications behind the same NotFound as a missing one', async () => {
    const f = await fixture();
    const foreign = await application(f.b.id);
    const bodies = [];
    for (const attempt of [
      (id: string) => acceptApplication(ctx(f.hrA), id),
      (id: string) => declineApplication(ctx(f.hrA), id, { note: 'x' }),
    ]) {
      for (const id of [foreign.id, randomUUID(), 'not-a-uuid']) {
        const error = await attempt(id).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotFound);
        bodies.push(mapError(error, 'req'));
      }
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect((await appRow(foreign.id)).status).toBe('pending');
    expect(await membersFor(foreign.id)).toHaveLength(0);
    expect(await audits()).toHaveLength(0);
  });

  it('lets Super Admin decide any branch', async () => {
    const f = await fixture();
    const accepted = await application(f.b.id);
    const declined = await application(f.a.id);
    const result = await acceptApplication(ctx(f.admin), accepted.id);
    await declineApplication(ctx(f.admin), declined.id, {});
    expect((await membersFor(accepted.id))[0]).toMatchObject({
      id: result.memberId,
      branch_id: f.b.id,
    });
    expect((await appRow(declined.id)).status).toBe('declined');
    expect((await audits())[0]).toMatchObject({ branch_id: f.b.id, actor_id: f.admin.userId });
  });

  it('refuses roles without application.decide', async () => {
    const f = await fixture();
    const app = await application(f.a.id);
    for (const actor of [f.leadA, f.finance, f.editor]) {
      await expect(acceptApplication(ctx(actor), app.id)).rejects.toBeInstanceOf(Forbidden);
      await expect(declineApplication(ctx(actor), app.id, {})).rejects.toBeInstanceOf(Forbidden);
    }
    expect((await appRow(app.id)).status).toBe('pending');
    expect(await count('SELECT count(*) AS n FROM members')).toBe(0);
    expect(await audits()).toHaveLength(0);
  });
});
