// Seed step 01: the sample branch and the five demo role users.
//
// Idempotent: the branch is looked up by name and each user by lower(email); only what
// is missing is inserted, with ON CONFLICT DO NOTHING as a second safety net. Existing
// rows are never changed, except that SEED_ROTATE_DEMO_PASSWORDS=true re-hashes the
// password of the five demo emails (recovery when the deployed password was wrong).
import { DEMO_BRANCH, DEMO_USERS } from '../demo-users.mjs';

export const name = '01-demo-branch-and-users';

// Copy of ID_FORMATS.branchCode in src/platform/config/constants.ts (plain ESM cannot
// import TypeScript). Keep the two in step.
const BRANCH_CODE = Object.freeze({ prefix: 'BR', digits: 3 });
// Copy of ID_FORMATS.memberId, for later seed steps that create members.
export const MEMBER_ID = Object.freeze({ prefix: 'M', digits: 5 });

const REQUEST_ID = 'seed:demo-users';
const MAX_CODE_ATTEMPTS = 20;

/** @param {string | number | bigint} n */
export function formatBranchCode(n) {
  return BRANCH_CODE.prefix + String(n).padStart(BRANCH_CODE.digits, '0');
}

async function audit(client, { action, entityType, entityId, branchId, after }) {
  await client.query(
    `INSERT INTO audit_events (request_id, actor_id, actor_role, action, entity_type, entity_id, branch_id, after)
     VALUES ($1, NULL, 'system', $2, $3, $4, $5, $6)`,
    [
      REQUEST_ID,
      action,
      entityType,
      entityId,
      branchId,
      after === null ? null : JSON.stringify(after),
    ],
  );
}

async function ensureBranch(client, log) {
  const found = await client.query(
    'SELECT id, code FROM branches WHERE name = $1 ORDER BY created_at, id LIMIT 1',
    [DEMO_BRANCH.name],
  );
  if (found.rows[0]) return found.rows[0].id;

  // nextval is only called when the branch is missing, so a no-op run consumes nothing.
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const { rows: seq } = await client.query("SELECT nextval('branch_code_seq')::text AS n");
    const code = formatBranchCode(seq[0].n);
    const inserted = await client.query(
      `INSERT INTO branches (code, name, city, status) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING RETURNING id, code, name, city, status, summary`,
      [code, DEMO_BRANCH.name, DEMO_BRANCH.city, DEMO_BRANCH.status],
    );
    const row = inserted.rows[0];
    if (!row) continue; // code already taken by a row not created from the sequence
    await audit(client, {
      action: 'seed.created',
      entityType: 'branch',
      entityId: row.id,
      branchId: row.id,
      after: {
        code: row.code,
        name: row.name,
        city: row.city,
        status: row.status,
        summary: row.summary,
      },
    });
    log(`seed: created branch ${row.code} "${row.name}"`);
    return row.id;
  }
  throw new Error(`Could not allocate a free branch code after ${MAX_CODE_ATTEMPTS} attempts`);
}

async function ensureUser(client, ctx, user, branchId) {
  const found = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [
    user.email,
  ]);
  if (found.rows[0]) return { id: found.rows[0].id, created: false };

  const hash = await ctx.hashPassword(ctx.env.SEED_DEMO_PASSWORD);
  const inserted = await client.query(
    `INSERT INTO users (email, name, password_hash, role, branch_id) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING id, name, role, branch_id`,
    [user.email, user.name, hash, user.role, branchId],
  );
  const row = inserted.rows[0];
  if (!row) return { id: null, created: false };
  await audit(client, {
    action: 'seed.created',
    entityType: 'user',
    entityId: row.id,
    branchId: row.branch_id,
    after: { role: row.role, branch_id: row.branch_id, name: row.name },
  });
  ctx.log(`seed: created user ${user.email} (${user.role})`);
  return { id: row.id, created: true };
}

async function rotatePassword(client, ctx, user) {
  const hash = await ctx.hashPassword(ctx.env.SEED_DEMO_PASSWORD);
  const updated = await client.query(
    `UPDATE users SET password_hash = $2, updated_at = now() WHERE lower(email) = lower($1)
     RETURNING id, branch_id`,
    [user.email, hash],
  );
  const row = updated.rows[0];
  if (!row) return;
  await audit(client, {
    action: 'seed.password_rotated',
    entityType: 'user',
    entityId: row.id,
    branchId: row.branch_id,
    after: null,
  });
  ctx.log(`seed: rotated password for ${user.email}`);
}

/**
 * @param {import('pg').ClientBase} client inside the seed transaction
 * @param {{ env: Record<string, string | undefined>, log: (msg: string) => void,
 *   hashPassword: (plain: string) => Promise<string> }} ctx
 */
export async function run(client, ctx) {
  const branchId = await ensureBranch(client, ctx.log);
  const rotate = ctx.env.SEED_ROTATE_DEMO_PASSWORDS === 'true';
  let created = 0;
  for (const user of DEMO_USERS) {
    const result = await ensureUser(client, ctx, user, user.branchScoped ? branchId : null);
    if (result.created) created += 1;
    else if (rotate) await rotatePassword(client, ctx, user);
  }
  if (created === 0 && !rotate) ctx.log('seed: demo branch and users already present');
}
