// Same import-time rule as config/env.ts: loading this module only registers a type
// parser. It never reads the environment or opens a connection until getPool() is
// called from inside a handler or script.
import { Pool, types } from 'pg';
import { PG_POOL_MAX } from '@/platform/config/constants';
import { getEnv } from '@/platform/config/env';

// date (OID 1082) stays a 'YYYY-MM-DD' string so PKT business dates never pass through
// a JS Date. numeric (1700) and int8 (20) keep the pg default of strings; money and
// counters are never parsed to number.
types.setTypeParser(1082, (v: string) => v);

const globalForPool = globalThis as unknown as { __shiplensPool?: Pool };

export function getPool(): Pool {
  globalForPool.__shiplensPool ??= new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: PG_POOL_MAX,
    idleTimeoutMillis: 30_000,
  });
  return globalForPool.__shiplensPool;
}

export async function closePool(): Promise<void> {
  const pool = globalForPool.__shiplensPool;
  globalForPool.__shiplensPool = undefined;
  if (pool) await pool.end();
}
