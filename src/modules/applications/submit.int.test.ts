import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Conflict, ValidationFailed } from '@/platform/errors';
import { systemClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, testPool } from '../../../tests/support/db';
import { applicationInputSchema } from './schema';
import { submitApplication } from './service';

const db = testPool();
const context = () => ({ actor: null, requestId: randomUUID(), clock: systemClock, pool: db });
const input = (branchId: string, email = 'Ali@Example.com') =>
  applicationInputSchema.parse({
    fullName: 'Ali Khan',
    email,
    phone: '03001234567',
    message: 'Private statement',
    branchId,
  });

beforeEach(() => resetDb(db));
afterAll(() => closeTestPool());

describe('application submission', () => {
  it('stores a pending application and one redacted system audit row', async () => {
    const branch = await seedBranch(db);
    await submitApplication(context(), input(branch.id));
    const { rows } = await db.query('SELECT * FROM applications');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      branch_id: branch.id,
      email: 'ali@example.com',
      phone: '+923001234567',
    });
    const audit = (await db.query('SELECT * FROM audit_events')).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'application.submit',
      entity_type: 'application',
      actor_id: null,
      actor_role: 'system',
      branch_id: branch.id,
      after: { status: 'pending', branch_id: branch.id },
    });
    expect(JSON.stringify(audit[0])).not.toMatch(
      /Ali Khan|ali@example.com|923001234567|Private statement/i,
    );
  });

  it('rejects a duplicate pending email in the same branch without extra audit', async () => {
    const branch = await seedBranch(db);
    await submitApplication(context(), input(branch.id));
    await expect(
      submitApplication(context(), input(branch.id, 'ALI@EXAMPLE.COM')),
    ).rejects.toMatchObject({ status: 409, code: 'duplicate_application' });
    expect((await db.query('SELECT id FROM applications')).rows).toHaveLength(1);
    expect((await db.query('SELECT id FROM audit_events')).rows).toHaveLength(1);
  });

  it('permits a different branch and permits resubmission after a decision', async () => {
    const a = await seedBranch(db);
    const b = await seedBranch(db);
    await submitApplication(context(), input(a.id));
    await submitApplication(context(), input(b.id));
    await db.query("UPDATE applications SET status = 'declined' WHERE branch_id = $1", [a.id]);
    await submitApplication(context(), input(a.id));
    expect((await db.query('SELECT id FROM applications')).rows).toHaveLength(3);
  });

  it.each(['forming', 'paused', 'closed'] as const)('rejects %s branches', async (status) => {
    const branch = await seedBranch(db, { status });
    await expect(submitApplication(context(), input(branch.id))).rejects.toMatchObject({
      status: 422,
      details: { fields: [{ path: 'branchId', code: 'invalid_branch' }] },
    });
    expect((await db.query('SELECT id FROM applications')).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM audit_events')).rows).toHaveLength(0);
  });

  it('rejects an unknown branch', async () => {
    await expect(submitApplication(context(), input(randomUUID()))).rejects.toBeInstanceOf(
      ValidationFailed,
    );
    expect((await db.query('SELECT id FROM applications')).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM audit_events')).rows).toHaveLength(0);
  });

  it('allows only one of two concurrent identical submissions', async () => {
    const branch = await seedBranch(db);
    const results = await Promise.allSettled([
      submitApplication(context(), input(branch.id)),
      submitApplication(context(), input(branch.id)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected && rejected.status === 'rejected' && rejected.reason).toBeInstanceOf(Conflict);
    expect((await db.query('SELECT id FROM applications')).rows).toHaveLength(1);
    expect((await db.query('SELECT id FROM audit_events')).rows).toHaveLength(1);
  });
});
