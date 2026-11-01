import { beforeEach, describe, expect, it } from 'vitest';
import type { Queryable } from '@/platform/db';
import { fixedClock } from '@/platform/time';
import { canonicalV1, hashCanonical } from './canonical';
import { GENESIS_HASH, type ChainRowText } from './types';
import { getChainStatus, resetChainStatusCache, verifyAuditChain } from './verify';

type RowFields = Omit<ChainRowText, 'chain_seq' | 'prev_hash' | 'hash'>;

function fields(i: number): RowFields {
  return {
    id: String(100 + i),
    occurred_at_utc: `2026-10-28T10:00:0${i % 10}.123456Z`,
    request_id: `req-${i}`,
    actor_id: null,
    actor_role: 'super_admin',
    action: 'branch.update',
    entity_type: 'branch',
    entity_id: `b-${i}`,
    branch_id: null,
    report_id: null,
    before_text: i === 1 ? null : `{"name": "B${i - 1}"}`,
    after_text: `{"name": "B${i}"}`,
  };
}

/** A valid chain of n rows (chain_seq 1..n), each hash computed from canonical form v1. */
function buildChain(n: number): ChainRowText[] {
  const rows: ChainRowText[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const unhashed = { chain_seq: String(i), prev_hash: prev, ...fields(i) };
    const hash = hashCanonical(canonicalV1(unhashed));
    rows.push({ ...unhashed, hash });
    prev = hash;
  }
  return rows;
}

/** Re-hash a row after editing it, as a forger with database rights would. */
function rehash(row: ChainRowText): ChainRowText {
  const rest: Omit<ChainRowText, 'hash'> & { hash?: string } = { ...row };
  delete rest.hash;
  return { ...row, hash: hashCanonical(canonicalV1(rest)) };
}

/** Fake Queryable that answers the keyset query from prepared rows and records each call. */
function fakeDb(rows: ChainRowText[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let fail: Error | null = null;
  const db = {
    calls,
    failNext(err: Error) {
      fail = err;
    },
    query: (async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (fail) {
        const err = fail;
        fail = null;
        throw err;
      }
      const after = Number(params[0]);
      const limit = Number(params[1]);
      const page = rows.filter((r) => Number(r.chain_seq) > after).slice(0, limit);
      return { rows: page, rowCount: page.length };
    }) as unknown as Queryable['query'],
  };
  return db;
}

const T0 = '2026-11-01T08:00:00.000Z';

describe('verifyAuditChain', () => {
  it('reports an empty chain', async () => {
    const status = await verifyAuditChain(fakeDb([]), { clock: fixedClock(T0) });
    expect(status).toEqual({ status: 'empty', checkedEvents: 0, checkedAt: T0 });
  });

  it('reports an intact chain with its head', async () => {
    const rows = buildChain(3);
    const status = await verifyAuditChain(fakeDb(rows), { clock: fixedClock(T0) });
    expect(status).toEqual({
      status: 'intact',
      checkedEvents: 3,
      head: { chainSeq: 3, hash: rows[2]!.hash },
      checkedAt: T0,
    });
  });

  it('reads with a keyset query ordered by the qualified chain_seq column', async () => {
    const db = fakeDb(buildChain(5));
    const status = await verifyAuditChain(db, { batchSize: 2, clock: fixedClock(T0) });
    expect(status.status).toBe('intact');
    expect(status.checkedEvents).toBe(5);
    expect(db.calls.map((c) => c.params)).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
    for (const { sql } of db.calls) {
      expect(sql).toMatch(/WHERE audit_events\.chain_seq > \$1/);
      expect(sql).toMatch(/ORDER BY audit_events\.chain_seq LIMIT \$2/);
    }
  });

  it('asks for one more page when the last page was exactly full', async () => {
    const db = fakeDb(buildChain(4));
    await verifyAuditChain(db, { batchSize: 2, clock: fixedClock(T0) });
    expect(db.calls.map((c) => c.params)).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
  });

  it('defaults to batches of 1000', async () => {
    const db = fakeDb(buildChain(2));
    await verifyAuditChain(db);
    expect(db.calls[0]!.params).toEqual([0, 1000]);
  });

  it('reports a sequence gap when the first row is not chain_seq 1', async () => {
    const rows = buildChain(3).slice(1);
    const status = await verifyAuditChain(fakeDb(rows), { clock: fixedClock(T0) });
    expect(status).toEqual({
      status: 'broken',
      checkedEvents: 0,
      brokenAt: { chainSeq: 2, eventId: rows[0]!.id, reason: 'sequence_gap' },
      checkedAt: T0,
    });
  });

  it('reports a sequence gap where a middle row is missing', async () => {
    const rows = buildChain(5);
    rows.splice(2, 1);
    const status = await verifyAuditChain(fakeDb(rows), { batchSize: 2 });
    expect(status).toMatchObject({
      status: 'broken',
      checkedEvents: 2,
      brokenAt: { chainSeq: 4, reason: 'sequence_gap' },
    });
  });

  it('reports a link mismatch when prev_hash does not equal the previous hash', async () => {
    const rows = buildChain(3);
    rows[1] = rehash({ ...rows[1]!, prev_hash: 'f'.repeat(64) });
    const status = await verifyAuditChain(fakeDb(rows));
    expect(status).toMatchObject({
      status: 'broken',
      checkedEvents: 1,
      brokenAt: { chainSeq: 2, eventId: rows[1]!.id, reason: 'link_mismatch' },
    });
  });

  it('reports a link mismatch on the first row when it does not start at genesis', async () => {
    const rows = buildChain(2);
    rows[0] = rehash({ ...rows[0]!, prev_hash: 'a'.repeat(64) });
    const status = await verifyAuditChain(fakeDb(rows));
    expect(status).toMatchObject({ brokenAt: { chainSeq: 1, reason: 'link_mismatch' } });
  });

  it('reports a hash mismatch when row content was edited', async () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1]!, after_text: '{"name": "Forged"}' };
    const status = await verifyAuditChain(fakeDb(rows));
    expect(status).toMatchObject({
      status: 'broken',
      checkedEvents: 1,
      brokenAt: { chainSeq: 2, reason: 'hash_mismatch' },
    });
  });

  it('reports an edited prev_hash that was not re-hashed as a hash mismatch', async () => {
    const rows = buildChain(3);
    rows[1] = { ...rows[1]!, prev_hash: 'f'.repeat(64) };
    const status = await verifyAuditChain(fakeDb(rows));
    expect(status).toMatchObject({ brokenAt: { chainSeq: 2, reason: 'hash_mismatch' } });
  });

  it('reports only the first failure when several exist', async () => {
    const rows = buildChain(6);
    rows[4] = { ...rows[4]!, action: 'forged' }; // hash mismatch at 5
    rows[2] = rehash({ ...rows[2]!, prev_hash: 'b'.repeat(64) }); // link mismatch at 3
    rows.splice(5, 1); // newest row deleted: no failure of its own
    const status = await verifyAuditChain(fakeDb(rows), { batchSize: 2 });
    expect(status).toMatchObject({ brokenAt: { chainSeq: 3, reason: 'link_mismatch' } });
  });

  it('stops reading at the first failure', async () => {
    const rows = buildChain(6);
    rows[0] = { ...rows[0]!, actor_role: 'forged' };
    const db = fakeDb(rows);
    await verifyAuditChain(db, { batchSize: 2 });
    expect(db.calls).toHaveLength(1);
  });

  it('refuses a chain_seq that is not a safe integer', async () => {
    const rows = buildChain(1);
    rows[0] = { ...rows[0]!, chain_seq: '9007199254740993' };
    await expect(verifyAuditChain(fakeDb(rows))).rejects.toThrow(/chain_seq/);
  });

  it('rejects a batch size below 1', async () => {
    await expect(verifyAuditChain(fakeDb([]), { batchSize: 0 })).rejects.toThrow(/batchSize/);
  });
});

describe('getChainStatus', () => {
  beforeEach(() => {
    resetChainStatusCache();
  });

  it('runs one verification for two concurrent callers (single flight)', async () => {
    const db = fakeDb(buildChain(3));
    const clock = fixedClock(T0);
    const [a, b] = await Promise.all([
      getChainStatus(db, { clock }),
      getChainStatus(db, { clock }),
    ]);
    expect(db.calls).toHaveLength(1);
    expect(a).toBe(b);
    expect(a.status).toBe('intact');
  });

  it('returns the cached object within maxAgeMs and re-verifies after it', async () => {
    const db = fakeDb(buildChain(3));
    const clock = fixedClock(T0);
    const first = await getChainStatus(db, { clock });
    clock.advance(59_999);
    expect(await getChainStatus(db, { clock })).toBe(first);
    expect(db.calls).toHaveLength(1);
    clock.advance(1);
    const second = await getChainStatus(db, { clock });
    expect(db.calls).toHaveLength(2);
    expect(second).not.toBe(first);
    expect(second.checkedAt).toBe('2026-11-01T08:01:00.000Z');
  });

  it('honours a custom maxAgeMs', async () => {
    const db = fakeDb(buildChain(1));
    const clock = fixedClock(T0);
    await getChainStatus(db, { clock, maxAgeMs: 1000 });
    clock.advance(1000);
    await getChainStatus(db, { clock, maxAgeMs: 1000 });
    expect(db.calls).toHaveLength(2);
  });

  it('always re-verifies with fresh: true and caches the fresh result', async () => {
    const rows = buildChain(3);
    const db = fakeDb(rows);
    const clock = fixedClock(T0);
    expect((await getChainStatus(db, { clock })).status).toBe('intact');
    rows[1] = { ...rows[1]!, entity_id: 'forged' };
    expect((await getChainStatus(db, { clock })).status).toBe('intact');
    const fresh = await getChainStatus(db, { clock, fresh: true });
    expect(fresh).toMatchObject({ status: 'broken', brokenAt: { chainSeq: 2 } });
    expect(db.calls).toHaveLength(2);
    expect(await getChainStatus(db, { clock })).toBe(fresh);
  });

  it('a fresh call does not join a verification that started before it', async () => {
    const db = fakeDb(buildChain(2));
    const clock = fixedClock(T0);
    await Promise.all([getChainStatus(db, { clock }), getChainStatus(db, { clock, fresh: true })]);
    expect(db.calls).toHaveLength(2);
  });

  it('does not cache a failed verification and propagates the error', async () => {
    const db = fakeDb(buildChain(2));
    const clock = fixedClock(T0);
    db.failNext(new Error('connection lost'));
    await expect(getChainStatus(db, { clock })).rejects.toThrow('connection lost');
    const status = await getChainStatus(db, { clock });
    expect(status.status).toBe('intact');
    expect(db.calls).toHaveLength(2);
  });

  it('shares the failure with every caller of the same flight', async () => {
    const db = fakeDb(buildChain(2));
    db.failNext(new Error('boom'));
    const results = await Promise.allSettled([getChainStatus(db), getChainStatus(db)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(db.calls).toHaveLength(1);
  });

  it('resetChainStatusCache forgets the cached value', async () => {
    const db = fakeDb(buildChain(1));
    await getChainStatus(db);
    resetChainStatusCache();
    await getChainStatus(db);
    expect(db.calls).toHaveLength(2);
  });
});
