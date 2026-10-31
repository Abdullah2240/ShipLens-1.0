// Migration runner. Plain ESM importing only `pg` and Node built-ins so it runs in the
// slim runtime image without a TypeScript build.
//
// Behaviour: one connection, a session-level advisory lock so concurrent runners
// serialise, one transaction per file, a sha256 checksum recorded per applied file,
// and a hard failure if an applied file has changed since it was applied.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const LOCK_KEY = 727274;
const DEFAULT_DIR = new URL('../db/migrations/', import.meta.url);

function toDirPath(dir) {
  if (dir instanceof URL) return fileURLToPath(dir);
  return path.resolve(String(dir));
}

/**
 * Apply every pending `*.sql` file in `dir`, in filename order.
 * @param {{ connectionString: string, dir?: string | URL, log?: (msg: string) => void }} options
 * @returns {Promise<string[]>} names of the files applied by this call
 */
export async function runMigrations({ connectionString, dir = DEFAULT_DIR, log = () => {} }) {
  if (!connectionString) throw new Error('runMigrations requires a connectionString');
  const dirPath = toDirPath(dir);
  const files = (await readdir(dirPath)).filter((f) => f.endsWith('.sql')).sort();

  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query('SELECT name, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.name, r.checksum]));
    const newestApplied = [...done.keys()].sort().at(-1);

    for (const name of files) {
      const sql = await readFile(path.join(dirPath, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (done.has(name)) {
        if (done.get(name) !== checksum) {
          throw new Error(`Migration ${name} was modified after being applied`);
        }
        continue;
      }
      if (newestApplied && name < newestApplied) {
        log(`note: ${name} is older than the newest applied migration (${newestApplied}); applying anyway`);
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
      applied.push(name);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
  return applied;
}

async function runSeedIfRequested(connectionString) {
  if (process.env.SEED_ON_BOOT !== 'true') return;
  const seedFile = new URL('../db/seed/index.mjs', import.meta.url);
  // Skip only when the module file is absent; errors from the seed itself propagate.
  if (!existsSync(fileURLToPath(seedFile))) {
    console.log('SEED_ON_BOOT is true but db/seed/index.mjs does not exist; skipping seed');
    return;
  }
  const mod = await import(seedFile.href);
  const run = mod.runSeed ?? mod.default;
  if (typeof run !== 'function') {
    throw new Error('db/seed/index.mjs must export runSeed() or a default function');
  }
  await run({ connectionString });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const applied = await runMigrations({ connectionString, log: (m) => console.log(m) });
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations');
  await runSeedIfRequested(connectionString);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
