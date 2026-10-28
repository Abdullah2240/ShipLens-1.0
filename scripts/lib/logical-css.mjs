// Finds physical-direction CSS and Tailwind utilities that break right-to-left layouts.
// Add `// logical-css-ignore` (or `/* logical-css-ignore */`) to a line to skip it.

const VALUE = String.raw`[\w./%#\[\]-]`;
const VARIANTS = String.raw`(?:[\w\[\]&>*=.-]+:)*`;
const END = String.raw`(?![\w-])`;
const SIDE = { l: 's', r: 'e', tl: 'ss', tr: 'se', bl: 'es', br: 'ee' };

const UTILITY = new RegExp(
  String.raw`(^|[\s"'\x60{(])(${VARIANTS}!?)(-?(?:` +
    [
      String.raw`(?:scroll-)?[mp][lr]-${VALUE}+`,
      String.raw`(?:left|right)-${VALUE}+`,
      String.raw`text-(?:left|right)`,
      String.raw`border-[lr](?:-${VALUE}+)?`,
      String.raw`rounded-(?:l|r|tl|tr|bl|br)(?:-${VALUE}+)?`,
      String.raw`(?:float|clear)-(?:left|right)`,
      String.raw`space-x-${VALUE}+`,
      String.raw`divide-x(?:-${VALUE}+)?`,
    ].join('|') +
    String.raw`))${END}`,
  'g',
);

const CSS_RULES = [
  { re: /(^|[\s{;"'])((?:margin|padding)-(?:left|right))\s*:/g, kind: 'prop' },
  { re: /(^|[\s{;"'])(border-(?:left|right)(?:-[a-z]+)?)\s*:/g, kind: 'prop' },
  { re: /(^|[\s{;"'])((?:left|right))\s*:(?!:)/g, kind: 'inset' },
  { re: /(^|[\s{;"'])(text-align\s*:\s*(?:left|right))(?![\w-])/g, kind: 'align' },
  { re: /(^|[\s{;"'])((?:float|clear)\s*:\s*(?:left|right))(?![\w-])/g, kind: 'float' },
];

const swap = (s) => s.replace(/left/g, 'start').replace(/right/g, 'end');

function utilityHint(core) {
  const name = core.replace(/^-/, '');
  let m = name.match(/^(scroll-)?([mp])([lr])-/);
  if (m)
    return `use ${m[1] ?? ''}${m[2]}${m[3] === 'l' ? 's' : 'e'}-* instead of ${m[1] ?? ''}${m[2]}${m[3]}-*`;
  m = name.match(/^(left|right)-/);
  if (m) return `use ${swap(m[1])}-* instead of ${m[1]}-*`;
  m = name.match(/^text-(left|right)$/);
  if (m) return `use text-${swap(m[1])}`;
  m = name.match(/^border-([lr])/);
  if (m) return `use border-${m[1] === 'l' ? 's' : 'e'} instead of border-${m[1]}`;
  m = name.match(/^rounded-(l|r|tl|tr|bl|br)(?![a-z])/);
  if (m) return `use rounded-${SIDE[m[1]]} instead of rounded-${m[1]}`;
  m = name.match(/^(float|clear)-(left|right)$/);
  if (m) return `use ${m[1]}-${swap(m[2])}`;
  if (name.startsWith('space-x')) return 'use gap-* on a flex or grid container';
  return 'use a flex or grid gap, or a logical border (border-s / border-e)';
}

function cssHint(kind, text) {
  if (kind === 'prop')
    return `use ${swap(text)} -> ${text.replace(/-(left|right)/, (_, d) => `-inline-${d === 'left' ? 'start' : 'end'}`)}`;
  if (kind === 'inset') return `use inset-inline-${text === 'left' ? 'start' : 'end'}`;
  return `use ${swap(text)}`;
}

export function findPhysicalDirection(text, filename = '') {
  void filename;
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, i) => {
    if (line.includes('logical-css-ignore')) return;

    for (const m of line.matchAll(UTILITY)) {
      const column = m.index + m[1].length + 1;
      findings.push({
        line: i + 1,
        column,
        match: m[2] + m[3],
        hint: utilityHint(m[3]),
      });
    }

    for (const { re, kind } of CSS_RULES) {
      for (const m of line.matchAll(re)) {
        findings.push({
          line: i + 1,
          column: m.index + m[1].length + 1,
          match: m[2],
          hint: cssHint(kind, m[2]),
        });
      }
    }
  });

  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
