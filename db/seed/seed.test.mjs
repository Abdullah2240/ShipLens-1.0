// Integration tests for the seed runner, step 01 and the boot hook in scripts/migrate.mjs.
// They run against the lane test database (already migrated by the global setup) and
// empty it with resetDb() before each test. The seed itself never truncates.
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../scripts/lib/password.mjs';
import { runSeedIfRequested } from '../../scripts/migrate.mjs';
import {
  closeTestPool,
  getTestDatabaseUrl,
  resetDb,
  seedBranch,
  seedUser,
  testPool,
} from '../../tests/support/db';
import { DEMO_BRANCH, DEMO_USERS } from './demo-users.mjs';
import { runSeed } from './index.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEED_DIR = fileURLToPath(new URL('./', import.meta.url));
const STEP_01 = new URL('./steps/01-demo-branch-and-users.mjs', import.meta.url);

const PASSWORD = 'seed-test-password-0';
const connectionString = getTestDatabaseUrl();
const quiet = () => {};

function seedEnv(extra = {}) {
  return { SEED_DEMO_PASSWORD: PASSWORD, ...extra };
}

async function counts() {
  const { rows } = await testPool().query(`
    SELECT (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM branches)::int AS branches,
           (SELECT count(*) FROM audit_events)::int AS audit`);
  return rows[0];
}

async function branchSeqState() {
  const { rows } = await testPool().query(
    'SELECT last_value::text AS v, is_called FROM branch_code_seq',
  );
  return rows[0];
}

async function demoUsers() {
  const { rows } = await testPool().query(
    `SELECT u.email, u.name, u.role, u.branch_id, u.password_hash, u.is_active
       FROM users u WHERE lower(u.email) = ANY($1::text[]) ORDER BY u.email`,
    [DEMO_USERS.map((u) => u.email.toLowerCase())],
  );
  return rows;
}

async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closeTestPool();
});

describe('runSeed on a fresh database', () => {
  it('creates one active branch and the five role users', async () => {
    const result = await runSeed({ connectionString, env: seedEnv(), log: quiet });
    expect(result.steps).toContain('01-demo-branch-and-users');

    const { rows: branches } = await testPool().query(
      'SELECT id, code, name, city, status FROM branches',
    );
    expect(branches).toHaveLength(1);
    const branch = branches[0];
    expect(branch).toMatchObject({ name: DEMO_BRANCH.name, city: 'Karachi', status: 'active' });
    expect(branch.code).toMatch(/^BR\d{3,}$/);
    const seq = await branchSeqState();
    expect(branch.code).toBe(`BR${seq.v.padStart(3, '0')}`);

    const users = await demoUsers();
    expect(users).toHaveLength(5);
    expect(await counts()).toMatchObject({ users: 5, branches: 1 });
    for (const expected of DEMO_USERS) {
      const row = users.find((u) => u.email === expected.email);
      expect(row, expected.email).toBeDefined();
      expect(row.name).toBe(expected.name);
      expect(row.role).toBe(expected.role);
      expect(row.is_active).toBe(true);
      expect(row.branch_id).toBe(expected.branchScoped ? branch.id : null);
      expect(await verifyPassword(row.password_hash, PASSWORD)).toBe(true);
    }
    // each user has its own salt
    expect(new Set(users.map((u) => u.password_hash)).size).toBe(5);
  });

  it('writes a system audit event per created row with allowlisted fields only', async () => {
    await runSeed({ connectionString, env: seedEnv(), log: quiet });
    const { rows } = await testPool().query(
      `SELECT actor_id, actor_role, action, entity_type, entity_id, branch_id, before, after
         FROM audit_events ORDER BY id`,
    );
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.actor_id).toBeNull();
      expect(row.actor_role).toBe('system');
      expect(row.action).toBe('seed.created');
      expect(row.before).toBeNull();
      expect(JSON.stringify(row.after)).not.toMatch(/password|hash|email|argon/i);
    }
    const branchRows = rows.filter((r) => r.entity_type === 'branch');
    expect(branchRows).toHaveLength(1);
    expect(Object.keys(branchRows[0].after).sort()).toEqual([
      'city',
      'code',
      'name',
      'status',
      'summary',
    ]);
    expect(branchRows[0].branch_id).toBe(branchRows[0].entity_id);

    const userRows = rows.filter((r) => r.entity_type === 'user');
    expect(userRows).toHaveLength(5);
    const { rows: users } = await testPool().query('SELECT id, branch_id FROM users');
    for (const row of userRows) {
      expect(Object.keys(row.after).sort()).toEqual(['branch_id', 'name', 'role']);
      const user = users.find((u) => u.id === row.entity_id);
      expect(user).toBeDefined();
      expect(row.branch_id).toBe(user.branch_id);
    }
  });
});

describe('idempotency and data safety', () => {
  it('changes nothing on a second run and consumes no sequence value', async () => {
    await runSeed({ connectionString, env: seedEnv(), log: quiet });
    const before = await counts();
    const seqBefore = await branchSeqState();
    const usersBefore = await demoUsers();

    const second = await runSeed({ connectionString, env: seedEnv(), log: quiet });
    expect(second.steps).toContain('01-demo-branch-and-users');
    expect(await counts()).toEqual(before);
    expect(await branchSeqState()).toEqual(seqBefore);
    expect(await demoUsers()).toEqual(usersBefore);
  });

  it('leaves pre-existing unrelated data untouched', async () => {
    const pool = testPool();
    const otherBranch = await seedBranch(pool, { name: 'Existing Branch', status: 'paused' });
    const otherUser = await seedUser(pool, { role: 'branch_lead', branchId: otherBranch.id });
    const snapshot = async () =>
      (
        await pool.query(
          `SELECT b.code, b.name, b.status, b.updated_at, u.email, u.role, u.branch_id, u.password_hash, u.updated_at AS u_updated
             FROM branches b JOIN users u ON u.id = $1 WHERE b.id = $2`,
          [otherUser.id, otherBranch.id],
        )
      ).rows[0];
    const before = await snapshot();

    await runSeed({ connectionString, env: seedEnv(), log: quiet });
    await runSeed({
      connectionString,
      env: seedEnv({ SEED_ROTATE_DEMO_PASSWORDS: 'true' }),
      log: quiet,
    });

    expect(await snapshot()).toEqual(before);
    expect(await counts()).toMatchObject({ users: 6, branches: 2 });
  });

  it('adopts an existing demo branch and existing demo users without overwriting them', async () => {
    const pool = testPool();
    const branch = await seedBranch(pool, {
      name: DEMO_BRANCH.name,
      status: 'paused',
      code: 'BR-KEEP',
    });
    const lead = await seedUser(pool, {
      role: 'branch_lead',
      branchId: branch.id,
      email: 'Lead@Shiplens.test',
      name: 'Renamed Lead',
    });
    const seqBefore = await branchSeqState();

    await runSeed({ connectionString, env: seedEnv(), log: quiet });

    expect(await branchSeqState()).toEqual(seqBefore);
    const { rows: branches } = await pool.query('SELECT id, code, status FROM branches');
    expect(branches).toEqual([{ id: branch.id, code: 'BR-KEEP', status: 'paused' }]);
    const { rows: leads } = await pool.query(
      "SELECT id, name, password_hash FROM users WHERE lower(email) = 'lead@shiplens.test'",
    );
    expect(leads).toEqual([
      { id: lead.id, name: 'Renamed Lead', password_hash: 'not-a-real-hash' },
    ]);
    const { rows: hr } = await pool.query(
      "SELECT branch_id FROM users WHERE email = 'hr@shiplens.test'",
    );
    expect(hr[0].branch_id).toBe(branch.id);
    expect(await counts()).toMatchObject({ users: 5, branches: 1 });
  });

  it('serialises concurrent runs', async () => {
    await Promise.all([
      runSeed({ connectionString, env: seedEnv(), log: quiet }),
      runSeed({ connectionString, env: seedEnv(), log: quiet }),
    ]);
    expect(await counts()).toMatchObject({ users: 5, branches: 1, audit: 6 });
  });

  it('never issues TRUNCATE or DELETE', async () => {
    const files = [
      path.join(SEED_DIR, 'index.mjs'),
      path.join(SEED_DIR, 'demo-users.mjs'),
      ...(await readdir(path.join(SEED_DIR, 'steps'))).map((f) => path.join(SEED_DIR, 'steps', f)),
    ];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // SQL keywords are written in upper case throughout the repo
      expect(source, file).not.toMatch(/\bTRUNCATE\b/);
      expect(source, file).not.toMatch(/\bDELETE\b/);
    }
  });

  it('imports only node built-ins, pg, seed files and the password helper', async () => {
    const files = [
      path.join(SEED_DIR, 'index.mjs'),
      path.join(SEED_DIR, 'demo-users.mjs'),
      ...(await readdir(path.join(SEED_DIR, 'steps'))).map((f) => path.join(SEED_DIR, 'steps', f)),
    ];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const specifiers = [
        ...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm),
      ].map((m) => m[1]);
      for (const spec of specifiers) {
        const ok =
          spec.startsWith('node:') ||
          spec === 'pg' ||
          spec === '../../scripts/lib/password.mjs' ||
          ((spec.startsWith('./') || spec.startsWith('../')) &&
            path.resolve(path.dirname(file), spec).startsWith(path.resolve(SEED_DIR)));
        expect(ok, `${path.basename(file)} imports ${spec}`).toBe(true);
      }
    }
  });
});

describe('password handling', () => {
  it.each([
    ['missing', {}],
    ['blank', { SEED_DEMO_PASSWORD: '' }],
    ['shorter than 12 characters', { SEED_DEMO_PASSWORD: 'short-pass1' }],
  ])('rejects when SEED_DEMO_PASSWORD is %s and writes nothing', async (_label, env) => {
    const lines = [];
    const err = await runSeed({ connectionString, env, log: (m) => lines.push(m) }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/SEED_DEMO_PASSWORD/);
    if (env.SEED_DEMO_PASSWORD) {
      expect(err.message).not.toContain(env.SEED_DEMO_PASSWORD);
      expect(lines.join('\n')).not.toContain(env.SEED_DEMO_PASSWORD);
    }
    expect(await counts()).toEqual({ users: 0, branches: 0, audit: 0 });
  });

  it('never logs the password', async () => {
    const lines = [];
    await runSeed({ connectionString, env: seedEnv(), log: (m) => lines.push(String(m)) });
    await runSeed({
      connectionString,
      env: seedEnv({ SEED_ROTATE_DEMO_PASSWORDS: 'true' }),
      log: (m) => lines.push(String(m)),
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(PASSWORD);
    expect(lines.join('\n')).not.toMatch(/\$argon2/);
  });

  it('keeps existing hashes when the password changes without the rotate flag', async () => {
    await runSeed({ connectionString, env: seedEnv(), log: quiet });
    const before = await demoUsers();
    await runSeed({
      connectionString,
      env: { SEED_DEMO_PASSWORD: 'a-different-password-1' },
      log: quiet,
    });
    expect(await demoUsers()).toEqual(before);
  });

  it('SEED_ROTATE_DEMO_PASSWORDS re-hashes only the five demo users', async () => {
    const pool = testPool();
    await runSeed({ connectionString, env: seedEnv(), log: quiet });
    const other = await seedUser(pool, { role: 'super_admin', email: 'someone@example.test' });
    const auditBefore = (await counts()).audit;

    const next = 'rotated-password-0042';
    await runSeed({
      connectionString,
      env: { SEED_DEMO_PASSWORD: next, SEED_ROTATE_DEMO_PASSWORDS: 'true' },
      log: quiet,
    });

    for (const user of await demoUsers()) {
      expect(await verifyPassword(user.password_hash, next), user.email).toBe(true);
      expect(await verifyPassword(user.password_hash, PASSWORD), user.email).toBe(false);
    }
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [other.id]);
    expect(rows[0].password_hash).toBe('not-a-real-hash');

    const { rows: audit } = await pool.query(
      "SELECT actor_role, entity_type, after FROM audit_events WHERE action = 'seed.password_rotated'",
    );
    expect(audit).toHaveLength(5);
    for (const row of audit) {
      expect(row).toMatchObject({ actor_role: 'system', entity_type: 'user', after: null });
    }
    expect((await counts()).audit).toBe(auditBefore + 5);
  });
});

describe('step discovery and transaction', () => {
  it('runs step files in filename order inside one transaction', async () => {
    const dir = await tempDir('shiplens-seed-steps-');
    try {
      await writeFile(
        path.join(dir, '01-demo.mjs'),
        `export { name, run } from ${JSON.stringify(STEP_01.href)};\n`,
      );
      await writeFile(
        path.join(dir, '02-check.mjs'),
        [
          "export const name = '02-check';",
          'export async function run(client, ctx) {',
          "  const { rows } = await client.query('SELECT count(*)::int AS n FROM users');",
          "  ctx.log('users seen by step 02: ' + rows[0].n);",
          "  if (typeof ctx.hashPassword !== 'function') throw new Error('hashPassword missing');",
          '}',
          '',
        ].join('\n'),
      );
      await writeFile(path.join(dir, 'notes.txt'), 'ignored');
      const lines = [];
      const result = await runSeed({
        connectionString,
        env: seedEnv(),
        log: (m) => lines.push(m),
        stepsDir: dir,
      });
      expect(result.steps).toEqual(['01-demo-branch-and-users', '02-check']);
      expect(lines).toContain('users seen by step 02: 5');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a failing step rolls back everything from earlier steps in the run', async () => {
    const dir = await tempDir('shiplens-seed-steps-');
    try {
      await writeFile(
        path.join(dir, '01-demo.mjs'),
        `export { name, run } from ${JSON.stringify(STEP_01.href)};\n`,
      );
      await writeFile(
        path.join(dir, '02-boom.mjs'),
        "export const name = '02-boom';\nexport async function run() { throw new Error('boom from step 02'); }\n",
      );
      await expect(
        runSeed({ connectionString, env: seedEnv(), log: quiet, stepsDir: dir }),
      ).rejects.toThrow(/boom from step 02/);
      expect(await counts()).toEqual({ users: 0, branches: 0, audit: 0 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects a step module that does not follow the contract', async () => {
    const dir = await tempDir('shiplens-seed-steps-');
    try {
      await writeFile(path.join(dir, '01-bad.mjs'), 'export const name = 1;\n');
      await expect(
        runSeed({ connectionString, env: seedEnv(), log: quiet, stepsDir: dir }),
      ).rejects.toThrow(/01-bad\.mjs/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('boot hook in scripts/migrate.mjs', () => {
  async function throwingSeedModule() {
    const dir = await tempDir('shiplens-seed-hook-');
    const file = path.join(dir, 'index.mjs');
    await writeFile(file, "throw new Error('seed module was imported');\n");
    return { dir, url: pathToFileURL(file) };
  }

  it.each([undefined, 'false', ''])(
    'does not load seed code when SEED_ON_BOOT is %s',
    async (flag) => {
      const { dir, url } = await throwingSeedModule();
      try {
        const env = flag === undefined ? {} : { SEED_ON_BOOT: flag };
        await expect(
          runSeedIfRequested({ connectionString, env, seedModule: url, log: quiet }),
        ).resolves.toBe(false);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it('loads and runs the seed module when SEED_ON_BOOT is true', async () => {
    const { dir, url } = await throwingSeedModule();
    try {
      await expect(
        runSeedIfRequested({
          connectionString,
          env: { SEED_ON_BOOT: 'true' },
          seedModule: url,
          log: quiet,
        }),
      ).rejects.toThrow(/seed module was imported/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  function migrateProcess(env) {
    const base = { ...process.env };
    delete base.SEED_ON_BOOT;
    delete base.SEED_DEMO_PASSWORD;
    delete base.SEED_ROTATE_DEMO_PASSWORDS;
    return run(process.execPath, ['scripts/migrate.mjs'], {
      cwd: ROOT,
      env: { ...base, DATABASE_URL: connectionString, ...env },
    }).then(
      (r) => ({ code: 0, stdout: r.stdout, stderr: r.stderr }),
      (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }),
    );
  }

  it('migrates then seeds with SEED_ON_BOOT=true, and a second boot changes nothing', async () => {
    const first = await migrateProcess({ SEED_ON_BOOT: 'true', SEED_DEMO_PASSWORD: PASSWORD });
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).not.toContain(PASSWORD);
    expect(await counts()).toEqual({ users: 5, branches: 1, audit: 6 });

    const second = await migrateProcess({ SEED_ON_BOOT: 'true', SEED_DEMO_PASSWORD: PASSWORD });
    expect(second.code, second.stderr).toBe(0);
    expect(await counts()).toEqual({ users: 5, branches: 1, audit: 6 });
  });

  it('does not seed when SEED_ON_BOOT is unset', async () => {
    const result = await migrateProcess({});
    expect(result.code, result.stderr).toBe(0);
    expect(await counts()).toEqual({ users: 0, branches: 0, audit: 0 });
  });

  it('exits non-zero when the seed fails', async () => {
    const result = await migrateProcess({ SEED_ON_BOOT: 'true', SEED_DEMO_PASSWORD: 'short' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/SEED_DEMO_PASSWORD/);
    expect(await counts()).toEqual({ users: 0, branches: 0, audit: 0 });
  });
});

describe('docs/test-logins.md', () => {
  it('lists exactly the five demo emails with their names and the demo branch', async () => {
    const doc = await readFile(path.join(ROOT, 'docs', 'test-logins.md'), 'utf8');
    const emails = [...doc.matchAll(/[a-z0-9.+-]+@[a-z0-9.-]+\.test\b/gi)].map((m) => m[0]);
    expect([...new Set(emails)].sort()).toEqual(DEMO_USERS.map((u) => u.email).sort());
    for (const user of DEMO_USERS) expect(doc).toContain(user.name);
    expect(doc).toContain(DEMO_BRANCH.name);
    expect(doc).toContain('SEED_DEMO_PASSWORD');
    expect(doc).toContain('SEED_ROTATE_DEMO_PASSWORDS=true');
  });
});
