import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.mjs';

const baseUrl = new URL(process.env.TEST_DATABASE_URL);
const adminUrl = new URL(baseUrl);
adminUrl.pathname = '/postgres';

const MIGRATIONS_DIR = new URL('../db/migrations/', import.meta.url);

const EXPECTED_TABLES = [
  'applications',
  'audit_events',
  'branches',
  'collections',
  'content_entries',
  'events',
  'login_attempts',
  'members',
  'report_events',
  'schema_migrations',
  'sessions',
  'teams',
  'users',
  'weekly_reports',
];

/** Run fn against a brand new empty database, always dropping it afterwards. */
async function withFreshDatabase(fn) {
  const name = `shiplens_mig_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(baseUrl);
    url.pathname = `/${name}`;
    return await fn(url.toString());
  } finally {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

async function query(url, sql, params) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await c.query(sql, params);
  } finally {
    await c.end();
  }
}

describe('migration runner', () => {
  it('migrates an empty database to the full schema and is idempotent', async () => {
    await withFreshDatabase(async (url) => {
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
      const applied = await runMigrations({ connectionString: url });
      expect(applied).toEqual(files);

      const tables = await query(
        url,
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      );
      expect(tables.rows.map((r) => r.table_name)).toEqual(EXPECTED_TABLES);

      const seqs = await query(
        url,
        "SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' AND sequencename IN ('branch_code_seq', 'member_id_seq') ORDER BY 1",
      );
      expect(seqs.rows.map((r) => r.sequencename)).toEqual(['branch_code_seq', 'member_id_seq']);

      const week = await query(url, "SELECT pkt_week_start('2026-10-25'::date)::text AS d");
      expect(week.rows[0].d).toBe('2026-10-19');

      expect(await runMigrations({ connectionString: url })).toEqual([]);
    });
  });

  it('refuses to run when an applied file was modified', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'shiplens-mig-'));
    try {
      await cp(MIGRATIONS_DIR, tmp, { recursive: true });
      await withFreshDatabase(async (url) => {
        await runMigrations({ connectionString: url, dir: tmp });
        const target = path.join(tmp, '202610281000_foundation_identity_audit.sql');
        await writeFile(target, (await readFile(target, 'utf8')) + '-- tampered\n');
        await expect(runMigrations({ connectionString: url, dir: tmp })).rejects.toThrow(
          'Migration 202610281000_foundation_identity_audit.sql was modified after being applied',
        );
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('serialises concurrent runners with the advisory lock', async () => {
    await withFreshDatabase(async (url) => {
      const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
      const [a, b] = await Promise.all([
        runMigrations({ connectionString: url }),
        runMigrations({ connectionString: url }),
      ]);
      // exactly one runner applied the files; the other waited and found nothing to do
      expect([a.length, b.length].sort()).toEqual([0, files.length]);
      const rows = await query(url, 'SELECT name FROM schema_migrations ORDER BY name');
      expect(rows.rows.map((r) => r.name)).toEqual(files);
    });
  });

  it('rolls back a failing file and records nothing for it', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'shiplens-mig-'));
    try {
      await writeFile(path.join(tmp, '001_ok.sql'), 'CREATE TABLE ok_table (id int);');
      await writeFile(path.join(tmp, '002_bad.sql'), 'CREATE TABLE half_table (id int); SELECT nope_column FROM ok_table;');
      await withFreshDatabase(async (url) => {
        await expect(runMigrations({ connectionString: url, dir: tmp })).rejects.toThrow(/nope_column/);
        const names = await query(url, 'SELECT name FROM schema_migrations ORDER BY name');
        expect(names.rows.map((r) => r.name)).toEqual(['001_ok.sql']);
        const half = await query(url, "SELECT to_regclass('public.half_table')::text AS t");
        expect(half.rows[0].t).toBeNull();
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
