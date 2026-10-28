import fs from 'node:fs';
import path from 'node:path';

// One-line change to add a third locale. The first entry is the reference locale
// only for counting keys; every locale is compared against every other.
export const LOCALES = ['en', 'ur'];

/**
 * Names of the top-level ICU arguments in a message. Only a `{` opened at brace
 * depth 0 names an argument, so `{count, plural, one {# item} other {# items}}`
 * yields `count` and nothing from inside the branches.
 */
export function extractPlaceholders(value) {
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'") {
      // ICU quoting: '' is a literal apostrophe, '{ ... ' quotes braces.
      if (value[i + 1] === "'") {
        i += 1;
      } else if (value[i + 1] === '{' || value[i + 1] === '}') {
        const end = value.indexOf("'", i + 1);
        i = end === -1 ? value.length : end;
      }
      continue;
    }
    if (ch === '{') {
      if (depth === 0) {
        const match = /^\s*([A-Za-z_][\w.-]*|\d+)/.exec(value.slice(i + 1));
        if (match) names.add(match[1]);
      }
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
    }
  }
  return names;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Flatten nested objects with dots; arrays and primitives are leaves. */
function flatten(tree, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) flatten(value, full, out);
    else out.set(full, value);
  }
  return out;
}

function listModules(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

function describeSet(set) {
  return `{${[...set].sort().join(', ')}}`;
}

/**
 * Compare every locale directory under rootDir.
 * Returns { problems, keys, files }. Each problem is { type, message } and
 * `message` is the single line printed by the CLI.
 */
export function inspectMessages(rootDir = 'messages') {
  const problems = [];
  const add = (type, detail) => problems.push({ type, message: `${type}: ${detail}` });

  const byLocale = new Map(LOCALES.map((l) => [l, listModules(path.join(rootDir, l))]));
  const allFiles = [...new Set([...byLocale.values()].flat())].sort();

  let keyCount = 0;
  let fileCount = 0;

  for (const file of allFiles) {
    const ns = file.replace(/\.json$/, '');
    const present = LOCALES.filter((l) => byLocale.get(l).includes(file));
    for (const locale of LOCALES) {
      if (!present.includes(locale)) add('file-missing', `${file} (missing in ${locale})`);
    }
    fileCount += 1;

    // Parse each present locale
    const flat = new Map();
    for (const locale of present) {
      const rel = `${locale}/${file}`;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, locale, file), 'utf8'));
        if (!isPlainObject(parsed)) {
          add('invalid-json', `${rel} (top level must be an object)`);
          continue;
        }
        flat.set(locale, flatten(parsed));
      } catch (error) {
        add('invalid-json', `${rel} (${error.message})`);
      }
    }

    // Leaf values must be non-empty strings
    const invalidKeys = new Set();
    for (const [locale, leaves] of flat) {
      for (const [key, value] of leaves) {
        const ok = typeof value === 'string' ? value.trim() !== '' : Array.isArray(value);
        if (!ok) {
          invalidKeys.add(key);
          add('empty-or-invalid-value', `${ns}.${key} (${locale})`);
        }
      }
    }

    if (flat.size < LOCALES.length) continue; // cannot compare keys when a side is unreadable

    const allKeys = new Set();
    for (const leaves of flat.values()) for (const key of leaves.keys()) allKeys.add(key);
    keyCount += allKeys.size;

    for (const key of [...allKeys].sort()) {
      const missing = LOCALES.filter((l) => !flat.get(l).has(key));
      for (const locale of missing) add(`missing-in-${locale}`, `${ns}.${key}`);
      if (missing.length || invalidKeys.has(key)) continue;

      const sets = LOCALES.map((l) => {
        const value = flat.get(l).get(key);
        return typeof value === 'string' ? extractPlaceholders(value) : new Set();
      });
      if (!sets.every((s) => sameSet(s, sets[0]))) {
        const detail = LOCALES.map((l, i) => `${l} ${describeSet(sets[i])}`).join(' vs ');
        add('placeholder-mismatch', `${ns}.${key} (${detail})`);
      }
    }
  }

  return { problems, keys: keyCount, files: fileCount };
}

/** Returns the list of problems; empty means the locales are in parity. */
export function checkMessages(rootDir = 'messages') {
  return inspectMessages(rootDir).problems;
}
