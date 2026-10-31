import { describe, expect, it } from 'vitest';
import { findPhysicalDirection } from './logical-css.mjs';

const matches = (text) => findPhysicalDirection(text, 'x.tsx').map((f) => f.match);

describe('findPhysicalDirection: Tailwind utilities', () => {
  it('reports ml-4 inside className', () => {
    expect(matches('<div className="ml-4 p-2">')).toEqual(['ml-4']);
  });

  it.each([
    'mr-2',
    'pl-3',
    'pr-3',
    '-ml-2',
    'left-0',
    'right-4',
    'text-left',
    'text-right',
    'border-l',
    'border-r',
    'border-l-2',
    'rounded-l',
    'rounded-r',
    'rounded-tl-lg',
    'rounded-br-md',
    'float-left',
    'clear-right',
    'space-x-4',
    'divide-x',
    'md:ml-4',
    'hover:text-left',
    '!mr-1',
  ])('reports %s', (token) => {
    expect(matches(`<div className="flex ${token} gap-2">`)).toEqual([token]);
  });

  it.each([
    'ms-4',
    'me-4',
    'ps-2',
    'pe-2',
    'start-0',
    'end-0',
    'text-start',
    'text-end',
    'border-s',
    'border-e',
    'rounded-s',
    'rounded-ee',
    'float-start',
    'gap-4',
    'inset-x-0',
    'md:ms-4',
  ])('allows %s', (token) => {
    expect(matches(`<div className="${token}">`)).toEqual([]);
  });

  it('does not flag words that merely contain the letters', () => {
    expect(matches('// leftover bright Copyright rightful')).toEqual([]);
    expect(matches('const leftover = 1; const copyright = "bright";')).toEqual([]);
  });

  it('reports the position and a logical hint', () => {
    const [finding] = findPhysicalDirection('a\n  <b className="x ml-4">', 'f.tsx');
    expect(finding).toMatchObject({ line: 2, match: 'ml-4' });
    expect(finding.column).toBe(19);
    expect(finding.hint).toContain('ms-');
  });
});

describe('findPhysicalDirection: CSS declarations', () => {
  it.each([
    'margin-left: 1rem;',
    'margin-right: 1rem;',
    'padding-left: 1rem;',
    'padding-right: 1rem;',
    'border-left: 1px solid red;',
    'border-right: 1px solid red;',
    'left: 0;',
    'right: 0;',
    'text-align: left;',
    'text-align: right;',
    'float: left;',
  ])('reports %s', (decl) => {
    expect(matches(`.a { ${decl} }`)).toHaveLength(1);
  });

  it.each([
    'margin-inline-start: 1rem;',
    'inset-inline-end: 0;',
    'padding-inline: 1rem;',
    'text-align: start;',
    'float: inline-start;',
    'border-inline-start: 1px solid red;',
  ])('allows %s', (decl) => {
    expect(matches(`.a { ${decl} }`)).toEqual([]);
  });
});

describe('findPhysicalDirection: ignore markers', () => {
  it('skips a line ending with // logical-css-ignore', () => {
    expect(matches('<div className="ml-4"> // logical-css-ignore')).toEqual([]);
  });

  it('skips a line containing /* logical-css-ignore */', () => {
    expect(matches('.a { left: 0; /* logical-css-ignore */ }')).toEqual([]);
  });

  it('still reports other lines', () => {
    const text = 'ml-2 // logical-css-ignore\n<div className="mr-2">';
    expect(findPhysicalDirection(text, 'x.tsx').map((f) => f.line)).toEqual([2]);
  });
});
