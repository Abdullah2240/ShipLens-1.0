import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';

type PgError = { code?: string; constraint?: string; message?: string };

/** Run a statement that must fail and return the Postgres error for assertions. */
async function failure(sql: string, params: unknown[] = []): Promise<PgError> {
  try {
    await testPool().query(sql, params);
  } catch (err) {
    return err as PgError;
  }
  throw new Error(`expected statement to fail: ${sql}`);
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeTestPool();
});

async function seedReport(branchId: string, weekStart = '2026-10-19') {
  const { rows } = await testPool().query(
    'INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, $2) RETURNING id',
    [branchId, weekStart],
  );
  return rows[0].id as string;
}

describe('audit_events immutability', () => {
  async function insertEvent() {
    const { rows } = await testPool().query(
      "INSERT INTO audit_events (actor_role, action, entity_type, entity_id) VALUES ('system', 'test.created', 'thing', '1') RETURNING id",
    );
    return rows[0].id as string;
  }

  it('rejects UPDATE', async () => {
    const id = await insertEvent();
    const err = await failure("UPDATE audit_events SET action = 'x' WHERE id = $1", [id]);
    expect(err.message).toContain('append-only');
  });

  it('rejects DELETE', async () => {
    const id = await insertEvent();
    const err = await failure('DELETE FROM audit_events WHERE id = $1', [id]);
    expect(err.message).toContain('append-only');
  });

  it('rejects TRUNCATE unless shiplens.allow_truncate is on', async () => {
    await insertEvent();
    const err = await failure('TRUNCATE audit_events');
    expect(err.message).toContain('append-only');

    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('shiplens.allow_truncate', 'on', true)");
      await client.query('TRUNCATE audit_events');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const { rows } = await testPool().query('SELECT count(*)::int AS n FROM audit_events');
    expect(rows[0].n).toBe(0);
  });
});

describe('users and sessions', () => {
  it('rejects a branch_lead without a branch', async () => {
    const err = await failure(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('a@x.test', 'A', 'h', 'branch_lead')",
    );
    expect(err.constraint).toBe('users_role_branch_check');
  });

  it('rejects an hr_lead without a branch', async () => {
    const err = await failure(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('a@x.test', 'A', 'h', 'hr_lead')",
    );
    expect(err.constraint).toBe('users_role_branch_check');
  });

  it('rejects a super_admin with a branch', async () => {
    const branch = await seedBranch(testPool());
    const err = await failure(
      "INSERT INTO users (email, name, password_hash, role, branch_id) VALUES ('a@x.test', 'A', 'h', 'super_admin', $1)",
      [branch.id],
    );
    expect(err.constraint).toBe('users_role_branch_check');
  });

  it('rejects an unknown role', async () => {
    const err = await failure(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('a@x.test', 'A', 'h', 'owner')",
    );
    // an unknown role violates both role checks; Postgres reports whichever it evaluates first
    expect(err.code).toBe('23514');
    expect(['users_role_check', 'users_role_branch_check']).toContain(err.constraint);
  });

  it('rejects a duplicate lower(email)', async () => {
    await seedUser(testPool(), { role: 'super_admin', email: 'Dup@x.test' });
    const err = await failure(
      "INSERT INTO users (email, name, password_hash, role) VALUES ('dup@X.test', 'B', 'h', 'finance_reviewer')",
    );
    expect(err.constraint).toBe('users_email_lower_key');
  });

  it('rejects a duplicate session token_hash', async () => {
    const user = await seedUser(testPool(), { role: 'super_admin' });
    const sql =
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('abc', $1, now() + interval '1 day')";
    await testPool().query(sql, [user.id]);
    const err = await failure(sql, [user.id]);
    expect(err.constraint).toBe('sessions_token_hash_key');
  });
});

describe('weekly_reports and collections', () => {
  it('rejects a week_start that is not a Monday', async () => {
    const branch = await seedBranch(testPool());
    const err = await failure('INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, $2)', [
      branch.id,
      '2026-10-20',
    ]);
    expect(err.constraint).toBe('weekly_reports_week_start_monday');
  });

  it('rejects a second report for the same branch and week', async () => {
    const branch = await seedBranch(testPool());
    await seedReport(branch.id);
    const err = await failure('INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, $2)', [
      branch.id,
      '2026-10-19',
    ]);
    expect(err.constraint).toBe('weekly_reports_branch_week_key');
  });

  async function insertCollection(amount: string, extra = '') {
    const branch = await seedBranch(testPool());
    const user = await seedUser(testPool(), { role: 'branch_lead', branchId: branch.id });
    const reportId = await seedReport(branch.id);
    return failureOrRow(
      `INSERT INTO collections (branch_id, report_id, amount, collected_on, purpose, created_by${extra ? ', ' + extra.split('=')[0] : ''})
       VALUES ($1, $2, $3, '2026-10-20', 'zakat', $4${extra ? ', ' + extra.split('=')[1] : ''}) RETURNING id`,
      [branch.id, reportId, amount, user.id],
    );
  }

  async function failureOrRow(sql: string, params: unknown[]): Promise<{ err?: PgError; id?: string }> {
    try {
      const { rows } = await testPool().query(sql, params);
      return { id: rows[0].id };
    } catch (err) {
      return { err: err as PgError };
    }
  }

  it('rejects amount 0 and negative amounts', async () => {
    expect((await insertCollection('0')).err?.constraint).toBe('collections_amount_positive');
    expect((await insertCollection('-5.00')).err?.constraint).toBe('collections_amount_positive');
  });

  it('accepts a positive amount and leaves routed_at null', async () => {
    const result = await insertCollection('12.50');
    expect(result.err).toBeUndefined();
    const { rows } = await testPool().query('SELECT routed_at, amount FROM collections WHERE id = $1', [result.id]);
    expect(rows[0].routed_at).toBeNull();
    expect(rows[0].amount).toBe('12.50');
  });

  it('rejects a voided collection without void_reason', async () => {
    const result = await insertCollection('10.00', "status='voided'");
    expect(result.err?.constraint).toBe('collections_void_reason_required');
  });

  it('has a nullable routed_at timestamptz column', async () => {
    const { rows } = await testPool().query(
      "SELECT data_type, is_nullable FROM information_schema.columns WHERE table_name = 'collections' AND column_name = 'routed_at'",
    );
    expect(rows).toEqual([{ data_type: 'timestamp with time zone', is_nullable: 'YES' }]);
  });
});

describe('applications and members', () => {
  async function apply(branchId: string, email = 'Person@x.test') {
    const { rows } = await testPool().query(
      "INSERT INTO applications (branch_id, full_name, email) VALUES ($1, 'Person', $2) RETURNING id",
      [branchId, email],
    );
    return rows[0].id as string;
  }

  it('rejects a second pending application, but allows one once the first is declined', async () => {
    const branch = await seedBranch(testPool());
    const first = await apply(branch.id);
    const err = await failure("INSERT INTO applications (branch_id, full_name, email) VALUES ($1, 'P', 'person@X.test')", [
      branch.id,
    ]);
    expect(err.constraint).toBe('applications_pending_email_branch_key');

    await testPool().query("UPDATE applications SET status = 'declined' WHERE id = $1", [first]);
    await expect(apply(branch.id)).resolves.toBeTruthy();
  });

  it('allows the same email to apply to a different branch', async () => {
    const a = await seedBranch(testPool());
    const b = await seedBranch(testPool());
    await apply(a.id);
    await expect(apply(b.id)).resolves.toBeTruthy();
  });

  it('rejects a second member for the same application', async () => {
    const branch = await seedBranch(testPool());
    const applicationId = await apply(branch.id);
    const insert =
      "INSERT INTO members (member_code, branch_id, application_id, full_name) VALUES ($1, $2, $3, 'Person')";
    await testPool().query(insert, ['M-1', branch.id, applicationId]);
    const err = await failure(insert, ['M-2', branch.id, applicationId]);
    expect(err.constraint).toBe('members_application_id_key');
  });
});
