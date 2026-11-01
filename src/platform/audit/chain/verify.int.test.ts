import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
import { getChainStatus, resetChainStatusCache, verifyAuditChain } from './verify';

const pool = testPool();

afterAll(async () => {
  await closeTestPool();
});

beforeEach(async () => {
  await resetDb(pool);
  resetChainStatusCache();
});

async function superAdmin(): Promise<Actor> {
  const user = await seedUser(pool, { role: 'super_admin' });
  return { userId: user.id, role: 'super_admin', branchId: null };
}

function ctxFor(actor: Actor, requestId: string): CommandContext {
  return { actor, requestId, clock: fixedClock('2026-10-28T10:00:00Z'), pool };
}

async function headHash(): Promise<string> {
  const { rows } = await pool.query<{ hash: string }>(
    'SELECT hash FROM audit_events ORDER BY chain_seq DESC LIMIT 1',
  );
  return rows[0]!.hash;
}

describe('verifyAuditChain on the real table', () => {
  it('reports empty for a fresh database', async () => {
    const status = await verifyAuditChain(pool);
    expect(status.status).toBe('empty');
    expect(status.checkedEvents).toBe(0);
  });

  it('verifies rows written through command() and through direct SQL as intact', async () => {
    const actor = await superAdmin();
    const branch = await seedBranch(pool, { name: 'Lahore Central' });
    await command(ctxFor(actor, 'req-v-1'), 'branches.update', async (_tx, audit) => {
      audit({
        action: 'branch.update',
        entityType: 'branch',
        entityId: branch.id,
        branchId: branch.id,
        before: { name: 'Lahore Central', city: null },
        after: { name: 'لاہور مرکزی', city: 'Lahore' },
      });
      audit({
        action: 'branch.archive',
        entityType: 'branch',
        entityId: branch.id,
        after: { status: 'archived' },
      });
    });
    await pool.query(
      `INSERT INTO audit_events (occurred_at, request_id, actor_role, action, entity_type, entity_id, before, after)
       VALUES ('2026-10-28T15:30:00.000001+05:00', NULL, 'system', 'seed.note', 'thing', 'x|1:y',
               '{"q": "it''s \\\\ \\"quoted\\""}', '{"nested": {"a": [1, 2.50, null]}}')`,
    );
    await command(ctxFor(actor, 'req-v-2'), 'reports.approve', async (_tx, audit) => {
      audit({
        action: 'report.approve',
        entityType: 'report',
        entityId: 'r-1',
        branchId: branch.id,
        before: { status: 'submitted' },
        after: { status: 'approved', version: 3 },
      });
    });

    const status = await verifyAuditChain(pool, { clock: fixedClock('2026-11-01T00:00:00Z') });
    expect(status).toEqual({
      status: 'intact',
      checkedEvents: 4,
      head: { chainSeq: 4, hash: await headHash() },
      checkedAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('verifies 2,500 rows with the default batch size in under 5 seconds', async () => {
    await pool.query(
      `INSERT INTO audit_events (request_id, actor_role, action, entity_type, entity_id, after)
       SELECT 'bulk-' || n, 'system', 'thing.update', 'thing', n::text, jsonb_build_object('n', n, 'label', 'رپورٹ ' || n)
       FROM generate_series(1, 2500) AS n`,
    );
    const started = performance.now();
    const status = await verifyAuditChain(pool);
    const elapsed = performance.now() - started;
    console.info(`verifyAuditChain: 2,500 rows in ${elapsed.toFixed(0)} ms`);
    expect(status.status).toBe('intact');
    expect(status.checkedEvents).toBe(2500);
    expect(status.status === 'intact' && status.head.chainSeq).toBe(2500);
    expect(elapsed).toBeLessThan(5000);
  });

  it('pages correctly across batch boundaries past chain_seq 10', async () => {
    await pool.query(
      `INSERT INTO audit_events (actor_role, action, entity_type, entity_id)
       SELECT 'system', 'thing.update', 'thing', n::text FROM generate_series(1, 23) AS n`,
    );
    const status = await verifyAuditChain(pool, { batchSize: 4 });
    expect(status).toMatchObject({ status: 'intact', checkedEvents: 23, head: { chainSeq: 23 } });
  });
});

describe('getChainStatus on the real table', () => {
  it('caches the status and sees new rows only after a fresh check', async () => {
    const clock = fixedClock('2026-11-01T00:00:00Z');
    await pool.query(
      "INSERT INTO audit_events (actor_role, action, entity_type, entity_id) VALUES ('system', 'thing.update', 'thing', '1')",
    );
    const first = await getChainStatus(pool, { clock });
    expect(first).toMatchObject({ status: 'intact', checkedEvents: 1 });
    await pool.query(
      "INSERT INTO audit_events (actor_role, action, entity_type, entity_id) VALUES ('system', 'thing.update', 'thing', '2')",
    );
    expect(await getChainStatus(pool, { clock })).toBe(first);
    expect(await getChainStatus(pool, { clock, fresh: true })).toMatchObject({
      status: 'intact',
      checkedEvents: 2,
    });
  });
});
