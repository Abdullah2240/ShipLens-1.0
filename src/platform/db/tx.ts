import type { Pool, PoolClient } from 'pg';

/** Anything that can run a query: a Pool or a checked-out PoolClient. */
export type Queryable = { query: Pool['query'] };

export async function withTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
