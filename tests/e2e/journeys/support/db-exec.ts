import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from '../../support/fixtures';

// SQL against the E2E stack's database, for host runs only. compose.e2e.yaml gives the
// database no host port and the runner image has no Postgres client, so the statement goes
// through `docker compose exec` into the db service. Arguments are passed as an array (no
// shell), psql stops at the first error, and output is unaligned tuples only. Nothing here
// logs the statement or the connection.

/** Set E2E_DB_EXEC=1 on a host run to allow specs to change the E2E database. */
export const DB_EXEC_ENABLED = process.env.E2E_DB_EXEC === '1';

function repoRoot(): string {
  const config = test.info().config.configFile;
  return config ? path.dirname(config) : process.cwd();
}

/** Runs `sql` in the E2E database and returns psql's trimmed output; throws on any error. */
export function dbExec(sql: string): string {
  if (!DB_EXEC_ENABLED) throw new Error('dbExec needs E2E_DB_EXEC=1 (host runs only)');
  const project = process.env.E2E_PROJECT || 'shiplens-e2e';
  const args = [
    'compose',
    '-p',
    project,
    '-f',
    'compose.e2e.yaml',
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    'shiplens',
    '-d',
    'shiplens_e2e',
    '-v',
    'ON_ERROR_STOP=1',
    '-At',
    '-c',
    sql,
  ];
  try {
    return execFileSync('docker', args, {
      cwd: repoRoot(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string | Buffer }).stderr?.toString().trim();
    throw new Error(`E2E database command failed: ${stderr || (error as Error).message}`);
  }
}

/** SQL string literal: single quotes doubled, wrapped in quotes. */
export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
