import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const DEFAULT_TEST_DATABASE_URL = 'postgres://shiplens:shiplens@localhost:5434/shiplens_test';

export function getTestDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
}

// date columns come back as 'YYYY-MM-DD' strings, same as the app pool
pg.types.setTypeParser(1082, (v: string) => v);

let pool: pg.Pool | undefined;

export function testPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: getTestDatabaseUrl(), max: 5 });
  return pool;
}

export async function closeTestPool(): Promise<void> {
  const p = pool;
  pool = undefined;
  if (p) await p.end();
}

const TABLES = [
  'users',
  'sessions',
  'login_attempts',
  'branches',
  'audit_events',
  'weekly_reports',
  'collections',
  'report_events',
  'applications',
  'teams',
  'members',
  'content_entries',
  'events',
];

/** Empty every domain table. Never touches schema_migrations. Refuses non-test databases. */
export async function resetDb(p: pg.Pool = testPool()): Promise<void> {
  const client = await p.connect();
  try {
    const { rows } = await client.query<{ db: string }>('SELECT current_database() AS db');
    if (!rows[0]?.db.endsWith('_test')) {
      throw new Error('resetDb refuses to run against a database whose name does not end in _test');
    }
    await client.query('BEGIN');
    await client.query("SELECT set_config('shiplens.allow_truncate', 'on', true)");
    await client.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type BranchRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  summary: string | null;
  status: string;
};

export async function seedBranch(p: pg.Pool, overrides: Partial<Omit<BranchRow, 'id'>> = {}): Promise<BranchRow> {
  const suffix = randomUUID().slice(0, 8);
  const row = { code: `BR-${suffix}`, name: `Branch ${suffix}`, city: null, summary: null, status: 'active', ...overrides };
  const { rows } = await p.query<BranchRow>(
    `INSERT INTO branches (code, name, city, summary, status) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, code, name, city, summary, status`,
    [row.code, row.name, row.city, row.summary, row.status],
  );
  return rows[0]!;
}

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  branch_id: string | null;
};

const BRANCH_ROLES = new Set(['branch_lead', 'hr_lead']);

/** Insert a user. Branch roles get branchId; head-office roles must not have one. */
export async function seedUser(
  p: pg.Pool,
  opts: { role: string; branchId?: string | null; email?: string; name?: string },
): Promise<UserRow> {
  const suffix = randomUUID().slice(0, 8);
  const branchId = BRANCH_ROLES.has(opts.role) ? (opts.branchId ?? null) : null;
  const { rows } = await p.query<UserRow>(
    `INSERT INTO users (email, name, password_hash, role, branch_id) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, name, role, branch_id`,
    [opts.email ?? `${opts.role}-${suffix}@example.test`, opts.name ?? `${opts.role} ${suffix}`, 'not-a-real-hash', opts.role, branchId],
  );
  return rows[0]!;
}
