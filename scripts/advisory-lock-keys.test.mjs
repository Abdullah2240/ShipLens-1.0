import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_CHAIN_LOCK_KEY } from '../src/platform/audit/chain/types.ts';

// Three advisory locks guard three different things: the migrator (one runner at a time),
// the seed (one boot seeds at a time) and the audit chain trigger (one audit insert at a
// time). Sharing a key would make every audited write wait for a running seed, and could
// deadlock a seed against a writer it waits on.
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

function constant(rel, name) {
  const match = new RegExp(`const ${name} = (\\d+);`).exec(read(rel));
  if (!match) throw new Error(`${name} not found in ${rel}`);
  return Number(match[1]);
}

function triggerKeys() {
  const dir = path.join(root, 'db', 'migrations');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .flatMap((f) =>
      [
        ...readFileSync(path.join(dir, f), 'utf8').matchAll(
          /PERFORM pg_advisory_xact_lock\((\d+)\)/g,
        ),
      ].map((m) => Number(m[1])),
    );
}

describe('advisory lock keys', () => {
  const migrator = constant('scripts/migrate.mjs', 'LOCK_KEY');
  const seed = constant('db/seed/index.mjs', 'SEED_LOCK_KEY');

  it('gives the migrator, the seed and the audit chain a key each', () => {
    expect(new Set([migrator, seed, AUDIT_CHAIN_LOCK_KEY]).size).toBe(3);
  });

  it('takes the audit chain key in the chain trigger', () => {
    expect(triggerKeys()).toEqual([AUDIT_CHAIN_LOCK_KEY]);
  });
});
