// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';
import { Qr } from '.';

const MESSAGES = path.resolve(import.meta.dirname, '../../../messages');
const URL_SAMPLE = 'https://example.test/verify/7K2QHM9XWD?s=0123456789abcdef';

type Messages = Record<string, unknown>;
function messages(locale: string): Messages {
  return JSON.parse(readFileSync(path.join(MESSAGES, locale, 'verify.json'), 'utf8')) as Messages;
}
function flatKeys(tree: Messages, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatKeys(value as Messages, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

/** Dark cells drawn by a path made of `M x y h1v1h-1z` unit squares. */
function darkCells(d: string): Set<string> {
  const cells = new Set<string>();
  for (const match of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) cells.add(`${match[1]},${match[2]}`);
  return cells;
}

function renderQr(value: string, label = 'QR') {
  const { container } = render(<Qr value={value} label={label} />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('no svg');
  return { container, svg };
}

describe('verify namespace', () => {
  it('is loaded by the app, after the phase 3 namespaces', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../i18n/request.ts'), 'utf8');
    const list = /NAMESPACES = \[([\s\S]*?)\] as const/.exec(source)?.[1] ?? '';
    const names = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(names.at(-1)).toBe('verify');
    expect(names.indexOf('verify')).toBeGreaterThan(names.indexOf('share'));
  });

  it('has identical keys in English and Urdu', () => {
    expect(flatKeys(messages('ur')).sort()).toEqual(flatKeys(messages('en')).sort());
  });

  it('carries every key the twist screens rely on', () => {
    const keys = new Set(flatKeys(messages('en')));
    const required = [
      'badge.intact',
      'badge.intactDetail',
      'badge.broken',
      'badge.reason.sequence_gap',
      'badge.reason.link_mismatch',
      'badge.reason.hash_mismatch',
      'badge.empty',
      'badge.recheck',
      'panel.title',
      'panel.intro',
      'panel.code',
      'panel.seal',
      'panel.sealHelp',
      'panel.open',
      'panel.copy',
      'panel.copied',
      'panel.qrLabel',
      'page.title',
      'page.intro',
      'page.codeLabel',
      'page.codeHint',
      'page.submit',
      'page.invalid',
      'page.notFound',
      'page.rateLimited',
      'page.metaDescription',
      'result.branch',
      'result.week',
      'result.approvedTotal',
      'result.collections',
      'result.approvedOn',
      'result.anchor',
      'result.seal',
      'result.checkedAt',
      'result.howItWorks',
      'result.privacy',
      ...['verified', 'mismatch', 'unanchored', 'chain_broken'].flatMap((s) => [
        `result.integrity.${s}`,
        `result.integrityDetail.${s}`,
      ]),
      ...['match', 'mismatch', 'not_provided'].map((s) => `result.sealCheck.${s}`),
      ...['intact', 'broken', 'empty'].map((s) => `result.chain.${s}`),
    ];
    for (const key of required) expect(keys, key).toContain(key);
  });

  it('keeps page strings free of markup tags so pages can use plain t()', () => {
    for (const locale of ['en', 'ur']) {
      const page = messages(locale).page as Record<string, string>;
      for (const [key, value] of Object.entries(page)) expect(value, key).not.toMatch(/<\w+>/);
    }
  });
});

describe('Qr', () => {
  it('renders one labelled svg with a 4-module quiet zone, a light background and one dark path', () => {
    const { svg } = renderQr(URL_SAMPLE, 'Open the check');
    const size = encode(URL_SAMPLE, { ecc: 'M', border: 0 }).size;
    const n = size + 8;

    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Open the check');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${n} ${n}`);
    expect(svg.getAttribute('width')).toBe('176');
    expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');

    const rects = svg.querySelectorAll('rect');
    expect(rects).toHaveLength(1);
    expect(rects[0]?.getAttribute('fill')).toBe('#fff');
    expect(rects[0]?.getAttribute('width')).toBe(String(n));

    const paths = svg.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute('fill')).toBe('#111');
  });

  it('draws the three finder patterns', () => {
    const { svg } = renderQr(URL_SAMPLE);
    const n = encode(URL_SAMPLE, { ecc: 'M', border: 0 }).size + 8;
    const cells = darkCells(svg.querySelector('path')?.getAttribute('d') ?? '');

    for (const [x, y] of [
      [4, 4],
      [n - 5, 4],
      [4, n - 5],
    ]) {
      expect(cells.has(`${x},${y}`), `finder corner ${x},${y}`).toBe(true);
    }
    // The quiet zone is never painted.
    for (const cell of cells) {
      const [x = 0, y = 0] = cell.split(',').map(Number);
      expect(x >= 4 && y >= 4 && x < n - 4 && y < n - 4, cell).toBe(true);
    }
    // Finder centre is dark and its separator ring is light.
    expect(cells.has('7,7')).toBe(true);
    expect(cells.has('5,5')).toBe(false);
  });

  it('matches the uqr matrix module for module', () => {
    const { data } = encode(URL_SAMPLE, { ecc: 'M', border: 0 });
    const cells = darkCells(
      renderQr(URL_SAMPLE).svg.querySelector('path')?.getAttribute('d') ?? '',
    );
    const expected = data.flatMap((row, y) =>
      row.flatMap((dark, x) => (dark ? [`${x + 4},${y + 4}`] : [])),
    );
    expect(cells.size).toBe(expected.length);
    for (const cell of expected) expect(cells.has(cell)).toBe(true);
  });

  it('is deterministic and value-sensitive', () => {
    const a = renderQr(URL_SAMPLE).svg.querySelector('path')?.getAttribute('d');
    const b = renderQr(URL_SAMPLE).svg.querySelector('path')?.getAttribute('d');
    const c = renderQr('https://example.test/verify/ABCDE12345?s=fedcba9876543210')
      .svg.querySelector('path')
      ?.getAttribute('d');
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('accepts a custom pixel size', () => {
    const { container } = render(<Qr value={URL_SAMPLE} label="QR" size={240} />);
    expect(container.querySelector('svg')?.getAttribute('height')).toBe('240');
  });

  it('uses no injected HTML and no script', () => {
    const { container } = renderQr(URL_SAMPLE);
    expect(container.querySelector('script')).toBeNull();
    const source = readFileSync(path.join(import.meta.dirname, 'Qr.tsx'), 'utf8');
    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).not.toMatch(/^['"]use client['"]/m);
  });
});
