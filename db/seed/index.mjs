// Seed runner. Plain ESM that runs in the slim runtime image, so it imports only Node
// built-ins, `pg`, files under db/seed/ and scripts/lib/password.mjs (see README.md).
//
// Steps are the `*.mjs` files in db/seed/steps/, run in filename order inside ONE
// transaction: a step that throws rolls back everything this run wrote. Every step must
// be idempotent (look up first, insert only what is missing) and must never truncate or
// remove rows.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { hashPassword } from '../../scripts/lib/password.mjs';

// Different from the migrator's key (727274): the boot hook calls the seed right after
// migrating, and a separate key can never deadlock against the migrator's session.
// Different from the audit chain trigger's key (727275) too: sharing it would make every
// audited write of a running instance wait for the whole seed.
const SEED_LOCK_KEY = 727276;
const MIN_PASSWORD_LENGTH = 12;
const DEFAULT_STEPS_DIR = new URL('./steps/', import.meta.url);

function toDirPath(dir) {
  return dir instanceof URL ? fileURLToPath(dir) : path.resolve(String(dir));
}

/** Throws a message that names the variable only, never its value. */
function assertPassword(env) {
  const value = env.SEED_DEMO_PASSWORD;
  if (typeof value !== 'string' || value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `SEED_DEMO_PASSWORD must be set to at least ${MIN_PASSWORD_LENGTH} characters to run the seed`,
    );
  }
}

async function loadSteps(dirPath) {
  const files = (await readdir(dirPath))
    .filter((f) => f.endsWith('.mjs') && !f.includes('.test.'))
    .sort();
  const steps = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(dirPath, file)).href);
    if (typeof mod.name !== 'string' || mod.name === '' || typeof mod.run !== 'function') {
      throw new Error(
        `Seed step ${file} must export a string \`name\` and an async \`run(client, ctx)\``,
      );
    }
    steps.push({ name: mod.name, run: mod.run });
  }
  return steps;
}

/**
 * Run every seed step once, in order, in a single transaction.
 * @param {{ connectionString: string, env?: Record<string, string | undefined>,
 *   log?: (msg: string) => void, stepsDir?: string | URL }} options
 * @returns {Promise<{ steps: string[] }>} the names of the steps that ran
 */
export async function runSeed({
  connectionString,
  env = process.env,
  log = console.log,
  stepsDir = DEFAULT_STEPS_DIR,
}) {
  if (!connectionString) throw new Error('runSeed requires a connectionString');
  assertPassword(env);
  const steps = await loadSteps(toDirPath(stepsDir));
  const ctx = Object.freeze({ env, log, hashPassword });

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SEED_LOCK_KEY]);
    try {
      await client.query('BEGIN');
      for (const step of steps) {
        log(`seed: running ${step.name}`);
        await step.run(client, ctx);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
    log(`seed: done (${steps.length} step${steps.length === 1 ? '' : 's'})`);
    return { steps: steps.map((s) => s.name) };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

export default runSeed;
