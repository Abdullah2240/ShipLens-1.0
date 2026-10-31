// Proof that editing any past audit row is detected. Each case tampers as a database owner
// would: inside one transaction that disables the append-only trigger, edits, and enables it
// again, so a failing edit rolls the trigger state back with it.
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestPool,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
} from '../../../../tests/support/db';
import type { Actor } from '../../authz/actor';
import { fixedClock } from '../../time';
import { command } from '../command';
import type { CommandContext } from '../types';
import { CHAIN_ROW_SELECT, canonicalV1, hashCanonical } from './canonical';
import type { ChainRowText } from './types';
import { verifyAuditChain } from './verify';

const pool = testPool();
const GUARD = 'audit_events_no_update_delete';

afterAll(async () => {
  await closeTestPool();
});

/** Runs an edit with the append-only guard disabled, all in one transaction. */
async function tamper(
  edit: string | ((client: PoolClient) => Promise<void>),
  params: unknown[] = [],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE audit_events DISABLE TRIGGER ${GUARD}`);
    if (typeof edit === 'string') {
      const { rowCount } = await client.query(edit, params);
      if (rowCount === 0) throw new Error(`tamper edit changed no row: ${edit}`);
    } else {
      await edit(client);
    }
    await client.query(`ALTER TABLE audit_events ENABLE TRIGGER ${GUARD}`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function rowAt(db: { query: PoolClient['query'] }, seq: number): Promise<ChainRowText> {
  const { rows } = await db.query<ChainRowText>(
    `SELECT ${CHAIN_ROW_SELECT} FROM audit_events WHERE audit_events.chain_seq = $1`,
    [seq],
  );
  if (!rows[0]) throw new Error(`no audit row at chain_seq ${seq}`);
  return rows[0];
}

function recomputedHash(row: ChainRowText): string {
  const content: Omit<ChainRowText, 'hash'> & { hash?: string } = { ...row };
  delete content.hash;
  return hashCanonical(canonicalV1(content));
}

let reportId: string;

/**
 * Six audited events. Row 3 (the middle row under test) has every nullable column set;
 * row 5 has every nullable column except after NULL (direct SQL insert, null request_id).
 */
async function seedEvents(): Promise<void> {
  const user = await seedUser(pool, { role: 'super_admin' });
  const actor: Actor = { userId: user.id, role: 'super_admin', branchId: null };
  const branch = await seedBranch(pool, { name: 'Multan Road' });
  reportId = randomUUID();
  let n = 0;
  const ctx = (): CommandContext => ({
    actor,
    requestId: `req-tamper-${++n}`,
    clock: fixedClock('2026-10-28T10:00:00Z'),
    pool,
  });

  await command(ctx(), 'branches.create', async (_tx, audit) => {
    audit({
      action: 'branch.create',
      entityType: 'branch',
      entityId: branch.id,
      branchId: branch.id,
      after: { code: branch.code, name: 'Multan Road', status: 'active' },
    });
  });
  await command(ctx(), 'members.update', async (_tx, audit) => {
    audit({
      action: 'member.update',
      entityType: 'member',
      entityId: 'm-1',
      branchId: branch.id,
      before: { status: 'active' },
      after: { status: 'inactive' },
    });
  });
  await command(ctx(), 'reports.submit', async (_tx, audit) => {
    audit({
      action: 'report.submit',
      entityType: 'report',
      entityId: reportId,
      branchId: branch.id,
      reportId,
      before: { status: 'draft', version: 1 },
      after: { status: 'submitted', total_amount: '1500.00', collection_count: 3, version: 2 },
    });
  });
  await command(ctx(), 'content.update', async (_tx, audit) => {
    audit({
      action: 'content.update',
      entityType: 'content',
      entityId: 'home.hero',
      before: { title: 'Weekly report' },
      after: { title: 'ہفتہ وار رپورٹ', locale: 'ur' },
    });
  });
  await pool.query(
    `INSERT INTO audit_events (request_id, actor_role, action, entity_type, entity_id, after)
     VALUES (NULL, 'system', 'keepwarm.ping', 'system', 'keepwarm', '{"ok": true}')`,
  );
  await command(ctx(), 'reports.approve', async (_tx, audit) => {
    audit({
      action: 'report.approve',
      entityType: 'report',
      entityId: reportId,
      branchId: branch.id,
      reportId,
      before: { status: 'submitted' },
      after: { status: 'approved', version: 3 },
    });
  });
}

beforeEach(async () => {
  await resetDb(pool);
  await seedEvents();
  expect(await verifyAuditChain(pool)).toMatchObject({ status: 'intact', checkedEvents: 6 });
});

afterEach(async () => {
  const { rows } = await pool.query<{ tgenabled: string }>(
    `SELECT tgenabled FROM pg_trigger
      WHERE tgrelid = 'audit_events'::regclass AND tgname = $1`,
    [GUARD],
  );
  expect(rows[0]?.tgenabled).toBe('O');
  await expect(
    pool.query(
      "UPDATE audit_events SET action = action || 'x' WHERE chain_seq = (SELECT min(chain_seq) FROM audit_events)",
    ),
  ).rejects.toMatchObject({ code: 'P0001' });
});

// Every stored column of the canonical form except chain_seq (covered by the gap and
// reorder cases below). id is GENERATED ALWAYS, so it can only be renumbered to DEFAULT,
// which takes the next identity value and never collides.
const COLUMN_EDITS: [column: string, set: string][] = [
  ['prev_hash', 'prev_hash = md5(prev_hash) || md5(prev_hash)'],
  ['id', 'id = DEFAULT'],
  ['occurred_at', "occurred_at = occurred_at + interval '1 microsecond'"],
  ['request_id', "request_id = request_id || 'x'"],
  ['actor_id', 'actor_id = gen_random_uuid()'],
  ['actor_role', "actor_role = actor_role || 'x'"],
  ['action', "action = action || 'x'"],
  ['entity_type', "entity_type = entity_type || 'x'"],
  ['entity_id', "entity_id = entity_id || 'x'"],
  ['branch_id', 'branch_id = gen_random_uuid()'],
  ['report_id', 'report_id = gen_random_uuid()'],
  ['before', "before = jsonb_set(before, '{status}', to_jsonb((before->>'status') || 'x'))"],
  ['after', `after = jsonb_set(after, '{total_amount}', '"1500.01"')`],
];

const TO_NULL = ['request_id', 'actor_id', 'branch_id', 'report_id', 'before', 'after'];
const FROM_NULL: [column: string, value: string][] = [
  ['request_id', "'req-forged'"],
  ['actor_id', 'gen_random_uuid()'],
  ['branch_id', 'gen_random_uuid()'],
  ['report_id', 'gen_random_uuid()'],
  ['before', `'{"ok": false}'::jsonb`],
];

describe('editing one column of a past row is detected at that row', () => {
  it('covers all 13 stored content columns', () => {
    expect(COLUMN_EDITS.map(([c]) => c)).toHaveLength(13);
  });

  it.each(COLUMN_EDITS)('%s of row 3', async (_column, set) => {
    const original = await rowAt(pool, 3);
    await tamper(`UPDATE audit_events SET ${set} WHERE chain_seq = 3`);
    expect(await rowAt(pool, 3)).not.toEqual(original);
    expect(await verifyAuditChain(pool)).toMatchObject({
      status: 'broken',
      checkedEvents: 2,
      brokenAt: { chainSeq: 3, reason: 'hash_mismatch' },
    });
  });

  it.each(TO_NULL)('%s of row 3 set to NULL', async (column) => {
    await tamper(`UPDATE audit_events SET ${column} = NULL WHERE chain_seq = 3`);
    expect(await verifyAuditChain(pool)).toMatchObject({
      brokenAt: { chainSeq: 3, reason: 'hash_mismatch' },
    });
  });

  it.each(FROM_NULL)('%s of row 5 set from NULL to a value', async (column, value) => {
    const stored = (column === 'before' ? 'before_text' : column) as keyof ChainRowText;
    expect((await rowAt(pool, 5))[stored]).toBeNull();
    await tamper(`UPDATE audit_events SET ${column} = ${value} WHERE chain_seq = 5`);
    expect(await verifyAuditChain(pool)).toMatchObject({
      checkedEvents: 4,
      brokenAt: { chainSeq: 5, reason: 'hash_mismatch' },
    });
  });

  it('the Urdu text of row 4 changed by one character', async () => {
    await tamper(
      `UPDATE audit_events SET after = jsonb_set(after, '{title}', '"ہفتہ وار رپورٹس"') WHERE chain_seq = 4`,
    );
    expect(await verifyAuditChain(pool)).toMatchObject({
      brokenAt: { chainSeq: 4, reason: 'hash_mismatch' },
    });
  });

  it('the stored hash of row 3 replaced', async () => {
    await tamper('UPDATE audit_events SET hash = md5(hash) || md5(hash) WHERE chain_seq = 3');
    expect(await verifyAuditChain(pool)).toMatchObject({
      brokenAt: { chainSeq: 3, reason: 'hash_mismatch' },
    });
  });

  it('a forged row 3 with a correctly recomputed hash breaks the link at row 4', async () => {
    await tamper(async (client) => {
      await client.query(
        `UPDATE audit_events SET after = jsonb_set(after, '{total_amount}', '"9500.00"') WHERE chain_seq = 3`,
      );
      const forged = await rowAt(client, 3);
      await client.query('UPDATE audit_events SET hash = $1 WHERE chain_seq = 3', [
        recomputedHash(forged),
      ]);
    });
    expect(await verifyAuditChain(pool)).toMatchObject({
      status: 'broken',
      checkedEvents: 3,
      brokenAt: { chainSeq: 4, reason: 'link_mismatch' },
    });
  });
});

describe('deleting, swapping and reordering rows is detected', () => {
  it('deleting a middle row reports a sequence gap at the next row', async () => {
    await tamper('DELETE FROM audit_events WHERE chain_seq = 3');
    expect(await verifyAuditChain(pool)).toMatchObject({
      checkedEvents: 2,
      brokenAt: { chainSeq: 4, reason: 'sequence_gap' },
    });
  });

  it('deleting the first row reports a sequence gap at row 2', async () => {
    await tamper('DELETE FROM audit_events WHERE chain_seq = 1');
    expect(await verifyAuditChain(pool)).toMatchObject({
      checkedEvents: 0,
      brokenAt: { chainSeq: 2, reason: 'sequence_gap' },
    });
  });

  it('swapping the after values of rows 2 and 3 is detected at row 2', async () => {
    await tamper(
      `UPDATE audit_events a SET after = b.after
         FROM audit_events b
        WHERE (a.chain_seq, b.chain_seq) IN ((2, 3), (3, 2))`,
    );
    expect(await verifyAuditChain(pool)).toMatchObject({
      status: 'broken',
      brokenAt: { chainSeq: 2, reason: 'hash_mismatch' },
    });
  });

  it('swapping the positions of rows 3 and 4 is detected at row 3', async () => {
    await tamper(async (client) => {
      await client.query('UPDATE audit_events SET chain_seq = 1000 WHERE chain_seq = 3');
      await client.query('UPDATE audit_events SET chain_seq = 3 WHERE chain_seq = 4');
      await client.query('UPDATE audit_events SET chain_seq = 4 WHERE chain_seq = 1000');
    });
    expect(await verifyAuditChain(pool)).toMatchObject({
      brokenAt: { chainSeq: 3, reason: 'hash_mismatch' },
    });
  });
});

describe('documented limits (closed by the external seal)', () => {
  it('a full rewrite needs an external anchor', async () => {
    const originalHead = (await rowAt(pool, 6)).hash;
    await tamper(async (client) => {
      await client.query(
        `UPDATE audit_events SET after = jsonb_set(after, '{total_amount}', '"9500.00"') WHERE chain_seq = 3`,
      );
      let prev = (await rowAt(client, 2)).hash;
      for (let seq = 3; seq <= 6; seq++) {
        await client.query('UPDATE audit_events SET prev_hash = $1 WHERE chain_seq = $2', [
          prev,
          seq,
        ]);
        prev = recomputedHash(await rowAt(client, seq));
        await client.query('UPDATE audit_events SET hash = $1 WHERE chain_seq = $2', [prev, seq]);
      }
    });
    const status = await verifyAuditChain(pool);
    // The chain alone cannot tell: it reads intact. Only a hash held outside the database
    // (the seal printed on an approved report) still differs from the rewritten head.
    expect(status).toMatchObject({ status: 'intact', checkedEvents: 6 });
    expect(status.status === 'intact' && status.head.hash).not.toBe(originalHead);
    expect((await rowAt(pool, 3)).after_text).toContain('9500.00');
  });

  it('deleting the newest row leaves an intact, shorter chain', async () => {
    const fifth = await rowAt(pool, 5);
    await tamper('DELETE FROM audit_events WHERE chain_seq = 6');
    expect(await verifyAuditChain(pool)).toMatchObject({
      status: 'intact',
      checkedEvents: 5,
      head: { chainSeq: 5, hash: fifth.hash },
    });
  });
});
