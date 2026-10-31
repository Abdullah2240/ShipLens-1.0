// Generates the endpoint inventory and the per-endpoint reference in docs/api.md from the
// route files under src/app/api, the permission table and the endpoint registry.
// Usage: node scripts/gen-api-doc.mjs [--check] [--doc <path>]
//
// Route modules are read as text and never imported, so no environment is needed. Only
// src/platform/authz/permissions.ts is loaded (Node native type stripping, data only).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const INVENTORY_START = '<!-- api-inventory:start -->';
export const INVENTORY_END = '<!-- api-inventory:end -->';
export const ENDPOINTS_START = '<!-- api-endpoints:start -->';
export const ENDPOINTS_END = '<!-- api-endpoints:end -->';
export const UNKNOWN_ACTION = 'unknown action';

const GENERATED_NOTE =
  'Generated from the route files by `node scripts/gen-api-doc.mjs`. Do not edit between the markers.';
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_ORDER = Object.fromEntries(METHODS.map((m, i) => [m, i]));
const SCOPE_LABEL = { all: 'all', own_branch: 'own branch' };
const EXAMPLE_ORIGIN = 'http://localhost:3000';
const EXAMPLE_COOKIE = 'shiplens_session=<session token>';

// ---------------------------------------------------------------------------------------
// Small text helpers

const lf = (text) => text.replace(/\r\n/g, '\n');
const readText = (file) => lf(readFileSync(file, 'utf8'));

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

/** Index just past the bracket that closes the one at `open` (string literals skipped). */
function matchBracket(text, open) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const stack = [];
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return text.length;
}

/** Splits the inside of an object literal into its top-level entries. */
function topLevelEntries(inner) {
  const entries = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if ('{(['.includes(ch)) depth++;
    else if ('})]'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) {
      entries.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(inner.slice(start));
  return entries.map((e) => e.replace(/\/\/.*$/gm, '').trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------------------
// Route file parsing

/** 'src/app/api/v1/members/[id]/route.ts' -> '/api/v1/members/{id}' */
export function routePath(relFile) {
  const dir = path.posix.dirname(relFile.split(path.sep).join('/'));
  return '/' + dir.replace(/^src\/app\//, '').replace(/\[([^\]]+)\]/g, '{$1}');
}

/** Named imports per identifier: { name -> module specifier }. */
function parseImports(text) {
  const imports = {};
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (name) imports[name] = m[2];
    }
  }
  return imports;
}

/** Each exported HTTP method with the source text that belongs to it. */
function methodSegments(text) {
  const re =
    /export\s+(?:const\s+(GET|POST|PUT|PATCH|DELETE)\s*=|(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b)/g;
  const hits = [...text.matchAll(re)];
  return hits.map((m, i) => ({
    method: m[1] ?? m[2],
    viaConst: Boolean(m[1]),
    text: text.slice(m.index + m[0].length, i + 1 < hits.length ? hits[i + 1].index : text.length),
  }));
}

function parseOptions(segment) {
  const call = segment.match(/^\s*route\s*\(/);
  if (!call) return null;
  const open = segment.indexOf('{', call[0].length);
  if (open < 0) return null;
  const close = matchBracket(segment, open);
  const opts = segment.slice(open, close);
  return {
    auth: opts.match(/\bauth:\s*['"](\w+)['"]/)?.[1] ?? 'session',
    action: opts.match(/\baction:\s*['"]([\w.]+)['"]/)?.[1] ?? null,
    body: opts.match(/\bbody:\s*([A-Za-z_$][\w$]*)/)?.[1] ?? null,
    query: opts.match(/\bquery:\s*([A-Za-z_$][\w$]*)/)?.[1] ?? null,
    handler: segment.slice(close),
  };
}

/** The top-level key of what the handler sends as the body, e.g. 'data', 'user', 'ok'. */
function responseShape(handler, status) {
  if (status === 204) return { kind: 'empty' };
  const m = handler.match(/\bdata:\s*\{\s*([A-Za-z_$][\w$]*)\s*(?::\s*(true|false)\b)?/);
  if (!m) return { kind: 'handler' };
  return { kind: 'key', key: m[1], literal: m[2] ?? null };
}

function servicesCalled(handler, imports) {
  const names = [];
  for (const [name, from] of Object.entries(imports)) {
    if (!from.startsWith('@/modules/')) continue;
    if (/Schema$/.test(name)) continue;
    if (new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\s*[.(]`).test(handler)) {
      names.push({ name, from });
    }
  }
  return names.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------
// Schema field lookup (best effort, read as text)

function moduleFiles(root, specifier, routeFile) {
  if (!specifier) return [routeFile];
  if (!specifier.startsWith('@/')) return [];
  const base = path.join(root, 'src', specifier.slice(2));
  if (existsSync(base) && statSync(base).isDirectory()) {
    return walk(base, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
  }
  return [`${base}.ts`, `${base}.tsx`].filter(existsSync);
}

function objectKeys(objText, fileText) {
  const inner = objText.slice(1, -1);
  const fields = [];
  for (const entry of topLevelEntries(inner)) {
    if (entry.startsWith('...')) {
      const name = entry.slice(3).trim();
      const def = fileText.match(new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*\\{`));
      if (def) {
        const open = def.index + def[0].length - 1;
        fields.push(...objectKeys(fileText.slice(open, matchBracket(fileText, open)), fileText));
      }
      continue;
    }
    const keyed = entry.match(/^['"]?([A-Za-z_$][\w$]*)['"]?\s*:([\s\S]*)$/);
    const name = keyed ? keyed[1] : entry.match(/^[A-Za-z_$][\w$]*$/)?.[0];
    if (!name) continue;
    const value = keyed ? keyed[2] : '';
    fields.push({ name, optional: /\.(optional|nullish)\(\)/.test(value) });
  }
  return fields;
}

/** Top-level fields of `export const <name> = z...object({ ... })`, or null when unknown. */
export function schemaFields(root, name, specifier, routeFile) {
  for (const file of moduleFiles(root, specifier, routeFile)) {
    const text = readText(file);
    const def = text.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=`));
    if (!def) continue;
    const rest = text.slice(def.index + def[0].length);
    const obj = rest.match(/^\s*z\s*\.\s*(?:strictObject|object|looseObject)\s*\(\s*\{/);
    if (!obj) return null;
    const open = def.index + def[0].length + obj[0].length - 1;
    return objectKeys(text.slice(open, matchBracket(text, open)), text);
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Registry and permissions

/** { 'METHOD route' -> registry id } from tests/http/registry/*.registry.ts, read as text. */
export function readRegistry(root) {
  const dir = path.join(root, 'tests', 'http', 'registry');
  const ids = {};
  for (const file of walk(dir, (f) => f.endsWith('.registry.ts'))) {
    const text = readText(file);
    const starts = [...text.matchAll(/\bid:\s*'([^']+)'/g)];
    starts.forEach((m, i) => {
      const chunk = text.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined);
      const method = chunk.match(/\bmethod:\s*'(\w+)'/)?.[1];
      const route = chunk.match(/\broute:\s*'([^']+)'/)?.[1];
      if (method && route) ids[`${method} ${route}`] = m[1];
    });
  }
  return ids;
}

export async function loadPermissions(root) {
  const file = path.join(root, 'src', 'platform', 'authz', 'permissions.ts');
  const { PERMISSIONS } = await import(pathToFileURL(file).href);
  return PERMISSIONS;
}

function rolesFor(auth, action, permissions) {
  if (!action) return auth === 'public' ? 'anyone' : 'any signed-in role';
  const grants = Object.hasOwn(permissions, action) ? permissions[action] : null;
  if (!grants) return UNKNOWN_ACTION;
  return Object.entries(grants)
    .map(([role, scope]) => `${role} (${SCOPE_LABEL[scope] ?? scope})`)
    .join(', ');
}

// ---------------------------------------------------------------------------------------
// Inventory

/**
 * Rows sorted by path then method:
 * { method, path, auth, action, roles, body, file, query, status, response, services,
 *   params, bodyFields, registryId }
 */
export async function buildInventory(root, { permissions } = {}) {
  const perms = permissions ?? (await loadPermissions(root));
  const registry = readRegistry(root);
  const apiDir = path.join(root, 'src', 'app', 'api');
  const rows = [];
  for (const full of walk(apiDir, (f) => /[\\/]route\.tsx?$/.test(f))) {
    const file = path.relative(root, full).split(path.sep).join('/');
    const text = readText(full);
    const imports = parseImports(text);
    const apiPath = routePath(file);
    const params = [...apiPath.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const seg of methodSegments(text)) {
      const opts = seg.viaConst ? parseOptions(seg.text) : null;
      const handler = opts ? opts.handler : seg.text;
      const status = Number(handler.match(/\bstatus:\s*(\d{3})\b/)?.[1] ?? 200);
      const auth = opts ? opts.auth : 'public';
      const action = opts ? opts.action : null;
      const body = opts?.body ?? null;
      const registryKey = `${seg.method} ${apiPath
        .replace(/^\/api\/v1\//, '')
        .replace(/\{([^}]+)\}/g, '[$1]')}`;
      rows.push({
        method: seg.method,
        path: apiPath,
        auth,
        action,
        roles: rolesFor(auth, action, perms),
        body,
        file,
        query: opts?.query ?? null,
        wrapped: Boolean(opts),
        status,
        response: opts ? responseShape(handler, status) : { kind: 'handler' },
        services: servicesCalled(handler, imports),
        params,
        bodyFields: body ? schemaFields(root, body, imports[body], full) : null,
        registryId: registry[registryKey] ?? null,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      METHOD_ORDER[a.method] - METHOD_ORDER[b.method],
  );
}

const code = (value) => (value ? `\`${value}\`` : '-');

export function renderInventory(rows) {
  const lines = [
    '| Method | Path | Auth | Action | Roles (scope) | Request body |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.method} | \`${r.path}\` | ${r.auth} | ${code(r.action)} | ${r.roles} | ${code(r.body)} |`,
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------
// Per-endpoint reference

function exampleValue(param, index) {
  if (/id$/i.test(param)) return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  if (param === 'locale') return 'en';
  return `example-${param}`;
}

function examplePath(row) {
  let i = 0;
  return row.path.replace(/\{([^}]+)\}/g, (_, name) => exampleValue(name, i++));
}

function exampleBody(fields) {
  const obj = Object.fromEntries(fields.map((f) => [f.name, `<${f.name}>`]));
  return JSON.stringify(obj);
}

function exampleRequest(row) {
  const lines = [`curl -X ${row.method} "${EXAMPLE_ORIGIN}${examplePath(row)}"`];
  if (row.method !== 'GET') lines.push(`  -H "Origin: ${EXAMPLE_ORIGIN}"`);
  if (row.auth === 'session') lines.push(`  -b "${EXAMPLE_COOKIE}"`);
  if (row.body) {
    lines.push('  -H "Content-Type: application/json"');
    lines.push(`  -d '${row.bodyFields?.length ? exampleBody(row.bodyFields) : '{}'}'`);
  }
  return lines.join(' \\\n');
}

function exampleResponse(row) {
  const head = `HTTP/1.1 ${row.status}`;
  const r = row.response;
  if (r.kind === 'empty') return head;
  if (r.kind === 'handler')
    return `${head}\n\n(JSON written directly by the handler in ${row.file})`;
  const value = r.literal ?? (row.services[0] ? `<result of ${row.services[0].name}>` : '<value>');
  const json = r.literal ? `{ "${r.key}": ${value} }` : `{ "${r.key}": "${value}" }`;
  return `${head}\nContent-Type: application/json\n\n${json}`;
}

function errorStatuses(row) {
  const out = [];
  if (row.wrapped && row.method !== 'GET') out.push('403 (Origin)');
  if (row.auth === 'session') out.push('401');
  if (row.action) out.push('403');
  if (row.params.length > 0 && row.auth === 'session') out.push('404');
  if (row.wrapped && row.method !== 'GET') out.push('409');
  if (row.body || row.query) out.push('422');
  return out;
}

function fieldList(fields) {
  return fields.map((f) => `\`${f.name}\`${f.optional ? ' (optional)' : ''}`).join(', ');
}

export function renderEndpoints(rows) {
  const out = [];
  for (const r of rows) {
    out.push(`### ${r.method} ${r.path}`, '');
    const access =
      r.auth === 'public'
        ? 'public, no session'
        : r.action
          ? `session, action \`${r.action}\``
          : 'session, any signed-in role';
    out.push(`- Access: ${access}.`);
    if (r.action) out.push(`- Roles (scope): ${r.roles}.`);
    if (r.params.length)
      out.push(`- Path parameters: ${r.params.map((p) => `\`${p}\``).join(', ')}.`);
    if (r.query) out.push(`- Query schema: \`${r.query}\`.`);
    if (r.body) {
      const fields = r.bodyFields?.length ? `; fields ${fieldList(r.bodyFields)}` : '';
      out.push(`- Request body: \`${r.body}\`${fields}.`);
    } else {
      out.push('- Request body: none.');
    }
    if (r.services.length) {
      const names = r.services.map((s) => `\`${s.name}\` (\`${s.from}\`)`).join(', ');
      out.push(`- Service: ${names}.`);
    }
    const errors = errorStatuses(r);
    out.push(
      `- Success status: ${r.status}.${errors.length ? ` Error statuses: ${errors.join(', ')}.` : ''}`,
    );
    out.push(
      `- Access matrix: ${r.registryId ? `registry id \`${r.registryId}\`` : 'not in the endpoint registry'}.`,
    );
    out.push(`- Source: \`${r.file}\`.`);
    out.push('', '```http', exampleRequest(r), '```', '', '```http', exampleResponse(r), '```', '');
  }
  return out.join('\n').trimEnd();
}

function renderPublicList(rows) {
  const pub = rows.filter((r) => r.auth === 'public');
  return pub.map((r) => `- ${r.method} \`${r.path}\``).join('\n');
}

// ---------------------------------------------------------------------------------------
// Document assembly and check

function replaceBlock(doc, start, end, body) {
  const a = doc.indexOf(start);
  const b = doc.indexOf(end);
  if (a < 0 || b < a) throw new Error(`markers ${start} / ${end} not found in the doc`);
  return `${doc.slice(0, a + start.length)}\n${body}\n${doc.slice(b)}`;
}

export function inventoryBlock(rows) {
  return [
    GENERATED_NOTE,
    '',
    renderInventory(rows),
    '',
    'Endpoints that need no session:',
    '',
    renderPublicList(rows),
  ].join('\n');
}

export function endpointsBlock(rows) {
  return [GENERATED_NOTE, '', renderEndpoints(rows)].join('\n');
}

export function renderDoc(doc, rows) {
  let next = replaceBlock(lf(doc), INVENTORY_START, INVENTORY_END, inventoryBlock(rows));
  if (next.includes(ENDPOINTS_START)) {
    next = replaceBlock(next, ENDPOINTS_START, ENDPOINTS_END, endpointsBlock(rows));
  }
  return next;
}

/** Problems that make --check fail; empty when the doc matches the code. */
export function checkDoc(doc, rows) {
  const text = lf(doc);
  const problems = [];
  let expected;
  try {
    expected = renderDoc(text, rows);
  } catch (error) {
    return [error.message];
  }
  if (expected !== text) problems.push('generated blocks are stale');
  for (const r of rows) {
    if (r.roles === UNKNOWN_ACTION) {
      problems.push(
        `${r.method} ${r.path} uses an action missing from the permission table: ${r.action}`,
      );
    }
  }
  const a = text.indexOf(INVENTORY_START);
  const b = text.indexOf(INVENTORY_END);
  const outside = text.slice(0, a) + text.slice(b);
  const missing = rows
    .map((r) => `### ${r.method} ${r.path}`)
    .filter((h) => !outside.split('\n').some((line) => line.trim() === h));
  if (missing.length)
    problems.push(`missing sections:\n${missing.map((h) => `  ${h}`).join('\n')}`);
  return problems;
}

// ---------------------------------------------------------------------------------------
// CLI

export async function main(argv, root) {
  const check = argv.includes('--check');
  const docIndex = argv.indexOf('--doc');
  const docPath =
    docIndex >= 0 && argv[docIndex + 1]
      ? path.resolve(argv[docIndex + 1])
      : path.join(root, 'docs', 'api.md');
  const rel = path.relative(root, docPath).split(path.sep).join('/');
  if (!existsSync(docPath)) {
    console.error(`${rel} is missing.`);
    return 1;
  }
  const rows = await buildInventory(root);
  const doc = readFileSync(docPath, 'utf8');
  if (check) {
    const problems = checkDoc(doc, rows);
    if (problems.length) {
      console.error(`${rel} does not match the routes:\n- ${problems.join('\n- ')}`);
      console.error('Run `node scripts/gen-api-doc.mjs` and commit the result.');
      return 1;
    }
    console.log(`${rel} is up to date (${rows.length} endpoints).`);
    return 0;
  }
  writeFileSync(docPath, renderDoc(doc, rows));
  console.log(`Wrote ${rel} (${rows.length} endpoints).`);
  return 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = path.resolve(
    process.env.API_DOC_ROOT ?? fileURLToPath(new URL('..', import.meta.url)),
  );
  process.exitCode = await main(process.argv.slice(2), root);
}
