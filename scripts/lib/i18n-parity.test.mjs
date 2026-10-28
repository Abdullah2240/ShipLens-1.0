import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkMessages, extractPlaceholders, inspectMessages, LOCALES } from './i18n-parity.mjs';

const made = [];

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-parity-'));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

const text = (problems) => problems.map((p) => p.message);

describe('LOCALES', () => {
  it('lists en and ur', () => {
    expect(LOCALES).toEqual(['en', 'ur']);
  });
});

describe('extractPlaceholders', () => {
  it('finds simple arguments', () => {
    expect([...extractPlaceholders('Hello {name}, you have {n}')].sort()).toEqual(['n', 'name']);
  });

  it('uses only the top-level argument of plural and select sections', () => {
    const value = '{count, plural, one {# item for {who}} other {# items}}';
    expect([...extractPlaceholders(value)]).toEqual(['count']);
  });

  it('returns an empty set for plain text', () => {
    expect(extractPlaceholders('No arguments here').size).toBe(0);
  });
});

describe('checkMessages', () => {
  it('reports no problems for identical trees', () => {
    const root = fixture({
      'en/common.json': { a: 'A', nested: { b: 'B' } },
      'ur/common.json': { a: 'ا', nested: { b: 'ب' } },
    });
    expect(checkMessages(root)).toEqual([]);
  });

  it('counts keys and files', () => {
    const root = fixture({
      'en/common.json': { a: 'A', nested: { b: 'B' } },
      'ur/common.json': { a: 'ا', nested: { b: 'ب' } },
    });
    const result = inspectMessages(root);
    expect(result.files).toBe(1);
    expect(result.keys).toBe(2);
  });

  it('flags a key missing in ur', () => {
    const root = fixture({
      'en/common.json': { some: { key: 'x' }, other: 'y' },
      'ur/common.json': { other: 'y' },
    });
    expect(text(checkMessages(root))).toEqual(['missing-in-ur: common.some.key']);
  });

  it('flags a key missing in en', () => {
    const root = fixture({
      'en/common.json': { other: 'y' },
      'ur/common.json': { other: 'y', extra: 'z' },
    });
    expect(text(checkMessages(root))).toEqual(['missing-in-en: common.extra']);
  });

  it('treats arrays as leaf values', () => {
    const root = fixture({
      'en/common.json': { list: ['a', 'b'] },
      'ur/common.json': { list: ['ا'] },
    });
    expect(checkMessages(root)).toEqual([]);
  });

  it('flags a module file present in one locale only', () => {
    const root = fixture({
      'en/common.json': {},
      'ur/common.json': {},
      'en/members.json': { a: 'A' },
    });
    const problems = checkMessages(root);
    expect(text(problems)).toEqual(['file-missing: members.json (missing in ur)']);
    expect(problems[0].type).toBe('file-missing');
  });

  it('flags empty and non-string leaves', () => {
    const root = fixture({
      'en/common.json': { a: '', b: 5, c: 'ok' },
      'ur/common.json': { a: 'x', b: 'y', c: 'ok' },
    });
    const messages = text(checkMessages(root)).sort();
    expect(messages).toEqual([
      'empty-or-invalid-value: common.a (en)',
      'empty-or-invalid-value: common.b (en)',
    ]);
  });

  it('flags placeholder mismatches', () => {
    const root = fixture({
      'en/common.json': { greet: 'Hello {name}' },
      'ur/common.json': { greet: 'ہیلو' },
    });
    const problems = checkMessages(root);
    expect(problems).toHaveLength(1);
    expect(problems[0].type).toBe('placeholder-mismatch');
    expect(problems[0].message).toContain('common.greet');
  });

  it('accepts matching plural sections with different branches', () => {
    const root = fixture({
      'en/common.json': { n: '{count, plural, one {# item} other {# items}}' },
      'ur/common.json': { n: '{count, plural, other {# آئٹمز}}' },
    });
    expect(checkMessages(root)).toEqual([]);
  });

  it('flags plural sections with different argument names', () => {
    const root = fixture({
      'en/common.json': { n: '{count, plural, other {# items}}' },
      'ur/common.json': { n: '{total, plural, other {# آئٹمز}}' },
    });
    expect(checkMessages(root).map((p) => p.type)).toEqual(['placeholder-mismatch']);
  });

  it('flags invalid JSON and names the file', () => {
    const root = fixture({
      'en/common.json': { a: 'A' },
      'ur/common.json': '{ not json',
    });
    const problems = checkMessages(root);
    expect(problems).toHaveLength(1);
    expect(problems[0].type).toBe('invalid-json');
    expect(problems[0].message).toContain('ur/common.json');
  });

  it('flags a missing locale directory', () => {
    const root = fixture({ 'en/common.json': {} });
    const problems = checkMessages(root);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0].type).toBe('file-missing');
  });
});

describe('real repository messages', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  it('pass the parity check', () => {
    expect(checkMessages(path.join(repoRoot, 'messages'))).toEqual([]);
  });

  it('CLI exits 0 and reports counts on the real tree', () => {
    const out = execFileSync(process.execPath, ['scripts/check-i18n.mjs'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(out).toMatch(/^i18n parity ok \(\d+ keys, \d+ files\)/);
  });

  it('CLI exits 1 with one line per problem on a broken copy', () => {
    const root = fixture({
      'en/common.json': { a: 'A', b: 'B' },
      'ur/common.json': { a: 'ا' },
      'en/members.json': { x: 'X' },
    });
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'check-i18n.mjs'), root],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    const lines = result.stdout.split('\n').filter(Boolean);
    expect(lines).toContain('missing-in-ur: common.b');
    expect(lines.some((l) => l.startsWith('file-missing: members.json'))).toBe(true);
    expect(lines).toHaveLength(2);
  });
});
