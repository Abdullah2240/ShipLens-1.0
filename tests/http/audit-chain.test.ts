import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/audit/chain/route';
import { command } from '@/platform/audit/command';
import { resetChainStatusCache } from '@/platform/audit/chain/verify';
import type { ChainStatus } from '@/platform/audit/chain/types';
import { closePool } from '@/platform/db';
import { fixedClock } from '@/platform/time';
import { closeTestPool, resetDb, seedBranch, seedUser, testPool } from '../support/db';
import { createSessionCookie } from '../support/session';

const db = testPool();
const base = 'http://localhost:3000/api/v1/audit/chain';
const GUARD = 'audit_events_no_update_delete';
const cookies: Record<string, string> = {};

function call(query = '', cookie?: string): Promise<Response> {
  return GET(new Request(`${base}${query}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({}),
  });
}

async function status(query: string, role: string): Promise<ChainStatus> {
  const res = await call(query, cookies[role]);
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: ChainStatus }).data;
}

/** Edits audit rows as a database owner: guard disabled and re-enabled in one transaction. */
async function tamper(sql: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE audit_events DISABLE TRIGGER ${GUARD}`);
    await client.query(sql);
    await client.query(`ALTER TABLE audit_events ENABLE TRIGGER ${GUARD}`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  await resetDb(db);
  const branch = await seedBranch(db, { name: 'Alpha' });
  const users = {
    superAdmin: await seedUser(db, { role: 'super_admin' }),
    finance: await seedUser(db, { role: 'finance_reviewer' }),
    lead: await seedUser(db, { role: 'branch_lead', branchId: branch.id }),
    hr: await seedUser(db, { role: 'hr_lead', branchId: branch.id }),
    editor: await seedUser(db, { role: 'content_editor' }),
  };
  for (const [key, user] of Object.entries(users)) {
    cookies[key] = await createSessionCookie(db, user.id);
  }
  const actor = { userId: users.superAdmin.id, role: 'super_admin' as const, branchId: null };
  for (const name of ['North', 'South', 'East']) {
    await command(
      {
        actor,
        requestId: `req-chain-${name}`,
        clock: fixedClock('2026-10-28T10:00:00Z'),
        pool: db,
      },
      'branches.update',
      async (_tx, audit) => {
        audit({
          action: 'branch.update',
          entityType: 'branch',
          entityId: branch.id,
          branchId: branch.id,
          before: { name: 'Alpha' },
          after: { name: `Alpha ${name}` },
        });
      },
    );
  }
});

beforeEach(() => {
  resetChainStatusCache();
});

afterAll(async () => {
  // Leave no tampered chain behind for later suites.
  await resetDb(db);
  await closePool();
  await closeTestPool();
});

describe('GET /api/v1/audit/chain access', () => {
  it('401 without a session', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('unauthenticated');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['lead', 'hr', 'editor'])('403 for %s', async (role) => {
    const res = await call('', cookies[role]);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden');
  });

  it.each(['superAdmin', 'finance'])('200 with the intact status for %s', async (role) => {
    const res = await call('', cookies[role]);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { data: ChainStatus };
    expect(Object.keys(body)).toEqual(['data']);
    expect(body.data).toMatchObject({ status: 'intact', checkedEvents: 3, head: { chainSeq: 3 } });
  });

  it('returns only the ChainStatus fields, never row content', async () => {
    const res = await call('', cookies.superAdmin);
    const text = await res.text();
    const body = JSON.parse(text) as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual(['checkedAt', 'checkedEvents', 'head', 'status']);
    expect(Object.keys(body.data.head as object).sort()).toEqual(['chainSeq', 'hash']);
    for (const leak of ['Alpha', 'branch.update', 'req-chain', 'super_admin']) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('GET /api/v1/audit/chain after tampering', () => {
  it('serves the cached status within 60 s and the broken status with ?fresh=1', async () => {
    expect((await status('', 'finance')).status).toBe('intact');
    await tamper(
      `UPDATE audit_events SET after = jsonb_set(after, '{name}', '"Forged"') WHERE chain_seq = 2`,
    );

    const cached = await status('', 'finance');
    expect(cached.status).toBe('intact');

    const fresh = await status('?fresh=1', 'superAdmin');
    expect(fresh).toMatchObject({
      status: 'broken',
      checkedEvents: 1,
      brokenAt: { chainSeq: 2, reason: 'hash_mismatch' },
    });
    expect(Object.keys(fresh).sort()).toEqual(['brokenAt', 'checkedAt', 'checkedEvents', 'status']);

    // The fresh result replaces the cached one.
    expect((await status('', 'finance')).status).toBe('broken');
  });

  it('leaves the append-only guard enabled', async () => {
    const { rows } = await db.query<{ tgenabled: string }>(
      `SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'audit_events'::regclass AND tgname = $1`,
      [GUARD],
    );
    expect(rows[0]?.tgenabled).toBe('O');
    await expect(
      db.query("UPDATE audit_events SET action = 'x' WHERE chain_seq = 1"),
    ).rejects.toMatchObject({ code: 'P0001' });
  });
});
