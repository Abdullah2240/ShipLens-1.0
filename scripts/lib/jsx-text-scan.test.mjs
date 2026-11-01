import { describe, expect, it } from 'vitest';
import { scanJsxText, shouldScanFile } from './jsx-text-scan.mjs';

const allowlist = { tokens: ['PKR', 'ShipLens'], keys: [], files: [] };

function scan(text, file = 'src/app/page.tsx', options = { allowlist }) {
  return scanJsxText([{ file, text }], options);
}

const wrap = (jsx) => `export function X({ t }) {\n  return (\n    ${jsx}\n  );\n}\n`;

describe('scanJsxText', () => {
  it('flags hard-coded text between tags with its line', () => {
    expect(scan(wrap('<p>Hello</p>'))).toEqual([
      { file: 'src/app/page.tsx', line: 3, text: 'Hello', kind: 'jsx-text' },
    ]);
  });

  it('passes text read from messages', () => {
    expect(scan(wrap("<p>{t('x')}</p>"))).toEqual([]);
  });

  it('flags string-literal aria-label, placeholder, title and alt values', () => {
    const found = scan(
      wrap(
        '<div><button aria-label="Close" /><input placeholder="Search" /><span title="Info" /><img alt="Logo" /></div>',
      ),
    );
    expect(found.map((f) => [f.kind, f.text])).toEqual([
      ['attribute', 'Close'],
      ['attribute', 'Search'],
      ['attribute', 'Info'],
      ['attribute', 'Logo'],
    ]);
  });

  it('flags a string literal inside braces for those attributes', () => {
    expect(scan(wrap(`<button aria-label={'Close'} />`)).map((f) => f.text)).toEqual(['Close']);
  });

  it('passes translated attributes and other attributes', () => {
    expect(
      scan(
        wrap(
          `<button aria-label={t('close')} className="flex gap-2" data-testid="close-button" type="button" />`,
        ),
      ),
    ).toEqual([]);
  });

  it('flags a bare string literal child', () => {
    expect(scan(wrap(`<p>{'Hello'}</p>`)).map((f) => f.text)).toEqual(['Hello']);
  });

  it('passes allowlisted tokens, symbols and empty alt text', () => {
    expect(
      scan(
        wrap('<div><span>PKR</span><span>-</span><span>/</span><span>·</span><img alt="" /></div>'),
      ),
    ).toEqual([]);
  });

  it('flags an allowlisted token followed by English words', () => {
    expect(scan(wrap('<span>PKR only</span>')).map((f) => f.text)).toEqual(['PKR only']);
  });

  it('skips decorative glyphs inside aria-hidden elements', () => {
    expect(
      scan(
        wrap(
          '<div><span aria-hidden="true">i</span><span aria-hidden>x</span><span aria-hidden={true}>y</span></div>',
        ),
      ),
    ).toEqual([]);
    expect(scan(wrap('<span aria-hidden="false">Read</span>')).map((f) => f.text)).toEqual([
      'Read',
    ]);
  });

  it('collapses whitespace in multi-line text', () => {
    const found = scan(wrap('<p>\n      Two\n      lines\n    </p>'));
    expect(found.map((f) => f.text)).toEqual(['Two lines']);
  });

  it('skips test files, the tests folder and allowlisted files', () => {
    expect(scan(wrap('<p>Hello</p>'), 'src/app/page.test.tsx')).toEqual([]);
    expect(scan(wrap('<p>Hello</p>'), 'tests/support/x.tsx')).toEqual([]);
    expect(
      scan(wrap('<p>Hello</p>'), 'src/app/dev.tsx', {
        allowlist: { ...allowlist, files: ['src/app/dev.tsx'] },
      }),
    ).toEqual([]);
  });

  it('reads files from disk when given paths', () => {
    expect(scanJsxText(['scripts/lib/does-not-exist.tsx'], { allowlist })).toEqual([]);
  });
});

describe('shouldScanFile', () => {
  it('accepts tsx sources and rejects tests', () => {
    expect(shouldScanFile('src/components/ui/Pager.tsx')).toBe(true);
    expect(shouldScanFile('src\\components\\ui\\Pager.test.tsx')).toBe(false);
    expect(shouldScanFile('tests/e2e/x.tsx')).toBe(false);
    expect(shouldScanFile('src/lib/x.ts')).toBe(false);
  });
});
