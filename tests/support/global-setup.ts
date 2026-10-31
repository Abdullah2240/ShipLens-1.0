import pg from 'pg';
import { runMigrations } from '../../scripts/migrate.mjs';
import { getTestDatabaseUrl } from './db';

// Creates the test database if missing and migrates it. Never drops anything.
export default async function setup() {
  const url = new URL(getTestDatabaseUrl());
  const dbName = url.pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point at a database whose name matches [a-z0-9_]+_test');
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!rowCount) {
      try {
        await client.query(`CREATE DATABASE ${dbName}`);
      } catch (err) {
        // lost a race with another runner creating the same database
        if ((err as { code?: string }).code !== '42P04') throw err;
      }
    }
  } finally {
    await client.end();
  }

  await runMigrations({ connectionString: url.toString() });

  return async function teardown() {
    // intentionally non-destructive: the test database is kept between runs
  };
}
