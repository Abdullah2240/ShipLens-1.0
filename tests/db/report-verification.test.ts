import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../scripts/migrate.mjs';
import { CODE_ALPHABET, CODE_PATTERN } from '@/modules/verification/code';
import {
  closeTestPool,
  getTestDatabaseUrl,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
} from '../support/db';

type PgError = { code?: string; message?: string };
type Db = Pick<pg.Pool | pg.PoolClient | pg.Client, 'query'>;
type VerificationRow = { report_id: string; code: string; issued_at: Date };

const VERIFICATION_MIGRATION = '202610311410_report_verification.sql';
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../db/migrations');

type World = { branchId: string; leadId: string; reviewerId: string };

async function seedWorld(db: pg.Pool = testPool()): Promise<World> {
  const branch = await seedBranch(db);
  const lead = await seedUser(db, { role: 'branch_lead', branchId: branch.id });
  const reviewer = await seedUser(db, { role: 'finance_reviewer' });
  return { branchId: branch.id, leadId: lead.id, reviewerId: reviewer.id };
}

async function insertDraft(db: Db, branchId: string, weekStart: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO weekly_reports (branch_id, week_start) VALUES ($1, $2) RETURNING id',
    [branchId, weekStart],
  );
  return rows[0]!.id;
}

async function submit(db: Db, reportId: string, submittedBy: string): Promise<void> {
  await db.query(
    `UPDATE weekly_reports
        SET status = 'submitted', total_amount = '1500.50', collection_count = 3,
            submitted_at = now(), submitted_by = $2, version = version + 1, updated_at = now()
      WHERE id = $1`,
    [reportId, submittedBy],
  );
}

async function approve(db: Db, reportId: string, reviewedBy: string): Promise<void> {
  await db.query(
    `UPDATE weekly_reports
        SET status = 'approved', reviewed_at = now(), reviewed_by = $2,
            version = version + 1, updated_at = now()
      WHERE id = $1`,
    [reportId, reviewedBy],
  );
}

async function returnReport(db: Db, reportId: string, reviewedBy: string): Promise<void> {
  await db.query(
    `UPDATE weekly_reports
        SET status = 'returned', return_reason = 'Fix the totals', reviewed_at = now(),
            reviewed_by = $2, version = version + 1, updated_at = now()
      WHERE id = $1`,
    [reportId, reviewedBy],
  );
}

async function verifications(db: Db, reportId: string): Promise<VerificationRow[]> {
  const { rows } = await db.query<VerificationRow>(
    'SELECT report_id, code, issued_at FROM report_verifications WHERE report_id = $1',
    [reportId],
  );
  return rows;
}

async function countVerifications(db: Db = testPool()): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM report_verifications',
  );
  return rows[0]!.n;
}

async function failure(db: Db, sql: string, params: unknown[] = []): Promise<PgError> {
  try {
    await db.query(sql, params);
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

describe('report verification: schema', () => {
  it('creates the table, the code CHECK, the unique code and the three triggers', async () => {
    const { rows: cols } = await testPool().query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'report_verifications' ORDER BY ordinal_position`,
    );
    expect(cols).toEqual([
      { column_name: 'report_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'code', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'issued_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
    ]);

    const { rows: cons } = await testPool().query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'report_verifications'::regclass ORDER BY conname`,
    );
    expect(cons.map((c) => c.conname)).toEqual([
      'report_verifications_code_format',
      'report_verifications_code_key',
      'report_verifications_pkey',
      'report_verifications_report_id_fkey',
    ]);
    expect(cons[0]!.def).toContain("'^[0-9A-HJKMNP-TV-Z]{10}$'");
    expect(cons[3]!.def).toBe('FOREIGN KEY (report_id) REFERENCES weekly_reports(id)');

    const { rows: trig } = await testPool().query<{ tgname: string; def: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
       WHERE tgname IN ('weekly_reports_issue_verification_ins', 'weekly_reports_issue_verification_upd',
                        'report_verifications_no_update_delete')
       ORDER BY tgname`,
    );
    expect(trig.map((t) => t.tgname)).toEqual([
      'report_verifications_no_update_delete',
      'weekly_reports_issue_verification_ins',
      'weekly_reports_issue_verification_upd',
    ]);
    expect(trig[0]!.def).toMatch(/BEFORE DELETE OR UPDATE ON public\.report_verifications/);
    expect(trig[1]!.def).toMatch(/AFTER INSERT ON public\.weekly_reports FOR EACH ROW WHEN/);
    expect(trig[2]!.def).toMatch(
      /AFTER UPDATE OF status ON public\.weekly_reports FOR EACH ROW WHEN/,
    );
  });

  it('rejects a malformed code and a duplicate code', async () => {
    const w = await seedWorld();
    const a = await insertDraft(testPool(), w.branchId, '2026-08-03');
    const b = await insertDraft(testPool(), w.branchId, '2026-08-10');
    const bad = await failure(
      testPool(),
      "INSERT INTO report_verifications (report_id, code) VALUES ($1, 'ABCDEFGHJU')",
      [a],
    );
    expect(bad.code).toBe('23514');
    await testPool().query(
      "INSERT INTO report_verifications (report_id, code) VALUES ($1, 'ABCDEFGHJK')",
      [a],
    );
    const dup = await failure(
      testPool(),
      "INSERT INTO report_verifications (report_id, code) VALUES ($1, 'ABCDEFGHJK')",
      [b],
    );
    expect(dup.code).toBe('23505');
  });
});

describe('report verification: issuance through the lifecycle', () => {
  it('issues no code on submit and exactly one valid code on approval', async () => {
    const w = await seedWorld();
    const id = await insertDraft(testPool(), w.branchId, '2026-08-03');
    expect(await verifications(testPool(), id)).toEqual([]);

    await submit(testPool(), id, w.leadId);
    expect(await verifications(testPool(), id)).toEqual([]);

    await approve(testPool(), id, w.reviewerId);
    const rows = await verifications(testPool(), id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.code).toMatch(CODE_PATTERN);
    expect(rows[0]!.issued_at).toBeInstanceOf(Date);

    const { rows: rep } = await testPool().query<{ reviewed_at: Date }>(
      'SELECT reviewed_at FROM weekly_reports WHERE id = $1',
      [id],
    );
    expect(rows[0]!.issued_at.getTime()).toBe(rep[0]!.reviewed_at.getTime());
  });

  it('keeps the original code when a second issuance is attempted', async () => {
    const w = await seedWorld();
    const id = await insertDraft(testPool(), w.branchId, '2026-08-03');
    await submit(testPool(), id, w.leadId);
    await approve(testPool(), id, w.reviewerId);
    const [original] = await verifications(testPool(), id);
    const other = original!.code === '0000000000' ? '1111111111' : '0000000000';

    await testPool().query(
      'INSERT INTO report_verifications (report_id, code) VALUES ($1, $2) ON CONFLICT (report_id) DO NOTHING',
      [id, other],
    );
    // A second approval is impossible: the finance guard locks approved reports.
    const again = await failure(
      testPool(),
      "UPDATE weekly_reports SET status = 'approved' WHERE id = $1",
      [id],
    );
    expect(again.code).toBe('P0001');

    expect(await verifications(testPool(), id)).toEqual([original]);
  });

  it('issues no code on return and one code after resubmit and approval', async () => {
    const w = await seedWorld();
    const id = await insertDraft(testPool(), w.branchId, '2026-08-03');
    await submit(testPool(), id, w.leadId);
    await returnReport(testPool(), id, w.reviewerId);
    expect(await verifications(testPool(), id)).toEqual([]);

    await submit(testPool(), id, w.leadId);
    expect(await verifications(testPool(), id)).toEqual([]);
    await approve(testPool(), id, w.reviewerId);
    expect(await verifications(testPool(), id)).toHaveLength(1);
  });

  it('issues a code for a report inserted already approved (seed path), dated at review', async () => {
    const w = await seedWorld();
    const { rows } = await testPool().query<{ id: string }>(
      `INSERT INTO weekly_reports
         (branch_id, week_start, status, total_amount, collection_count, submitted_at, submitted_by,
          reviewed_at, reviewed_by, version)
       VALUES ($1, '2026-08-03', 'approved', '2500.00', 4, '2026-08-09T10:00:00Z', $2,
               '2026-08-10T09:30:00Z', $3, 2)
       RETURNING id`,
      [w.branchId, w.leadId, w.reviewerId],
    );
    const id = rows[0]!.id;
    const codes = await verifications(testPool(), id);
    expect(codes).toHaveLength(1);
    expect(codes[0]!.code).toMatch(CODE_PATTERN);
    expect(codes[0]!.issued_at.toISOString()).toBe('2026-08-10T09:30:00.000Z');

    const { rows: drafts } = await testPool().query<{ id: string }>(
      `INSERT INTO weekly_reports (branch_id, week_start, status) VALUES ($1, '2026-08-10', 'draft')
       RETURNING id`,
      [w.branchId],
    );
    expect(await verifications(testPool(), drafts[0]!.id)).toEqual([]);
  });

  it('issues the code inside the approval transaction and drops it on rollback', async () => {
    const w = await seedWorld();
    const id = await insertDraft(testPool(), w.branchId, '2026-08-03');
    await submit(testPool(), id, w.leadId);

    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      await approve(client, id, w.reviewerId);
      expect(await verifications(client, id)).toHaveLength(1);
      expect(await verifications(testPool(), id)).toEqual([]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await verifications(testPool(), id)).toEqual([]);
    const { rows } = await testPool().query<{ status: string }>(
      'SELECT status FROM weekly_reports WHERE id = $1',
      [id],
    );
    expect(rows[0]!.status).toBe('submitted');
  });

  it('gives 200 approvals 200 distinct codes from the alphabet', async () => {
    const w = await seedWorld();
    await testPool().query(
      `INSERT INTO weekly_reports (branch_id, week_start)
       SELECT $1, DATE '2020-01-06' + 7 * g FROM generate_series(0, 199) AS g`,
      [w.branchId],
    );
    await testPool().query(
      `UPDATE weekly_reports
          SET status = 'submitted', total_amount = '10.00', collection_count = 1,
              submitted_at = now(), submitted_by = $1, version = version + 1`,
      [w.leadId],
    );
    expect(await countVerifications()).toBe(0);
    await testPool().query(
      `UPDATE weekly_reports SET status = 'approved', reviewed_at = now(), reviewed_by = $1,
              version = version + 1`,
      [w.reviewerId],
    );

    const { rows } = await testPool().query<{ code: string }>(
      'SELECT code FROM report_verifications',
    );
    expect(rows).toHaveLength(200);
    expect(new Set(rows.map((r) => r.code)).size).toBe(200);
    for (const { code } of rows) {
      expect(code).toMatch(CODE_PATTERN);
      for (const c of code) expect(CODE_ALPHABET).toContain(c);
    }
  });
});

describe('report verification: generator', () => {
  it('spreads 1000 codes over every symbol at every position (no fixed uuid bytes)', async () => {
    const { rows: first } = await testPool().query<{ c: string; n: number }>(
      `SELECT left(code, 1) AS c, count(*)::int AS n
       FROM (SELECT shiplens_verification_code() AS code FROM generate_series(1, 1000)) s
       GROUP BY 1 ORDER BY 1`,
    );
    expect(first.map((r) => r.c).join('')).toBe(CODE_ALPHABET);
    for (const r of first) expect(r.n).toBeGreaterThanOrEqual(10);

    // A fixed version nibble at any position would leave only 16 symbols there.
    const { rows: perPosition } = await testPool().query<{ pos: number; symbols: number }>(
      `SELECT pos, count(DISTINCT substr(code, pos, 1))::int AS symbols
       FROM (SELECT shiplens_verification_code() AS code FROM generate_series(1, 1000)) s,
            generate_series(1, 10) AS pos
       GROUP BY pos ORDER BY pos`,
    );
    expect(perPosition).toEqual(
      Array.from({ length: 10 }, (_, i) => ({ pos: i + 1, symbols: 32 })),
    );
  });

  it('retries when a generated code collides and fails loudly after five collisions', async () => {
    const w = await seedWorld();
    const taken = await insertDraft(testPool(), w.branchId, '2026-08-03');
    await testPool().query(
      "INSERT INTO report_verifications (report_id, code) VALUES ($1, 'TAKENC0DE1')",
      [taken],
    );
    const id = await insertDraft(testPool(), w.branchId, '2026-08-10');
    await submit(testPool(), id, w.leadId);

    const client = await testPool().connect();
    try {
      // The generator is swapped inside a transaction that is always rolled back.
      await client.query('BEGIN');
      await client.query('CREATE TEMP SEQUENCE verification_probe_seq');
      await client.query(`
        CREATE OR REPLACE FUNCTION shiplens_verification_code() RETURNS text
          LANGUAGE plpgsql VOLATILE
          AS $$ BEGIN
            IF nextval('verification_probe_seq') <= 2 THEN RETURN 'TAKENC0DE1'; END IF;
            RETURN 'FRESHC0DE1';
          END $$`);
      await approve(client, id, w.reviewerId);
      expect((await verifications(client, id)).map((r) => r.code)).toEqual(['FRESHC0DE1']);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await client.query(`
        CREATE OR REPLACE FUNCTION shiplens_verification_code() RETURNS text
          LANGUAGE plpgsql VOLATILE
          AS $$ BEGIN RETURN 'TAKENC0DE1'; END $$`);
      const err = await failure(
        client,
        "UPDATE weekly_reports SET status = 'approved', reviewed_at = now(), reviewed_by = $2 WHERE id = $1",
        [id, w.reviewerId],
      );
      expect(err.code).toBe('P0001');
      expect(err.message).toMatch(/could not issue a unique verification code/);
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }

    expect(await verifications(testPool(), id)).toEqual([]);
    const { rows } = await testPool().query<{ code: string }>(
      'SELECT shiplens_verification_code() AS code',
    );
    expect(rows[0]!.code).toMatch(CODE_PATTERN);
    expect(rows[0]!.code).not.toBe('TAKENC0DE1');
  });
});

describe('report verification: append-only', () => {
  it('rejects UPDATE and DELETE with P0001 while resetDb still empties the table', async () => {
    const w = await seedWorld();
    const id = await insertDraft(testPool(), w.branchId, '2026-08-03');
    await submit(testPool(), id, w.leadId);
    await approve(testPool(), id, w.reviewerId);
    const [original] = await verifications(testPool(), id);

    const upd = await failure(
      testPool(),
      "UPDATE report_verifications SET code = '0000000000' WHERE report_id = $1",
      [id],
    );
    expect(upd.code).toBe('P0001');
    expect(upd.message).toMatch(/report_verifications is append-only/);
    const updTime = await failure(
      testPool(),
      'UPDATE report_verifications SET issued_at = now() WHERE report_id = $1',
      [id],
    );
    expect(updTime.code).toBe('P0001');
    const del = await failure(testPool(), 'DELETE FROM report_verifications WHERE report_id = $1', [
      id,
    ]);
    expect(del.code).toBe('P0001');
    expect(await verifications(testPool(), id)).toEqual([original]);

    await resetDb();
    expect(await countVerifications()).toBe(0);
  });
});

describe('report verification: backfill of approved reports', () => {
  it('issues codes to approved reports that existed before the migration, and only to them', async () => {
    const lane = new URL(getTestDatabaseUrl());
    const laneDb = lane.pathname.replace(/^\//, '');
    const scratchDb = `${laneDb.replace(/_test$/, '')}_backfill_test`;
    expect(scratchDb).toMatch(/^[a-z0-9_]+_test$/);
    const scratchUrl = new URL(lane);
    scratchUrl.pathname = `/${scratchDb}`;
    const adminUrl = new URL(lane);
    adminUrl.pathname = '/postgres';

    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'report-verification-backfill-'));
    let scratch: pg.Client | undefined;
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${scratchDb}`);

      const earlier = (await readdir(MIGRATIONS_DIR)).filter(
        (f) => f.endsWith('.sql') && f < VERIFICATION_MIGRATION,
      );
      for (const f of earlier) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(tmp, f));
      await runMigrations({ connectionString: scratchUrl.toString(), dir: tmp });

      scratch = new pg.Client({ connectionString: scratchUrl.toString() });
      await scratch.connect();
      const { rows: br } = await scratch.query<{ id: string }>(
        "INSERT INTO branches (code, name, status) VALUES ('BR-BACKFILL', 'Backfill', 'active') RETURNING id",
      );
      const branchId = br[0]!.id;
      const { rows: us } = await scratch.query<{ id: string; role: string }>(
        `INSERT INTO users (email, name, password_hash, role, branch_id) VALUES
           ('lead@backfill.test', 'Lead', 'x', 'branch_lead', $1),
           ('review@backfill.test', 'Reviewer', 'x', 'finance_reviewer', NULL)
         RETURNING id, role`,
        [branchId],
      );
      const leadId = us.find((u) => u.role === 'branch_lead')!.id;
      const reviewerId = us.find((u) => u.role === 'finance_reviewer')!.id;

      const { rows: approved } = await scratch.query<{ id: string }>(
        `INSERT INTO weekly_reports
           (branch_id, week_start, status, total_amount, collection_count, submitted_at, submitted_by,
            reviewed_at, reviewed_by, version)
         VALUES ($1, '2026-08-03', 'approved', '1500.50', 3, '2026-08-09T10:00:00Z', $2,
                 '2026-08-10T09:30:00Z', $3, 2)
         RETURNING id`,
        [branchId, leadId, reviewerId],
      );
      const approvedId = approved[0]!.id;
      const draftId = await insertDraft(scratch, branchId, '2026-08-10');
      const submittedId = await insertDraft(scratch, branchId, '2026-08-17');
      await submit(scratch, submittedId, leadId);
      const laterApprovedId = await insertDraft(scratch, branchId, '2026-08-24');
      await submit(scratch, laterApprovedId, leadId);
      await approve(scratch, laterApprovedId, reviewerId);

      await copyFile(
        path.join(MIGRATIONS_DIR, VERIFICATION_MIGRATION),
        path.join(tmp, VERIFICATION_MIGRATION),
      );
      expect(await runMigrations({ connectionString: scratchUrl.toString(), dir: tmp })).toEqual([
        VERIFICATION_MIGRATION,
      ]);

      const backfilled = await verifications(scratch, approvedId);
      expect(backfilled).toHaveLength(1);
      expect(backfilled[0]!.code).toMatch(CODE_PATTERN);
      expect(backfilled[0]!.issued_at.toISOString()).toBe('2026-08-10T09:30:00.000Z');
      expect(await verifications(scratch, laterApprovedId)).toHaveLength(1);
      expect(await verifications(scratch, draftId)).toEqual([]);
      expect(await verifications(scratch, submittedId)).toEqual([]);
      expect(await countVerifications(scratch)).toBe(2);

      // The triggers are live after the migration.
      await approve(scratch, submittedId, reviewerId);
      expect(await verifications(scratch, submittedId)).toHaveLength(1);
    } finally {
      await scratch?.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`).catch(() => {});
      await admin.end();
      await rm(tmp, { recursive: true, force: true });
    }
  }, 120000);
});
