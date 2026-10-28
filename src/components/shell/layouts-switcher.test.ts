import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findPhysicalDirection } from '../../../scripts/lib/logical-css.mjs';

// Guards the "language switch on every page" rule: a bare route-group layout, a
// not-found or error page without a shell, or a shell that drops the switcher fails here.

const ROOT = path.resolve(import.meta.dirname, '../..');
const LOCALE_DIR = path.join(ROOT, 'app', '[locale]');
const SHELL_DIR = import.meta.dirname;
const SHELL_NAMES = ['AppShell', 'PublicShell', 'MinimalShell'] as const;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file: string) => readFileSync(file, 'utf8');
const usesAnyShell = (source: string) =>
  SHELL_NAMES.some((name) => new RegExp(`<${name}[\\s>]`).test(source));

describe('language switcher on every page type', () => {
  const rootLayout = path.join(LOCALE_DIR, 'layout.tsx');
  const layouts = walk(LOCALE_DIR).filter(
    (file) => path.basename(file) === 'layout.tsx' && file !== rootLayout,
  );

  it('finds the route-group layouts', () => {
    const names = layouts.map(rel);
    expect(names).toEqual(
      expect.arrayContaining([
        'app/[locale]/(app)/layout.tsx',
        'app/[locale]/(auth)/layout.tsx',
        'app/[locale]/(public)/layout.tsx',
      ]),
    );
  });

  it.each(layouts.map((file) => [rel(file), file]))('%s renders a shell', (_name, file) => {
    expect(usesAnyShell(read(file as string))).toBe(true);
  });

  it.each(['not-found.tsx', 'error.tsx'])('%s renders MinimalShell', (name) => {
    expect(read(path.join(LOCALE_DIR, name))).toMatch(/<MinimalShell[\s>]/);
  });

  it.each(SHELL_NAMES)('%s renders the LanguageSwitcher', (name) => {
    expect(read(path.join(SHELL_DIR, `${name}.tsx`))).toContain('<LanguageSwitcher');
  });
});

describe('new shell and page sources', () => {
  it('contain no physical-direction classes', () => {
    const files = [
      ...walk(SHELL_DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)),
      ...walk(LOCALE_DIR).filter((f) => /\.tsx$/.test(f)),
    ];
    for (const file of files) {
      expect(findPhysicalDirection(read(file), file), rel(file)).toEqual([]);
    }
  });
});
