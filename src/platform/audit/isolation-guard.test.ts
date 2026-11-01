// Permanent guard for the audit chain trigger (db/migrations/202610311400_audit_chain.sql):
// its head lookup takes a fresh snapshot after the chain lock, which only works at READ
// COMMITTED. A writing transaction at REPEATABLE READ or SERIALIZABLE can read a stale head
// and fail on the chain_seq unique index whenever another audited write commits first. So
// every stronger isolation level in application code must be a READ ONLY transaction, which
// can never insert an audit event.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(import.meta.dirname, '../../..');
const SKIPPED_DIRS = new Set(['node_modules', '.next']);
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /\.test\.[cm]?[jt]sx?$/;
const STRONGER = /ISOLATION\s+LEVEL\s+(?:REPEATABLE\s+READ|SERIALIZABLE)/i;

const rel = (file: string) => path.relative(REPO, file).split(path.sep).join('/');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : walk(full);
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [full] : [];
  });
}

/** Each quoted SQL string in the text that asks for a stronger isolation level without READ ONLY. */
function writableStrongIsolation(text: string): string[] {
  const literals = text.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [];
  return literals.filter((literal) => STRONGER.test(literal) && !/\bREAD\s+ONLY\b/i.test(literal));
}

describe('transaction isolation in application code', () => {
  it('rejects a writable repeatable read or serializable transaction', () => {
    expect(
      writableStrongIsolation("tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')"),
    ).toHaveLength(1);
    expect(writableStrongIsolation('c.query(`BEGIN ISOLATION LEVEL SERIALIZABLE`)')).toHaveLength(
      1,
    );
    expect(
      writableStrongIsolation(
        "c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')",
      ),
    ).toEqual([]);
    expect(writableStrongIsolation('// runs in one READ ONLY REPEATABLE READ snapshot')).toEqual(
      [],
    );
  });

  it('uses repeatable read or serializable only in read-only transactions', () => {
    const offenders = walk(path.join(REPO, 'src')).flatMap((file) =>
      writableStrongIsolation(readFileSync(file, 'utf8')).map((sql) => `${rel(file)}: ${sql}`),
    );
    expect(offenders).toEqual([]);
  });
});
