// Integration tests for seed step 02 (the demo dataset): load counts, guard-safe history
// replay, audit trail, idempotency, and fidelity against db/seed/expected.json, which is
// computed independently from the data files by scripts/demo-data/expected.mjs.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../scripts/lib/password.mjs';
import { AUDIT_FIELD_ALLOWLIST } from '../../src/platform/audit/allowlist';
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
import { run as runStep02 } from './steps/02-demo-data.mjs';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STEP_FILE = new URL('./steps/02-demo-data.mjs', import.meta.url);
const PASSWORD = 'local-test-only-password';
const connectionString = getTestDatabaseUrl();
const quiet = () => {};

function readData(file) {
  return JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), 'utf8'));
}

const data = {
  branches: readData('branches.json'),
  users: readData('users.json'),
  teams: readData('teams.json'),
  members: readData('members.json'),
  applications: readData('applications.json'),
  reports: readData('reports.json'),
  collections: readData('collections.json'),
};
const expected = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));
const historyCount = data.reports.reduce((n, r) => n + r.history.length, 0);
const branchNameByKey = new Map(data.branches.map((b) => [b.key, b.name]));
const emailByKey = new Map(data.users.map((u) => [u.key, u.email]));
const REPORT_ACTION = {
  submitted: 'report.submit',
  resubmitted: 'report.resubmit',
  returned: 'report.return',
  approved: 'report.approve',
};
const TABLES = [
  'branches',
  'users',
  'teams',
  'members',
  'applications',
  'weekly_reports',
  'collections',
  'report_events',
  'audit_events',
];

function seed(env = {}) {
  return runSeed({ connectionString, env: { SEED_DEMO_PASSWORD: PASSWORD, ...env }, log: quiet });
}

async function tableCounts() {
  const sql = TABLES.map((t) => `(SELECT count(*)::int FROM ${t}) AS ${t}`).join(', ');
  const { rows } = await testPool().query(`SELECT ${sql}`);
  return rows[0];
}

async function maxIds() {
  const { rows } = await testPool().query(
    `SELECT (SELECT max(id)::text FROM audit_events) AS audit,
            (SELECT max(id)::text FROM report_events) AS events,
            (SELECT last_value::text FROM branch_code_seq) AS branch_seq,
            (SELECT last_value::text FROM member_id_seq) AS member_seq`,
  );
  return rows[0];
}

const MONEY_KPIS = {
  collected: "c.status = 'active'",
  approved: "c.status = 'active' AND r.status = 'approved'",
  pending_approval: "c.status = 'active' AND r.status = 'submitted'",
  in_progress: "c.status = 'active' AND r.status IN ('draft', 'returned')",
  not_yet_routed: "c.status = 'active' AND r.status = 'approved' AND c.routed_at IS NULL",
  routed: "c.status = 'active' AND r.status = 'approved' AND c.routed_at IS NOT NULL",
};

function kpiColumns() {
  return Object.entries(MONEY_KPIS)
    .map(
      ([k, p]) =>
        `coalesce(sum(c.amount) FILTER (WHERE ${p}), 0)::numeric(14,2)::text AS ${k}_amount,
         (count(c.id) FILTER (WHERE ${p}))::int AS ${k}_count`,
    )
    .join(',\n');
}

function kpiObject(row) {
  const out = {};
  for (const k of Object.keys(MONEY_KPIS)) {
    out[k] = { amount: row[`${k}_amount`], count: row[`${k}_count`] };
  }
  return out;
}

function pktDate(iso) {
  return new Date(Date.parse(iso) + 5 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

afterAll(async () => {
  await closeTestPool();
});

describe('fresh load', () => {
  let ids;

  beforeAll(async () => {
    await resetDb();
    await seed();
    const pool = testPool();
    const { rows: branches } = await pool.query('SELECT id, name FROM branches');
    const { rows: users } = await pool.query('SELECT id, lower(email) AS email FROM users');
    ids = {
      branch: new Map(branches.map((b) => [b.name, b.id])),
      user: new Map(users.map((u) => [u.email, u.id])),
    };
  }, 60000);

  const branchId = (key) => ids.branch.get(branchNameByKey.get(key));
  const userId = (key) => ids.user.get(emailByKey.get(key).toLowerCase());

  it('loads every data file exactly once, adopting the sample branch and demo users', async () => {
    expect(await tableCounts()).toMatchObject({
      branches: data.branches.length,
      users: data.users.length,
      teams: data.teams.length,
      members: data.members.length,
      applications: data.applications.length,
      weekly_reports: data.reports.length,
      collections: data.collections.length,
      report_events: historyCount,
    });
    const { rows } = await testPool().query(
      'SELECT count(*)::int AS n FROM branches WHERE name = $1',
      [DEMO_BRANCH.name],
    );
    expect(rows[0].n).toBe(1);
  });

  it('stores every collection with the values from the data file', async () => {
    const { rows } = await testPool().query(
      `SELECT id, report_id, branch_id, collected_on, amount::text AS amount, status, purpose,
              note, void_reason, voided_at, voided_by, created_by, created_at, routed_at, routed_by
         FROM collections`,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const c of data.collections) {
      const row = byId.get(c.id);
      expect(row, c.id).toBeDefined();
      expect(row).toMatchObject({
        report_id: c.reportId,
        branch_id: branchId(c.branchKey),
        collected_on: c.collectedOn,
        amount: c.amount,
        status: c.status,
        purpose: c.purpose,
        note: c.note,
        void_reason: c.voidReason,
        created_by: userId(c.createdByKey),
      });
      expect(row.created_at.toISOString()).toBe(c.createdAt);
      expect(row.voided_at?.toISOString() ?? null).toBe(c.voidedAt);
      expect(row.voided_by).toBe(c.status === 'voided' ? userId(c.createdByKey) : null);
      expect(row.routed_at?.toISOString() ?? null).toBe(c.routedAt);
      expect(row.routed_by).toBe(c.routedByKey ? userId(c.routedByKey) : null);
    }
  });

  it('gives reports their final status, frozen totals and resolved actors', async () => {
    const { rows } = await testPool().query(
      `SELECT id, branch_id, week_start, status, total_amount::text AS total_amount,
              collection_count, submitted_by, submitted_at, reviewed_by, reviewed_at, version
         FROM weekly_reports`,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const report of data.reports) {
      const row = byId.get(report.id);
      expect(row, report.id).toBeDefined();
      expect(row).toMatchObject({
        branch_id: branchId(report.branchKey),
        week_start: report.weekStart,
        status: report.status,
      });
      const submits = report.history.filter(
        (h) => h.event === 'submitted' || h.event === 'resubmitted',
      );
      const reviews = report.history.filter(
        (h) => h.event === 'returned' || h.event === 'approved',
      );
      const lastSubmit = submits.at(-1);
      const lastReview = reviews.at(-1);
      expect(row.version).toBe(report.history.length);
      if (!lastSubmit) {
        expect(row).toMatchObject({
          total_amount: null,
          collection_count: null,
          submitted_by: null,
        });
      } else {
        // frozen at the last submission: collections not voided by then
        const frozen = data.collections.filter(
          (c) =>
            c.reportId === report.id &&
            (c.status === 'active' || Date.parse(c.voidedAt) > Date.parse(lastSubmit.at)),
        );
        let minor = 0n;
        for (const c of frozen) minor += BigInt(c.amount.replace('.', ''));
        const amount = `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
        expect(row.total_amount, report.id).toBe(amount);
        expect(row.collection_count).toBe(frozen.length);
        expect(row.submitted_by).toBe(userId(lastSubmit.actorKey));
        expect(row.submitted_at.toISOString()).toBe(lastSubmit.at);
      }
      expect(row.reviewed_by).toBe(lastReview ? userId(lastReview.actorKey) : null);
      expect(row.reviewed_at?.toISOString() ?? null).toBe(lastReview?.at ?? null);
    }
  });

  it('allocates branch and member codes from their sequences and links accepted applications', async () => {
    const pool = testPool();
    const { rows: branches } = await pool.query('SELECT code FROM branches');
    for (const b of branches) expect(b.code).toMatch(/^BR\d{3,}$/);
    expect(new Set(branches.map((b) => b.code)).size).toBe(branches.length);

    const { rows: members } = await pool.query(
      'SELECT id, member_code, application_id, phone, team_id FROM members',
    );
    for (const m of members) expect(m.member_code).toMatch(/^M\d{5,}$/);
    expect(new Set(members.map((m) => m.member_code)).size).toBe(members.length);

    const accepted = data.applications.filter((a) => a.status === 'accepted');
    expect(accepted.length).toBeGreaterThan(0);
    for (const app of accepted) {
      const linked = data.members.find((m) => m.applicationId === app.id);
      expect(linked, app.id).toBeDefined();
      expect(members.find((m) => m.id === linked.id).application_id).toBe(app.id);
    }
    // phones are stored the way the app stores them
    for (const m of members) if (m.phone !== null) expect(m.phone).toMatch(/^\+923\d{9}$/);
    const { rows: apps } = await pool.query('SELECT phone FROM applications');
    for (const a of apps) if (a.phone !== null) expect(a.phone).toMatch(/^\+923\d{9}$/);
  });

  it('reproduces the KPI figures in expected.json from raw SQL', async () => {
    const pool = testPool();
    const { rows } = await pool.query(
      `SELECT ${kpiColumns()},
              coalesce(sum(c.amount) FILTER (WHERE c.status = 'voided'), 0)::numeric(14,2)::text AS voided_amount,
              (count(c.id) FILTER (WHERE c.status = 'voided'))::int AS voided_count
         FROM collections c JOIN weekly_reports r ON r.id = c.report_id`,
    );
    const { rows: counts } = await pool.query(
      `SELECT (SELECT count(*)::int FROM branches WHERE status = 'active') AS active_branches,
              (SELECT count(*)::int FROM weekly_reports WHERE status = 'submitted') AS reports_awaiting_review`,
    );
    expect({ ...kpiObject(rows[0]), ...counts[0] }).toEqual(expected.kpis);
    expect({ amount: rows[0].voided_amount, count: rows[0].voided_count }).toEqual(expected.voided);

    const { rows: statuses } = await pool.query(
      'SELECT status, count(*)::int AS n FROM weekly_reports GROUP BY status',
    );
    expect(Object.fromEntries(statuses.map((s) => [s.status, s.n]))).toEqual(
      expected.reportsByStatus,
    );
  });

  it('reproduces the per-branch and per-month figures', async () => {
    const pool = testPool();
    const { rows: branches } = await pool.query(
      `SELECT b.name, ${kpiColumns()}
         FROM branches b
         LEFT JOIN collections c ON c.branch_id = b.id
         LEFT JOIN weekly_reports r ON r.id = c.report_id
        WHERE b.name = ANY($1::text[])
        GROUP BY b.name`,
      [data.branches.map((b) => b.name)],
    );
    expect(Object.fromEntries(branches.map((b) => [b.name, kpiObject(b)]))).toEqual(
      expected.byBranch,
    );

    // collected_on is already a PKT business date, so its month is the PKT month
    const { rows: months } = await pool.query(
      `SELECT to_char(c.collected_on, 'YYYY-MM') AS month, ${kpiColumns()}
         FROM collections c JOIN weekly_reports r ON r.id = c.report_id
        GROUP BY 1
       HAVING count(c.id) FILTER (WHERE c.status = 'active') > 0`,
    );
    expect(Object.fromEntries(months.map((m) => [m.month, kpiObject(m)]))).toEqual(
      expected.byMonth,
    );

    const { rows: approved } = await pool.query(
      `SELECT r.id, coalesce(sum(c.amount) FILTER (WHERE c.status = 'active'), 0)::numeric(14,2)::text AS amount,
              (count(c.id) FILTER (WHERE c.status = 'active'))::int AS count,
              r.total_amount::text AS frozen, r.collection_count AS frozen_count
         FROM weekly_reports r LEFT JOIN collections c ON c.report_id = r.id
        WHERE r.status = 'approved' GROUP BY r.id`,
    );
    const byId = new Map(approved.map((r) => [r.id, r]));
    expect(approved).toHaveLength(expected.approvedReports.length);
    for (const exp of expected.approvedReports) {
      const row = byId.get(exp.reportId);
      expect(row, exp.reportId).toMatchObject({
        amount: exp.amount,
        count: exp.count,
        frozen: exp.amount,
        frozen_count: exp.count,
      });
    }
  });

  it('records each report history as report_events and audit rows in time order', async () => {
    const pool = testPool();
    const report =
      data.reports.find(
        (r) =>
          r.history.map((h) => h.event).join(',') === 'submitted,returned,resubmitted,approved' &&
          data.collections.some((c) => c.reportId === r.id && c.status === 'voided'),
      ) ??
      data.reports.find(
        (r) =>
          r.history.map((h) => h.event).join(',') === 'submitted,returned,resubmitted,approved',
      );
    expect(report).toBeDefined();

    const { rows: events } = await pool.query(
      `SELECT event_type, from_status, to_status, actor_id, reason, occurred_at
         FROM report_events WHERE report_id = $1 ORDER BY id`,
      [report.id],
    );
    expect(events.map((e) => e.event_type)).toEqual([
      'submitted',
      'returned',
      'resubmitted',
      'approved',
    ]);
    report.history.forEach((h, i) => {
      expect(events[i].occurred_at.toISOString()).toBe(h.at);
      expect(events[i].actor_id).toBe(userId(h.actorKey));
      expect(events[i].reason).toBe(h.reason ?? null);
    });
    expect(events.map((e) => `${e.from_status}>${e.to_status}`)).toEqual([
      'draft>submitted',
      'submitted>returned',
      'returned>submitted',
      'submitted>approved',
    ]);

    const { rows: trail } = await pool.query(
      `SELECT action, actor_id, branch_id, report_id, occurred_at, before, after
         FROM audit_events WHERE report_id = $1 ORDER BY occurred_at, id`,
      [report.id],
    );
    // expected trail, built from the data files with the lock rule applied at void time
    const cols = data.collections
      .filter((c) => c.reportId === report.id)
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const timeline = [
      ...cols.map((c) => ({ at: c.createdAt, action: 'collection.create' })),
      ...report.history.map((h) => ({ at: h.at, action: REPORT_ACTION[h.event], event: h.event })),
    ];
    for (const c of cols.filter((x) => x.status === 'voided')) {
      const returnedAt = report.history
        .filter((h) => Date.parse(h.at) < Date.parse(c.voidedAt))
        .at(-1);
      const locked = pktDate(c.voidedAt) > addDays(c.collectedOn, 7);
      timeline.push({
        at: c.voidedAt,
        action:
          locked && returnedAt?.event === 'returned' ? 'collection.void_exempt' : 'collection.void',
      });
    }
    timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    expect(trail.map((t) => t.action)).toEqual([
      'report.create_draft',
      ...timeline.map((t) => t.action),
    ]);
    expect(trail[0].occurred_at.toISOString()).toBe(
      cols[0]?.createdAt ?? trail[0].occurred_at.toISOString(),
    );
    expect(trail[0].after).toEqual({ status: 'draft', week_start: report.weekStart });
    for (const row of trail) {
      expect(row.branch_id).toBe(branchId(report.branchKey));
      expect(row.actor_id).not.toBeNull();
    }
    const reportRows = trail.filter(
      (t) => t.action.startsWith('report.') && t.action !== 'report.create_draft',
    );
    expect(reportRows.map((r) => r.occurred_at.toISOString())).toEqual(
      report.history.map((h) => h.at),
    );
    // changed fields only: the return does not repeat the frozen totals
    expect(reportRows[1].after).toEqual({
      status: 'returned',
      return_reason: report.history[1].reason,
      version: 2,
    });
    expect(reportRows[3].after).toEqual({ status: 'approved', version: 4 });
    expect(reportRows[0].after).toMatchObject({ status: 'submitted', version: 1 });
  });

  it('audits every collection and report action with branch and report ids', async () => {
    const { rows } = await testPool().query(
      `SELECT action, count(*)::int AS n,
              count(*) FILTER (WHERE branch_id IS NULL OR report_id IS NULL)::int AS missing
         FROM audit_events WHERE request_id = 'seed:demo-data'
          AND (action LIKE 'collection.%' OR action LIKE 'report.%')
        GROUP BY action`,
    );
    const counts = Object.fromEntries(rows.map((r) => [r.action, r.n]));
    for (const r of rows) expect(r.missing, r.action).toBe(0);
    const voided = data.collections.filter((c) => c.status === 'voided').length;
    expect(counts['collection.create']).toBe(data.collections.length);
    expect((counts['collection.void'] ?? 0) + (counts['collection.void_exempt'] ?? 0)).toBe(voided);
    expect(counts['report.create_draft']).toBe(data.reports.length);
    const events = data.reports.flatMap((r) => r.history.map((h) => REPORT_ACTION[h.event]));
    for (const action of Object.values(REPORT_ACTION)) {
      expect(counts[action] ?? 0, action).toBe(events.filter((a) => a === action).length);
    }
  });

  it('writes allowlisted audit fields only and never contact details or secrets', async () => {
    const { rows } = await testPool().query(
      `SELECT action, entity_type, before, after FROM audit_events WHERE request_id LIKE 'seed:%'`,
    );
    const forbidden = ['password_hash', 'email', 'phone', 'message', 'note'];
    for (const row of rows) {
      const allowed = AUDIT_FIELD_ALLOWLIST[row.entity_type];
      expect(allowed, row.entity_type).toBeDefined();
      for (const snap of [row.before, row.after]) {
        if (!snap) continue;
        for (const key of Object.keys(snap)) {
          expect(forbidden, `${row.action} ${key}`).not.toContain(key);
          expect(allowed, `${row.action} ${key}`).toContain(key);
        }
      }
      expect(JSON.stringify(row)).not.toMatch(/\$argon2/);
    }
    const { rows: inserted } = await testPool().query(
      `SELECT action, entity_type, count(*)::int AS n FROM audit_events
        WHERE request_id = 'seed:demo-data' AND action IN ('seed.created', 'branch.create')
        GROUP BY 1, 2`,
    );
    expect(Object.fromEntries(inserted.map((r) => [`${r.action}:${r.entity_type}`, r.n]))).toEqual({
      'branch.create:branch': data.branches.filter((b) => !b.adopt).length,
      'seed.created:user': data.users.filter((u) => !u.existing).length,
      'seed.created:team': data.teams.length,
      'seed.created:member': data.members.length,
      'seed.created:application': data.applications.length,
    });
  });

  it('lets an extra demo user log in with SEED_DEMO_PASSWORD', async () => {
    const { rows } = await testPool().query(
      "SELECT password_hash FROM users WHERE email = 'lead.lahore@shiplens.test'",
    );
    expect(await verifyPassword(rows[0].password_hash, PASSWORD)).toBe(true);
  });
});

describe('idempotency and data safety', () => {
  it('changes nothing on a second run', async () => {
    await resetDb();
    await seed();
    const counts = await tableCounts();
    const ids = await maxIds();
    await seed();
    expect(await tableCounts()).toEqual(counts);
    expect(await maxIds()).toEqual(ids);
  }, 60000);

  it('leaves unrelated rows untouched and adds alongside them', async () => {
    await resetDb();
    const pool = testPool();
    const other = await seedBranch(pool, { name: 'Unrelated Branch', status: 'paused' });
    const user = await seedUser(pool, { role: 'branch_lead', branchId: other.id });
    const snapshot = async () =>
      (
        await pool.query(
          `SELECT b.*, u.email, u.name AS user_name, u.password_hash, u.updated_at AS user_updated
             FROM branches b JOIN users u ON u.id = $1 WHERE b.id = $2`,
          [user.id, other.id],
        )
      ).rows[0];
    const before = await snapshot();
    await seed();
    await seed();
    expect(await snapshot()).toEqual(before);
    expect(await tableCounts()).toMatchObject({
      branches: data.branches.length + 1,
      users: data.users.length + 1,
      weekly_reports: data.reports.length,
    });
  }, 60000);
});

describe('preconditions and source rules', () => {
  it('marks exactly the step 01 demo users as existing in users.json', () => {
    const existing = data.users
      .filter((u) => u.existing)
      .map((u) => ({ email: u.email, role: u.role }))
      .sort((a, b) => a.email.localeCompare(b.email));
    expect(existing).toEqual(
      DEMO_USERS.map((u) => ({ email: u.email, role: u.role })).sort((a, b) =>
        a.email.localeCompare(b.email),
      ),
    );
    expect(data.branches.filter((b) => b.adopt).map((b) => b.name)).toEqual([DEMO_BRANCH.name]);
  });

  async function runDirect(prepare) {
    await resetDb();
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await client.query('BEGIN');
      if (prepare) await prepare(client);
      const ctx = Object.freeze({
        env: { SEED_DEMO_PASSWORD: PASSWORD },
        log: quiet,
        hashPassword,
      });
      return await runStep02(client, ctx).then(
        () => null,
        (err) => err,
      );
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  }

  it('fails loudly when step 01 did not create the demo users', async () => {
    const err = await runDirect();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/seed step 01/);
    expect((await tableCounts()).branches).toBe(0);
  });

  it('fails loudly when the sample branch is missing', async () => {
    const err = await runDirect(async (client) => {
      for (const u of DEMO_USERS.filter((x) => !x.branchScoped)) {
        await client.query(
          "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, 'x', $3)",
          [u.email, u.name, u.role],
        );
      }
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain(`"${DEMO_BRANCH.name}" is missing`);
  });

  it('fails loudly when a branch demo user is missing', async () => {
    const err = await runDirect(async (client) => {
      const { rows } = await client.query(
        "INSERT INTO branches (code, name, status) VALUES ('BR-T1', $1, 'active') RETURNING id",
        [DEMO_BRANCH.name],
      );
      for (const u of DEMO_USERS.filter((x) => x.key !== 'hr')) {
        await client.query(
          "INSERT INTO users (email, name, password_hash, role, branch_id) VALUES ($1, $2, 'x', $3, $4)",
          [u.email, u.name, u.role, u.branchScoped ? rows[0].id : null],
        );
      }
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/hr@shiplens\.test is missing/);
  });

  it('never truncates, deletes or imports application code', async () => {
    const source = await readFile(STEP_FILE, 'utf8');
    expect(source).not.toMatch(/\bTRUNCATE\b/);
    expect(source).not.toMatch(/\bDELETE\b/);
    expect(source).not.toMatch(/from\s+['"](\.\.\/)+src/);
    expect(source).not.toMatch(/password_hash['"]?\s*:/);
  });
});

describe('first boot through the migrate hook', () => {
  function migrateProcess() {
    const base = { ...process.env };
    delete base.SEED_ROTATE_DEMO_PASSWORDS;
    return execFileAsync(process.execPath, ['scripts/migrate.mjs'], {
      cwd: ROOT,
      env: {
        ...base,
        DATABASE_URL: connectionString,
        SEED_ON_BOOT: 'true',
        SEED_DEMO_PASSWORD: PASSWORD,
      },
    });
  }

  it('loads the demo data on first boot and a second boot changes nothing', async () => {
    await resetDb();
    const first = await migrateProcess();
    expect(first.stdout).toContain('seed: running 02-demo-data');
    expect(first.stdout).not.toContain(PASSWORD);
    const { rows } = await testPool().query(
      'SELECT name FROM branches WHERE name = ANY($1::text[])',
      [data.branches.map((b) => b.name)],
    );
    expect(rows).toHaveLength(data.branches.length);
    const counts = await tableCounts();
    expect(counts.weekly_reports).toBe(data.reports.length);

    await migrateProcess();
    expect(await tableCounts()).toEqual(counts);
  }, 60000);
});
