import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../scripts/migrate.mjs';
import { command } from '@/platform/audit/command';
import type { CommandContext } from '@/platform/audit/types';
import { CHAIN_ROW_SELECT, canonicalV1, hashCanonical } from '@/platform/audit/chain/canonical';
import { GENESIS_HASH, type ChainRowText } from '@/platform/audit/chain/types';
import { fixedClock } from '@/platform/time';
import {
  closeTestPool,
  getTestDatabaseUrl,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
} from '../support/db';

type PgError = { code?: string; message?: string };

const CHAIN_MIGRATION = '202610311400_audit_chain.sql';
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../db/migrations');

const INSERT_RAW = `
  INSERT INTO audit_events
    (occurred_at, request_id, actor_id, actor_role, action, entity_type, entity_id, branch_id, report_id, before, after)
  VALUES (coalesce($1::timestamptz, now()), $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
  RETURNING id`;

type RawEvent = {
  occurredAt?: string | null;
  requestId?: string | null;
  actorId?: string | null;
  actorRole?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  branchId?: string | null;
  reportId?: string | null;
  before?: unknown;
  after?: unknown;
};

function rawParams(e: RawEvent): unknown[] {
  return [
    e.occurredAt ?? null,
    e.requestId === undefined ? 'req-chain' : e.requestId,
    e.actorId ?? null,
    e.actorRole ?? 'system',
    e.action ?? 'test.created',
    e.entityType ?? 'thing',
    e.entityId ?? '1',
    e.branchId ?? null,
    e.reportId ?? null,
    e.before === undefined || e.before === null ? null : JSON.stringify(e.before),
    e.after === undefined || e.after === null ? null : JSON.stringify(e.after),
  ];
}

async function insertRaw(db: pg.Pool | pg.PoolClient, e: RawEvent = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(INSERT_RAW, rawParams(e));
  return rows[0]!.id;
}

async function chainRows(db: pg.Pool | pg.Client = testPool()): Promise<ChainRowText[]> {
  const { rows } = await db.query<ChainRowText>(
    `SELECT ${CHAIN_ROW_SELECT} FROM audit_events ORDER BY audit_events.chain_seq`,
  );
  return rows;
}

/** Assert the rows form a gap-free chain from 1 with valid links and recomputable hashes. */
function expectValidChain(rows: ChainRowText[], length: number): void {
  expect(rows).toHaveLength(length);
  let prev = GENESIS_HASH;
  rows.forEach((row, i) => {
    expect(row.chain_seq).toBe(String(i + 1));
    expect(row.prev_hash).toBe(prev);
    const { hash, ...rest } = row;
    expect(hashCanonical(canonicalV1(rest))).toBe(hash);
    prev = hash;
  });
}

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

describe('audit chain: schema', () => {
  it('adds NOT NULL chain columns, hex checks and a unique index on chain_seq', async () => {
    const { rows: cols } = await testPool().query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_name = 'audit_events' AND column_name IN ('chain_seq', 'prev_hash', 'hash')
       ORDER BY column_name`,
    );
    expect(cols).toEqual([
      { column_name: 'chain_seq', data_type: 'bigint', is_nullable: 'NO' },
      { column_name: 'hash', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'prev_hash', data_type: 'text', is_nullable: 'NO' },
    ]);

    const { rows: idx } = await testPool().query<{ def: string }>(
      "SELECT pg_get_indexdef(indexrelid) AS def FROM pg_index WHERE indexrelid = 'audit_events_chain_seq_key'::regclass",
    );
    expect(idx[0]!.def).toMatch(
      /CREATE UNIQUE INDEX audit_events_chain_seq_key ON public\.audit_events USING btree \(chain_seq\)/,
    );

    const { rows: checks } = await testPool().query<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'audit_events'::regclass AND contype = 'c' ORDER BY 1",
    );
    const defs = checks.map((c) => c.def).join('\n');
    expect(defs).toContain("(hash ~ '^[0-9a-f]{64}$'::text)");
    expect(defs).toContain("(prev_hash ~ '^[0-9a-f]{64}$'::text)");
  });
});

describe('audit chain: trigger', () => {
  it('starts at genesis and links each event to the previous hash', async () => {
    await insertRaw(testPool());
    await insertRaw(testPool(), { action: 'test.second' });
    const rows = await chainRows();
    expectValidChain(rows, 2);
    expect(rows[0]!.prev_hash).toBe(GENESIS_HASH);
    expect(rows[1]!.prev_hash).toBe(rows[0]!.hash);
  });

  it('overwrites chain values supplied by the writer', async () => {
    await insertRaw(testPool());
    await testPool().query(
      `INSERT INTO audit_events (actor_role, action, entity_type, entity_id, chain_seq, prev_hash, hash)
       VALUES ('system', 'test.forged', 'thing', '2', 999, $1, $2)`,
      ['f'.repeat(64), 'a'.repeat(64)],
    );
    const rows = await chainRows();
    expectValidChain(rows, 2);
    expect(rows[1]!.chain_seq).toBe('2');
    expect(rows[1]!.prev_hash).not.toBe('f'.repeat(64));
    expect(rows[1]!.hash).not.toBe('a'.repeat(64));
  });

  it('chains every row of a multi-row INSERT in id order', async () => {
    await testPool().query(
      `INSERT INTO audit_events (actor_role, action, entity_type, entity_id)
       SELECT 'system', 'test.bulk', 'thing', g::text FROM generate_series(1, 5) AS g`,
    );
    const rows = await chainRows();
    expectValidChain(rows, 5);
    expect(rows.map((r) => Number(r.id))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('audit chain: SQL and TypeScript parity', () => {
  it('recomputes the stored hash and the SQL canonical string from text columns', async () => {
    const branch = await seedBranch(testPool());
    const user = await seedUser(testPool(), { role: 'super_admin' });
    await insertRaw(testPool(), {
      actorId: user.id,
      actorRole: 'super_admin',
      action: 'content.update',
      entityType: 'content',
      entityId: 'home.hero',
      branchId: branch.id,
      before: null,
      after: { title: 'رپورٹ کی منظوری', locale: 'ur', note: 'quote " and \\ backslash' },
    });
    await insertRaw(testPool(), {
      requestId: null,
      entityId: 'pipe|and:colon|3:x',
      before: { a: 1 },
      after: { nested: { list: [1, 2.5, null, true, 'x|y'], obj: { k: 'v', ک: 'و' } }, n: null },
    });
    await insertRaw(testPool(), { occurredAt: '2026-10-28T10:00:00.123456+05:00', requestId: '' });

    const client = await testPool().connect();
    try {
      await client.query('BEGIN');
      await insertRaw(client, { action: 'test.same_tx_1', after: { i: 1 } });
      await insertRaw(client, { action: 'test.same_tx_2', after: { i: 2 } });
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const rows = await chainRows();
    expectValidChain(rows, 5);
    expect(rows[2]!.occurred_at_utc).toBe('2026-10-28T05:00:00.123456Z');
    expect(rows[3]!.occurred_at_utc).toBe(rows[4]!.occurred_at_utc);
    expect(rows[0]!.after_text).toContain('رپورٹ');
    expect(rows[0]!.before_text).toBeNull();
    expect(rows[1]!.request_id).toBeNull();

    const { rows: sqlCanon } = await testPool().query<{ chain_seq: string; canonical: string }>(
      `SELECT chain_seq::text AS chain_seq,
              audit_event_canonical(chain_seq, prev_hash, id, occurred_at, request_id, actor_id, actor_role,
                action, entity_type, entity_id, branch_id, report_id, before, after) AS canonical
       FROM audit_events ORDER BY audit_events.chain_seq`,
    );
    sqlCanon.forEach((r, i) => {
      const row = rows[i]!;
      expect(r.chain_seq).toBe(row.chain_seq);
      expect(r.canonical).toBe(canonicalV1(row));
    });
  });
});

describe('audit chain: concurrency through command()', () => {
  it('keeps the chain gap-free and linked when 20 commands commit at once (3 rounds)', async () => {
    const pool = new pg.Pool({ connectionString: getTestDatabaseUrl(), max: 10 });
    try {
      for (let round = 0; round < 3; round++) {
        await resetDb();
        const user = await seedUser(testPool(), { role: 'super_admin' });
        const actor = { userId: user.id, role: 'super_admin' as const, branchId: null };
        await Promise.all(
          Array.from({ length: 20 }, (_, i) => {
            const ctx: CommandContext = {
              actor,
              requestId: `req-chain-${round}-${i}`,
              clock: fixedClock('2026-10-28T10:00:00Z'),
              pool,
            };
            return command(ctx, 'teams.chain_probe', async (tx, audit) => {
              await tx.query('SELECT pg_sleep($1)', [Math.random() * 0.02]);
              audit({
                action: 'team.create',
                entityType: 'team',
                entityId: `team-${i}`,
                after: { name: `Team ${i}` },
              });
            });
          }),
        );
        expectValidChain(await chainRows(), 20);
      }
    } finally {
      await pool.end();
    }
  });

  it('places two events from one command next to each other', async () => {
    const user = await seedUser(testPool(), { role: 'super_admin' });
    const ctx: CommandContext = {
      actor: { userId: user.id, role: 'super_admin', branchId: null },
      requestId: 'req-pair',
      clock: fixedClock('2026-10-28T10:00:00Z'),
      pool: testPool(),
    };
    await insertRaw(testPool());
    await command(ctx, 'teams.pair', async (_tx, audit) => {
      audit({ action: 'team.first', entityType: 'team', entityId: 't-1', after: { name: 'A' } });
      audit({ action: 'team.second', entityType: 'team', entityId: 't-1', after: { name: 'B' } });
    });
    const rows = await chainRows();
    expectValidChain(rows, 3);
    expect(rows.slice(1).map((r) => [r.chain_seq, r.action])).toEqual([
      ['2', 'team.first'],
      ['3', 'team.second'],
    ]);
  });
});

describe('audit chain: append-only guarantees are unchanged', () => {
  it('keeps the immutability trigger enabled and UPDATE, DELETE and unguarded TRUNCATE raise P0001', async () => {
    const { rows: trig } = await testPool().query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND NOT tgisinternal
       ORDER BY tgname`,
    );
    expect(trig).toEqual([
      { tgname: 'audit_events_chain', tgenabled: 'O' },
      { tgname: 'audit_events_no_truncate', tgenabled: 'O' },
      { tgname: 'audit_events_no_update_delete', tgenabled: 'O' },
    ]);

    const id = await insertRaw(testPool());
    const upd = await failure('UPDATE audit_events SET hash = $1 WHERE id = $2', [
      'b'.repeat(64),
      id,
    ]);
    expect(upd.code).toBe('P0001');
    const updChain = await failure('UPDATE audit_events SET chain_seq = 5 WHERE id = $1', [id]);
    expect(updChain.code).toBe('P0001');
    const del = await failure('DELETE FROM audit_events WHERE id = $1', [id]);
    expect(del.code).toBe('P0001');
    const trunc = await failure('TRUNCATE audit_events');
    expect(trunc.code).toBe('P0001');
    expectValidChain(await chainRows(), 1);
  });
});

describe('audit chain: backfill of existing rows', () => {
  it('chains pre-existing rows in id order and re-enables the immutability trigger', async () => {
    const lane = new URL(getTestDatabaseUrl());
    const laneDb = lane.pathname.replace(/^\//, '');
    const scratchDb = `${laneDb.replace(/_test$/, '')}_chain_backfill_test`;
    expect(scratchDb).toMatch(/^[a-z0-9_]+_test$/);
    const scratchUrl = new URL(lane);
    scratchUrl.pathname = `/${scratchDb}`;
    const adminUrl = new URL(lane);
    adminUrl.pathname = '/postgres';

    const admin = new pg.Client({ connectionString: adminUrl.toString() });
    await admin.connect();
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'audit-chain-backfill-'));
    let scratch: pg.Client | undefined;
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${scratchDb}`);

      const earlier = (await readdir(MIGRATIONS_DIR)).filter(
        (f) => f.endsWith('.sql') && f < CHAIN_MIGRATION,
      );
      for (const f of earlier) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(tmp, f));
      await runMigrations({ connectionString: scratchUrl.toString(), dir: tmp });

      scratch = new pg.Client({ connectionString: scratchUrl.toString() });
      await scratch.connect();
      const events: RawEvent[] = [
        {
          occurredAt: '2026-08-03T09:00:00Z',
          requestId: 'seed:demo-data',
          action: 'report.submit',
          after: { status: 'submitted', total_amount: '1500.00' },
        },
        { occurredAt: '2026-08-01T09:00:00.5Z', action: 'branch.create', after: { name: 'ملتان' } },
        { requestId: null, before: { status: 'draft' }, after: { status: 'approved' } },
        { entityId: 'a|b:c' },
        {
          occurredAt: '2026-08-01T09:00:00.5Z',
          actorRole: 'branch_lead',
          action: 'collection.create',
        },
      ];
      for (const e of events) await scratch.query(INSERT_RAW, rawParams(e));

      await copyFile(path.join(MIGRATIONS_DIR, CHAIN_MIGRATION), path.join(tmp, CHAIN_MIGRATION));
      expect(await runMigrations({ connectionString: scratchUrl.toString(), dir: tmp })).toEqual([
        CHAIN_MIGRATION,
      ]);

      const rows = await chainRows(scratch);
      expectValidChain(rows, 5);
      expect(rows.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5']);

      const { rows: trig } = await scratch.query<{ tgenabled: string }>(
        "SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND tgname = 'audit_events_no_update_delete'",
      );
      expect(trig[0]!.tgenabled).toBe('O');
      const err = await scratch.query('DELETE FROM audit_events WHERE id = 1').then(
        () => null,
        (e: PgError) => e,
      );
      expect(err?.code).toBe('P0001');

      await scratch.query(INSERT_RAW, rawParams({ action: 'test.after_backfill' }));
      const after = await chainRows(scratch);
      expectValidChain(after, 6);
      expect(after[5]!.prev_hash).toBe(rows[4]!.hash);
    } finally {
      await scratch?.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`).catch(() => {});
      await admin.end();
      await rm(tmp, { recursive: true, force: true });
    }
  }, 120000);
});
