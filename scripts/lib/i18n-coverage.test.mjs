import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { findUntranslated, residualLatin } from './i18n-coverage.mjs';

const made = [];

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-coverage-'));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(content));
  }
  return root;
}

afterEach(() => {
  while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
});

const allowlist = { tokens: ['ShipLens', 'PKR', 'CSV'], keys: [], files: [] };

function pair(en, ur, extra = {}) {
  return fixture({ 'en/reports.json': en, 'ur/reports.json': ur, ...extra });
}

describe('findUntranslated', () => {
  it('flags an Urdu value that is a copy of the English value', () => {
    const root = pair({ status: { approved: 'Approved' } }, { status: { approved: 'Approved' } });
    expect(findUntranslated(root, { allowlist })).toEqual([
      {
        namespace: 'reports',
        key: 'status.approved',
        en: 'Approved',
        ur: 'Approved',
        reason: 'identical',
      },
    ]);
  });

  it('flags Latin-only Urdu text that differs from English', () => {
    const root = pair({ total: 'Total: {amount}' }, { total: 'Total: {amount}.' });
    expect(findUntranslated(root, { allowlist })).toEqual([
      {
        namespace: 'reports',
        key: 'total',
        en: 'Total: {amount}',
        ur: 'Total: {amount}.',
        reason: 'no-urdu-script',
      },
    ]);
  });

  it('reports a Latin-only value as no-urdu-script when it differs from English', () => {
    const root = pair({ total: 'Total: {amount} rupees' }, { total: 'Total: {amount}' });
    expect(findUntranslated(root, { allowlist })[0].reason).toBe('no-urdu-script');
  });

  it('passes Urdu script, bare placeholders, digits and punctuation', () => {
    const root = pair(
      { a: 'Approved', b: '{count}', c: '{from} – {to}', d: '1 / 2', e: '{count, number}' },
      { a: 'منظور شدہ', b: '{count}', c: '{from} – {to}', d: '1 / 2', e: '{count, number}' },
    );
    expect(findUntranslated(root, { allowlist })).toEqual([]);
  });

  it('passes allowlisted tokens next to placeholders', () => {
    const root = pair(
      { amount: 'PKR {amount}', brand: 'ShipLens', file: 'CSV' },
      { amount: 'PKR {amount}', brand: 'ShipLens', file: 'CSV' },
    );
    expect(findUntranslated(root, { allowlist })).toEqual([]);
  });

  it('still flags an allowlisted token followed by English words', () => {
    const root = pair({ x: 'Download CSV' }, { x: 'Download CSV' });
    expect(findUntranslated(root, { allowlist })).toHaveLength(1);
  });

  it('ignores ICU plural selectors and argument names but not branch text', () => {
    const root = pair(
      {
        n: '{count, plural, one {# item} other {# items}}',
        m: '{count, plural, one {# item} other {# items}}',
      },
      {
        n: '{count, plural, one {# چیز} other {# چیزیں}}',
        m: '{count, plural, one {# item} other {# items}}',
      },
    );
    expect(findUntranslated(root, { allowlist }).map((f) => f.key)).toEqual(['m']);
  });

  it('ignores rich-text tag names', () => {
    const root = pair({ x: 'Read <link>more</link>' }, { x: '<link>مزید</link> پڑھیں' });
    expect(findUntranslated(root, { allowlist })).toEqual([]);
  });

  it('passes allowlisted keys', () => {
    const root = pair({ code: 'BR001', other: 'Open' }, { code: 'BR001', other: 'Open' });
    const found = findUntranslated(root, { allowlist: { ...allowlist, keys: ['reports.code'] } });
    expect(found.map((f) => f.key)).toEqual(['other']);
  });

  it('ignores skipped namespaces', () => {
    const root = pair(
      { a: 'منظور' },
      { a: 'منظور' },
      {
        'en/public.json': { title: 'Home' },
        'ur/public.json': { title: 'Home' },
      },
    );
    expect(findUntranslated(root, { allowlist, skipNamespaces: ['public'] })).toEqual([]);
    expect(findUntranslated(root, { allowlist }).map((f) => f.namespace)).toEqual(['public']);
  });

  it('checks string items inside arrays', () => {
    const root = pair({ list: ['One', 'Two'] }, { list: ['ایک', 'Two'] });
    expect(findUntranslated(root, { allowlist }).map((f) => f.key)).toEqual(['list.1']);
  });

  it('skips keys missing on the Urdu side (the parity check reports those)', () => {
    const root = pair({ a: 'A', b: 'B' }, { a: 'ا' });
    expect(findUntranslated(root, { allowlist })).toEqual([]);
  });
});

describe('residualLatin', () => {
  it('removes placeholders, selectors, tags and tokens', () => {
    expect(
      residualLatin('{n, plural, one {# فائل} other {# فائلیں}} <b>CSV</b>', ['CSV']).trim(),
    ).toBe('');
  });

  it('keeps words around a placeholder', () => {
    expect(residualLatin('Hello {name}', [])).toMatch(/Hello/);
  });
});

describe('check-i18n CLI', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const cli = path.join(repoRoot, 'scripts', 'check-i18n.mjs');

  function run(messages, sources) {
    const msgRoot = fixture(messages);
    const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-src-'));
    made.push(srcRoot);
    for (const [rel, text] of Object.entries(sources)) {
      const target = path.join(srcRoot, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    }
    return spawnSync(process.execPath, [cli, msgRoot, srcRoot], { encoding: 'utf8' });
  }

  it('exits 0 and prints the parity line first when clean', () => {
    const result = run(
      { 'en/common.json': { a: 'Save' }, 'ur/common.json': { a: 'محفوظ کریں' } },
      { 'app/page.tsx': "export const P = ({ t }) => <p>{t('a')}</p>;\n" },
    );
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n').filter(Boolean);
    expect(lines[0]).toBe('i18n parity ok (1 keys, 1 files)');
    expect(lines[1]).toMatch(/^i18n coverage ok \(1 files scanned\)$/);
  });

  it('exits 1 with findings grouped by namespace and file', () => {
    const result = run(
      { 'en/common.json': { a: 'Save', b: 'Open' }, 'ur/common.json': { a: 'Save', b: 'کھولیں' } },
      {
        'app/page.tsx': 'export const P = () => <p>Hello</p>;\n',
        'components/public/Home.tsx': 'export const H = () => <p>Skipped</p>;\n',
      },
    );
    expect(result.status).toBe(1);
    const out = result.stdout;
    expect(out).toContain('untranslated: common (1)');
    expect(out).toContain('  common.a [identical] "Save"');
    expect(out).toMatch(/hard-coded text: .*app\/page\.tsx \(1\)/);
    expect(out).toContain('  1 [jsx-text] "Hello"');
    expect(out).not.toContain('Skipped');
    expect(result.stderr).toContain(
      'i18n coverage failed (1 untranslated values, 1 hard-coded texts)',
    );
  });

  it('stops after parity problems without running the scanners', () => {
    const result = run(
      { 'en/common.json': { a: 'Save', b: 'B' }, 'ur/common.json': { a: 'Save' } },
      {},
    );
    expect(result.status).toBe(1);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual(['missing-in-ur: common.b']);
  });
});
