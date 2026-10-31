// .env.example must list every environment variable the code, scripts, compose files and
// CI read, and must never hold a real secret.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const SELF = 'scripts/env-example.test.mjs';
const SOURCE_DIRS = ['src', 'scripts', 'db', 'tests'];
const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js', '.cjs']);
const ROOT_CONFIGS = ['next.config.ts', 'playwright.config.ts', 'vitest.config.ts'];
const COMPOSE_FILES = ['compose.yaml', 'compose.e2e.yaml'];
const ENV_SCHEMA = 'src/platform/config/env.ts';

// Set by the platform, the framework or the CI runner, never by a person.
const SKIP_EXACT = new Set([
  'CI',
  'NODE_OPTIONS',
  'NEXT_RUNTIME',
  'NEXT_PHASE',
  'NEXT_TELEMETRY_DISABLED',
  'HOSTNAME',
  'MSYS_NO_PATHCONV',
]);
const SKIP_PREFIXES = ['GITHUB_', 'RUNNER_'];

const DOCUMENTED_LOCAL_CREDENTIALS = 'shiplens:shiplens';

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SOURCE_EXT.has(path.extname(entry.name))) yield full;
  }
}

const read = (file) => readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');

/** Variable names read in JS or TS source. */
function namesFromSource(text) {
  const names = new Set();
  const patterns = [
    /\bprocess\.env\??\.([A-Z][A-Z0-9_]*)\b/g,
    /\bprocess\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
    /\b(?:env|source)\??\.([A-Z][A-Z0-9_]*)\b/g,
    /\b(?:env|source)\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) names.add(m[1]);
  for (const m of text.matchAll(/\{([^}]*)\}\s*=\s*process\.env\b/g)) {
    for (const part of m[1].split(',')) {
      const key = /^\s*([A-Z][A-Z0-9_]*)/.exec(part)?.[1];
      if (key) names.add(key);
    }
  }
  return names;
}

/** Keys of the zod object in the env schema module. */
function namesFromEnvSchema(text) {
  return new Set([...text.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*z\./gm)].map((m) => m[1]));
}

/** `${NAME}` and `${NAME:-default}` interpolations in compose files. */
function namesFromCompose(text) {
  return new Set([...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
}

/**
 * Keys under any `env:` block of a workflow, except blocks inside `services:` (service
 * container settings such as POSTGRES_*) and keys whose value is a job-result expression
 * (`${{ needs.<job>.result }}`, local to one step). Also names written to $GITHUB_ENV.
 */
function namesFromWorkflow(text) {
  const names = new Set();
  const stack = []; // { indent, key }
  for (const line of text.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = /^(\s*)(?:-\s+)?([A-Za-z0-9_.-]+):(.*)$/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    const key = m[2];
    const value = m[3].trim();
    while (stack.length > 0 && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1);
    const inServices = stack.some((s) => s.key === 'services');
    if (parent?.key === 'env' && !inServices && /^[A-Z][A-Z0-9_]*$/.test(key)) {
      if (!/^\$\{\{\s*needs\./.test(value)) names.add(key);
    }
    stack.push({ indent, key });
  }
  for (const m of text.matchAll(/echo\s+["']?([A-Z][A-Z0-9_]*)=[^\n]*>>\s*"?\$GITHUB_ENV/g)) {
    names.add(m[1]);
  }
  return names;
}

function skipped(name) {
  return SKIP_EXACT.has(name) || SKIP_PREFIXES.some((p) => name.startsWith(p));
}

function collectRequired() {
  const found = new Map(); // name -> first file that reads it
  const add = (names, where) => {
    for (const n of names) if (!skipped(n) && !found.has(n)) found.set(n, where);
  };

  add(namesFromEnvSchema(read(path.join(root, ENV_SCHEMA))), ENV_SCHEMA);
  for (const dir of SOURCE_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      if (rel(file) === SELF) continue;
      add(namesFromSource(read(file)), rel(file));
    }
  }
  for (const name of ROOT_CONFIGS) {
    const file = path.join(root, name);
    if (existsSync(file)) add(namesFromSource(read(file)), name);
  }
  for (const name of COMPOSE_FILES) {
    const file = path.join(root, name);
    if (existsSync(file)) add(namesFromCompose(read(file)), name);
  }
  const wfDir = path.join(root, '.github', 'workflows');
  if (existsSync(wfDir)) {
    for (const entry of readdirSync(wfDir)) {
      if (!/\.ya?ml$/.test(entry)) continue;
      add(namesFromWorkflow(read(path.join(wfDir, entry))), `.github/workflows/${entry}`);
    }
  }
  return found;
}

function parseEnvExample() {
  const entries = [];
  for (const line of read(path.join(root, '.env.example')).split('\n')) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) entries.push({ name: m[1], value: m[2].trim() });
  }
  return entries;
}

describe('.env.example', () => {
  const entries = parseEnvExample();
  const listed = new Set(entries.map((e) => e.name));

  it('lists every variable the code, scripts, compose files and CI read', () => {
    const missing = [...collectRequired()]
      .filter(([name]) => !listed.has(name))
      .map(([name, where]) => `${name} (read in ${where})`);
    expect(missing).toEqual([]);
  });

  it('finds the core variables, so the collector itself works', () => {
    const required = collectRequired();
    for (const name of ['DATABASE_URL', 'TEST_DATABASE_URL', 'APP_ORIGIN', 'SEED_DEMO_PASSWORD']) {
      expect(required.has(name), name).toBe(true);
    }
    expect(required.has('POSTGRES_PASSWORD')).toBe(false);
    expect(required.has('GITHUB_ENV')).toBe(false);
  });

  it('lists each variable once', () => {
    const seen = new Set();
    const duplicates = entries.map((e) => e.name).filter((n) => seen.has(n) || !seen.add(n));
    expect(duplicates).toEqual([]);
  });

  it('has a comment line directly above every variable', () => {
    const lines = read(path.join(root, '.env.example')).split('\n');
    const uncommented = [];
    lines.forEach((line, i) => {
      const name = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
      if (name && !/^#\s*\S/.test(lines[i - 1] ?? '')) uncommented.push(name);
    });
    expect(uncommented).toEqual([]);
  });

  it('holds no real secret', () => {
    for (const { name, value } of entries) {
      const url = /^postgres(?:ql)?:\/\/([^@/]*)@/.exec(value);
      if (url && url[1].includes(':')) {
        expect(url[1], `${name} carries database credentials`).toBe(DOCUMENTED_LOCAL_CREDENTIALS);
      }
      expect(value, `${name} looks like a random secret`).not.toMatch(/[A-Za-z0-9+/_=-]{32,}/);
    }
  });
});

describe('collectors', () => {
  it('reads dotted, bracketed, optional-chained and destructured access', () => {
    const names = namesFromSource(
      [
        'process.env.ALPHA_ONE;',
        "process.env['BETA'];",
        'env?.GAMMA;',
        'source.DELTA;',
        'const { EPSILON, ZETA_TWO = "x" } = process.env;',
        'process.env.lowercase;',
      ].join('\n'),
    );
    expect([...names].sort()).toEqual([
      'ALPHA_ONE',
      'BETA',
      'DELTA',
      'EPSILON',
      'GAMMA',
      'ZETA_TWO',
    ]);
  });

  it('reads workflow env blocks but not service containers or job results', () => {
    const yaml = [
      'jobs:',
      '  a:',
      '    services:',
      '      db:',
      '        env:',
      '          POSTGRES_USER: x',
      '    env:',
      '      JOB_LEVEL: y',
      '    steps:',
      '      - name: s',
      '        env:',
      '          STEP_LEVEL: z',
      '          RESULT: ${{ needs.a.result }}',
      '        run: echo "WRITTEN=1" >> "$GITHUB_ENV"',
    ].join('\n');
    expect([...namesFromWorkflow(yaml)].sort()).toEqual(['JOB_LEVEL', 'STEP_LEVEL', 'WRITTEN']);
  });
});
