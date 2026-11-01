import fs from 'node:fs';
import path from 'node:path';

const URDU_SCRIPT = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]+/g;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Flatten nested objects and arrays with dots; strings are the leaves. */
function flatten(tree, prefix = '', out = new Map()) {
  const entries = Array.isArray(tree) ? tree.map((v, i) => [String(i), v]) : Object.entries(tree);
  for (const [key, value] of entries) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) || Array.isArray(value)) flatten(value, full, out);
    else if (typeof value === 'string') out.set(full, value);
  }
  return out;
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The Latin words left in a message after removing ICU syntax (argument names,
 * plural and select selectors, `#`), rich-text tag names and allowlisted tokens.
 * Returns them joined by spaces; an empty string means nothing needs translating.
 */
export function residualLatin(value, tokens = []) {
  let text = value;
  // Rich-text tags such as <link>...</link> or <b/>.
  text = text.replace(/<\/?[A-Za-z][\w-]*\s*\/?>/g, ' ');
  // Simple and formatted arguments: {name}, {count, number}, {d, date, short}.
  let previous;
  do {
    previous = text;
    text = text.replace(/\{\s*[\w.-]+\s*(?:,\s*(?:number|date|time)\s*(?:,[^{}]*)?)?\}/g, ' ');
  } while (text !== previous);
  // Plural and select headers, then the selector before each remaining branch.
  text = text.replace(
    /\{\s*[\w.-]+\s*,\s*(?:plural|select|selectordinal)\s*,(?:\s*offset:\d+)?/g,
    ' ',
  );
  text = text.replace(/(?:=\d+|[A-Za-z_][\w-]*)\s*(?=\{)/g, ' ');
  text = text.replace(/[{}#]/g, ' ');
  for (const token of tokens) {
    text = text.replace(new RegExp(`(?<![A-Za-z])${escapeRegExp(token)}(?![A-Za-z])`, 'g'), ' ');
  }
  return (text.match(LATIN_WORD) ?? []).join(' ');
}

/**
 * Urdu values that were left in English: either a copy of the English value or
 * text with Latin words and no Urdu script. Values that are only placeholders,
 * digits, punctuation or allowlisted tokens pass. Keys missing on either side are
 * the parity check's business and are skipped here.
 *
 * @returns {{ namespace: string, key: string, en: string, ur: string, reason: 'identical' | 'no-urdu-script' }[]}
 */
export function findUntranslated(messagesRoot, { allowlist = {}, skipNamespaces = [] } = {}) {
  const tokens = allowlist.tokens ?? [];
  const allowedKeys = new Set(allowlist.keys ?? []);
  const skipped = new Set(skipNamespaces);
  const findings = [];

  let files = [];
  try {
    files = fs
      .readdirSync(path.join(messagesRoot, 'en'))
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return findings;
  }

  for (const file of files) {
    const namespace = file.replace(/\.json$/, '');
    if (skipped.has(namespace)) continue;
    const en = readJson(path.join(messagesRoot, 'en', file));
    const ur = readJson(path.join(messagesRoot, 'ur', file));
    if (!en || !ur) continue;
    const enFlat = flatten(en);
    const urFlat = flatten(ur);
    for (const [key, enValue] of enFlat) {
      const urValue = urFlat.get(key);
      if (urValue === undefined) continue;
      if (allowedKeys.has(`${namespace}.${key}`)) continue;
      if (URDU_SCRIPT.test(urValue)) continue;
      if (residualLatin(urValue, tokens) === '') continue;
      findings.push({
        namespace,
        key,
        en: enValue,
        ur: urValue,
        reason: urValue === enValue ? 'identical' : 'no-urdu-script',
      });
    }
  }
  return findings;
}
