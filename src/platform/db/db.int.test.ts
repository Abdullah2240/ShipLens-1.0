import { afterAll, describe, expect, it } from 'vitest';
import { closePool, getPool, withTransaction } from '@/platform/db';
import { resetDb } from '../../../tests/support/db';

afterAll(async () => {
  await closePool();
});

describe('pg type parsers', () => {
  it('returns date as a YYYY-MM-DD string', async () => {
    const { rows } = await getPool().query("SELECT '2026-10-26'::date AS d");
    expect(rows[0].d).toBe('2026-10-26');
  });

  it('returns numeric as a string, preserving scale', async () => {
    const { rows } = await getPool().query('SELECT 12.50::numeric(14,2) AS n');
    expect(rows[0].n).toBe('12.50');
  });

  it('returns bigint as a string', async () => {
    const { rows } = await getPool().query('SELECT 1::bigint AS b');
    expect(typeof rows[0].b).toBe('string');
    expect(rows[0].b).toBe('1');
  });
});

describe('withTransaction', () => {
  it('commits on success and releases the client', async () => {
    await resetDb();
    const pool = getPool();
    await withTransaction(pool, (tx) =>
      tx.query("INSERT INTO branches (code, name) VALUES ('TX-1', 'Committed')"),
    );
    const { rows } = await pool.query("SELECT name FROM branches WHERE code = 'TX-1'");
    expect(rows).toHaveLength(1);
    expect(pool.idleCount).toBe(pool.totalCount);
  });

  it('rolls back, rethrows and releases the client on error', async () => {
    await resetDb();
    const pool = getPool();
    await expect(
      withTransaction(pool, async (tx) => {
        await tx.query("INSERT INTO branches (code, name) VALUES ('TX-2', 'Rolled back')");
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const { rows } = await pool.query("SELECT 1 FROM branches WHERE code = 'TX-2'");
    expect(rows).toHaveLength(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
});
