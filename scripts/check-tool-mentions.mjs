// Keeps tool names in one place. The disclosure file AI-USAGE.md carries a marker line
//   <!-- tool-names: Name One | Name Two | ... -->
// and this script fails if any of those names appears in any other tracked or new
// (not ignored) file, or in any commit message. The names live only in that marker;
// this file must never list them itself.
//
// Usage: node scripts/check-tool-mentions.mjs [--no-history] [--all] [--paths <dir|file|glob>...]
//   --no-history  skip commit messages
//   --all         scan commit messages on every ref, not only HEAD
//   --paths       scan only these directories, files or globs (relative to the repo root)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DISCLOSURE_FILE = 'AI-USAGE.md';
const SKIPPED_FILES = new Set([DISCLOSURE_FILE, 'package-lock.json']);
const BINARY_PROBE_BYTES = 8192;
const MARKER = /<!--\s*tool-names:([^>]*?)-->/;

/** Names from the disclosure marker. Throws when the marker is missing or empty. */
export function parseToolNames(text) {
  const match = MARKER.exec(text);
  const names = match
    ? match[1]
        .split('|')
        .map((n) => n.trim())
        .filter(Boolean)
    : [];
  if (names.length === 0) {
    throw new Error(
      `${DISCLOSURE_FILE} has no "<!-- tool-names: ... -->" marker listing the names to guard`,
    );
  }
  return names;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One case-insensitive matcher per name. Whole words only: the name may not touch a
 * letter, digit or underscore on either side. Spaces and hyphens inside a name are literal.
 */
function buildMatchers(names) {
  return names.map((name) => ({
    name,
    re: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, 'iu'),
  }));
}

function findInText(text, matchers, where, ref) {
  const hits = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((content, i) => {
    for (const { name, re } of matchers) {
      if (re.test(content)) hits.push({ where, ref, line: i + 1, name });
    }
  });
  return hits;
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function listCandidateFiles(root) {
  const tracked = git(root, ['ls-files', '-z']).split('\0');
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0');
  return [...new Set([...tracked, ...untracked])]
    .filter(Boolean)
    .filter((f) => !SKIPPED_FILES.has(f) && !f.startsWith('node_modules/'))
    .sort();
}

function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i += 1;
      if (glob[i + 1] === '/') i += 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += escapeRegExp(c);
  }
  return new RegExp(`^${out}$`);
}

/** Keep the candidates selected by directories, files or globs; explicit files are kept even if git ignores them. */
function selectPaths(root, candidates, specs) {
  const selected = new Set();
  for (const raw of specs) {
    const spec = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (/[*?]/.test(spec)) {
      const re = globToRegExp(spec);
      for (const f of candidates) if (re.test(f)) selected.add(f);
      continue;
    }
    const full = path.join(root, spec);
    if (spec === '' || spec === '.') {
      for (const f of candidates) selected.add(f);
    } else if (existsSync(full) && statSync(full).isDirectory()) {
      for (const f of candidates) if (f.startsWith(`${spec}/`)) selected.add(f);
    } else if (existsSync(full) && !SKIPPED_FILES.has(spec)) {
      selected.add(spec);
    }
  }
  return [...selected].sort();
}

function readTextFile(file) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return null; // deleted in the working tree, or not a regular file
  }
  if (buf.subarray(0, BINARY_PROBE_BYTES).includes(0)) return null;
  return buf.toString('utf8');
}

function listCommits(root, allRefs) {
  try {
    git(root, ['rev-parse', '--verify', '-q', 'HEAD']);
  } catch {
    return []; // no commits yet
  }
  const out = git(root, ['log', '--format=%H%x1f%B%x1e', ...(allRefs ? ['--all'] : ['HEAD'])]);
  return out
    .split('\x1e')
    .map((record) => record.replace(/^\s+/, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha, message = ''] = record.split('\x1f');
      return { sha: sha.trim(), message };
    });
}

/**
 * Scan files (and, unless includeHistory is false, commit messages) for the names listed
 * in the disclosure marker. Throws when the disclosure file or its marker is missing.
 * @returns {Promise<{ ok: boolean, hits: Array<{ where: 'file'|'commit', ref: string, line: number, name: string }>, files: number, commits: number }>}
 */
export async function checkToolMentions({
  root = process.cwd(),
  paths,
  includeHistory = true,
  allRefs = false,
} = {}) {
  const disclosure = path.join(root, DISCLOSURE_FILE);
  if (!existsSync(disclosure)) {
    throw new Error(`${DISCLOSURE_FILE} not found in ${root}; it holds the tool-names marker`);
  }
  const matchers = buildMatchers(parseToolNames(readFileSync(disclosure, 'utf8')));

  const candidates = listCandidateFiles(root);
  const files = paths && paths.length > 0 ? selectPaths(root, candidates, paths) : candidates;

  const hits = [];
  let scannedFiles = 0;
  for (const rel of files) {
    const text = readTextFile(path.join(root, rel));
    if (text === null) continue;
    scannedFiles += 1;
    hits.push(...findInText(text, matchers, 'file', rel));
  }

  const commits = includeHistory ? listCommits(root, allRefs) : [];
  for (const { sha, message } of commits) {
    hits.push(...findInText(message, matchers, 'commit', sha));
  }

  return { ok: hits.length === 0, hits, files: scannedFiles, commits: commits.length };
}

export function parseArgs(argv) {
  const opts = { includeHistory: true, allRefs: false, paths: [] };
  let inPaths = false;
  for (const arg of argv) {
    if (arg === '--no-history') {
      opts.includeHistory = false;
      inPaths = false;
    } else if (arg === '--all') {
      opts.allRefs = true;
      inPaths = false;
    } else if (arg === '--paths') {
      inPaths = true;
    } else if (inPaths && !arg.startsWith('--')) {
      opts.paths.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

export function formatHit(hit) {
  return hit.where === 'commit'
    ? `commit ${hit.ref.slice(0, 12)} (message line ${hit.line}): mentions "${hit.name}"`
    : `${hit.ref}:${hit.line}: mentions "${hit.name}"`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = await checkToolMentions({ root: process.cwd(), ...opts });
  for (const hit of result.hits) console.log(formatHit(hit));
  if (!result.ok) {
    console.error(
      `tool-mention check failed: ${result.hits.length} mention(s). Tool names belong only in ${DISCLOSURE_FILE}.`,
    );
    return 1;
  }
  console.log(`tool-mention check ok (${result.files} files, ${result.commits} commits)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`tool-mention check: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
