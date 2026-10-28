import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(root, 'scripts', 'gen-permissions-doc.mjs');
const committedDoc = path.join(root, 'docs', 'permissions.md');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'perm-doc-'));

function run(...args) {
  try {
    execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: 'pipe' });
    return 0;
  } catch (error) {
    return error.status;
  }
}

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('gen-permissions-doc', () => {
  it('passes --check against the committed doc', () => {
    expect(run('--check')).toBe(0);
  });

  it('fails --check when the doc was edited by hand', () => {
    const copy = path.join(tmp, 'permissions.md');
    copyFileSync(committedDoc, copy);
    expect(run('--check', '--out', copy)).toBe(0);
    writeFileSync(copy, readFileSync(copy, 'utf8') + '\nhand edit\n');
    expect(run('--check', '--out', copy)).toBe(1);
  });

  it('fails --check when the doc is missing', () => {
    expect(run('--check', '--out', path.join(tmp, 'missing.md'))).toBe(1);
  });

  it('writes a doc to --out in default mode', () => {
    const out = path.join(tmp, 'written.md');
    expect(run('--out', out)).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('| report.approve |');
  });
});
