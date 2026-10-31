import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ENDPOINTS_END,
  ENDPOINTS_START,
  INVENTORY_END,
  INVENTORY_START,
  buildInventory,
  checkDoc,
  renderDoc,
  renderInventory,
  routePath,
} from './gen-api-doc.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(repoRoot, 'scripts', 'gen-api-doc.mjs');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'api-doc-'));

const PERMISSIONS = {
  'thing.read': { super_admin: 'all', branch_lead: 'own_branch' },
  'thing.update': { super_admin: 'all' },
  'nested.read': { finance_reviewer: 'all' },
};

function put(rel, text) {
  const file = path.join(tmp, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const API = 'src/app/api';

beforeAll(() => {
  put(
    'src/platform/authz/permissions.ts',
    `export const PERMISSIONS = ${JSON.stringify(PERMISSIONS)} as const;\n`,
  );
  // route() with session auth and an action; two methods in one file; dynamic segment
  put(
    `${API}/v1/things/[id]/route.ts`,
    [
      "import { getThing, updateThing, thingPatchSchema } from '@/modules/things';",
      "import { route } from '@/platform/http/interim-route';",
      "export const dynamic = 'force-dynamic';",
      "export const GET = route({ auth: 'session', action: 'thing.read' }, async (c) => ({",
      '  data: { data: await getThing(c.command.pool, c.params.id ?? "") },',
      '}));',
      'export const PATCH = route(',
      // multi-line options object
      '  {',
      "    auth: 'session',",
      "    action: 'thing.update',",
      '    body: thingPatchSchema,',
      '  },',
      '  async (c) => ({ data: { data: await updateThing(c.command, c.params.id ?? "", c.body) } }),',
      ');',
      '',
    ].join('\n'),
  );
  put(
    'src/modules/things/schema.ts',
    [
      'const extra = { note: z.string().optional() };',
      'export const thingPatchSchema = z.strictObject({',
      '  name: z.string().min(1, { error: "too_short" }),',
      '  city: z.string().nullable().optional(),',
      '  ...extra,',
      '});',
      '',
    ].join('\n'),
  );
  // public route() with a locally declared body schema and a 201
  put(
    `${API}/v1/public/signups/route.ts`,
    [
      "import { z } from 'zod';",
      "import { route } from '@/platform/http/interim-route';",
      'const signupSchema = z.object({ email: z.string(), website: z.string().optional() });',
      "export const POST = route({ auth: 'public', body: signupSchema }, async () => {",
      '  return { status: 201, data: { ok: true } };',
      '});',
      '',
    ].join('\n'),
  );
  // nested dynamic segments
  put(
    `${API}/v1/nested/[slug]/items/[itemId]/route.ts`,
    "export const GET = route({ auth: 'session', action: 'nested.read' }, async () => ({ data: { data: 1 } }));\n",
  );
  // plain health handler, not wrapped by route()
  put(
    `${API}/health/route.ts`,
    'export async function GET() {\n  return Response.json({ status: "ok" });\n}\n',
  );
  // session only, no action, 204
  put(
    `${API}/v1/session/route.ts`,
    "export const DELETE = route({ auth: 'session' }, async () => ({ status: 204 }));\n",
  );
  put(
    'tests/http/registry/x.registry.ts',
    "const specs = [{ id: 'things.get', method: 'GET', route: 'things/[id]', action: 'thing.read' }];\n",
  );
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const build = (permissions = PERMISSIONS) => buildInventory(tmp, { permissions });

const TEMPLATE = [
  '# API',
  '',
  INVENTORY_START,
  INVENTORY_END,
  '',
  '## Endpoints',
  '',
  ENDPOINTS_START,
  ENDPOINTS_END,
  '',
].join('\n');

describe('routePath', () => {
  it('turns a route file into an API path', () => {
    expect(routePath('src/app/api/v1/members/[id]/route.ts')).toBe('/api/v1/members/{id}');
    expect(routePath(path.join('src', 'app', 'api', 'health', 'route.ts'))).toBe('/api/health');
  });
});

describe('buildInventory', () => {
  it('lists every method sorted by path then method', async () => {
    const rows = await build();
    expect(rows.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/health',
      'GET /api/v1/nested/{slug}/items/{itemId}',
      'POST /api/v1/public/signups',
      'DELETE /api/v1/session',
      'GET /api/v1/things/{id}',
      'PATCH /api/v1/things/{id}',
    ]);
  });

  it('reads auth, action, roles, body and file', async () => {
    const rows = await build();
    const by = (key) => rows.find((r) => `${r.method} ${r.path}` === key);
    expect(by('GET /api/v1/things/{id}')).toMatchObject({
      auth: 'session',
      action: 'thing.read',
      roles: 'super_admin (all), branch_lead (own branch)',
      body: null,
      file: 'src/app/api/v1/things/[id]/route.ts',
      registryId: 'things.get',
      params: ['id'],
    });
    expect(by('PATCH /api/v1/things/{id}')).toMatchObject({
      auth: 'session',
      action: 'thing.update',
      roles: 'super_admin (all)',
      body: 'thingPatchSchema',
      bodyFields: [
        { name: 'name', optional: false },
        { name: 'city', optional: true },
        { name: 'note', optional: true },
      ],
      registryId: null,
    });
    expect(by('POST /api/v1/public/signups')).toMatchObject({
      auth: 'public',
      action: null,
      roles: 'anyone',
      body: 'signupSchema',
      status: 201,
      response: { kind: 'key', key: 'ok', literal: 'true' },
    });
    expect(by('GET /api/health')).toMatchObject({ auth: 'public', action: null, body: null });
    expect(by('DELETE /api/v1/session')).toMatchObject({
      roles: 'any signed-in role',
      status: 204,
      response: { kind: 'empty' },
    });
    expect(by('GET /api/v1/nested/{slug}/items/{itemId}').params).toEqual(['slug', 'itemId']);
  });

  it('marks an action missing from the permission table', async () => {
    const rest = { ...PERMISSIONS };
    delete rest['thing.update'];
    const rows = await build(rest);
    expect(rows.find((r) => r.method === 'PATCH').roles).toBe('unknown action');
  });
});

describe('renderInventory', () => {
  it('is stable and has one row per endpoint', async () => {
    const rows = await build();
    const a = renderInventory(rows);
    expect(renderInventory(await build())).toBe(a);
    expect(a.split('\n')).toHaveLength(rows.length + 2);
    expect(a).toContain(
      '| PATCH | `/api/v1/things/{id}` | session | `thing.update` | super_admin (all) | `thingPatchSchema` |',
    );
  });
});

describe('checkDoc', () => {
  it('passes on a freshly rendered doc', async () => {
    const rows = await build();
    expect(checkDoc(renderDoc(TEMPLATE, rows), rows)).toEqual([]);
  });

  it('accepts CRLF line endings', async () => {
    const rows = await build();
    expect(checkDoc(renderDoc(TEMPLATE, rows).replace(/\n/g, '\r\n'), rows)).toEqual([]);
  });

  it('fails when the block is stale', async () => {
    const rows = await build();
    const doc = renderDoc(TEMPLATE, rows.slice(1));
    expect(checkDoc(doc, rows)).toContain('generated blocks are stale');
  });

  it('fails and names the heading when a section is missing', async () => {
    const rows = await build();
    const noEndpointsBlock = [`# API`, '', INVENTORY_START, INVENTORY_END, ''].join('\n');
    const doc = renderDoc(noEndpointsBlock, rows);
    const problems = checkDoc(doc + '\n### GET /api/health\n', rows);
    expect(problems.join('\n')).toContain('### PATCH /api/v1/things/{id}');
    expect(problems.join('\n')).not.toContain('  ### GET /api/health');
  });

  it('fails on an unknown action', async () => {
    const rest = { ...PERMISSIONS };
    delete rest['thing.update'];
    const rows = await build(rest);
    expect(checkDoc(renderDoc(TEMPLATE, rows), rows).join('\n')).toContain(
      'missing from the permission table: thing.update',
    );
  });

  it('fails when the markers are missing', async () => {
    expect(checkDoc('# API\n', await build())[0]).toMatch(/markers/);
  });
});

describe('CLI', () => {
  function run(...args) {
    try {
      execFileSync(process.execPath, [script, ...args], {
        cwd: repoRoot,
        stdio: 'pipe',
        env: { ...process.env, API_DOC_ROOT: tmp },
      });
      return 0;
    } catch (error) {
      return error.status;
    }
  }

  it('writes the doc, then --check passes, then fails after a route change', () => {
    const doc = path.join(tmp, 'docs', 'api.md');
    mkdirSync(path.dirname(doc), { recursive: true });
    writeFileSync(doc, TEMPLATE);
    expect(run('--check')).toBe(1);
    expect(run()).toBe(0);
    expect(readFileSync(doc, 'utf8')).toContain('### GET /api/v1/things/{id}');
    expect(run('--check')).toBe(0);
    put(
      `${API}/v1/extra/route.ts`,
      "export const GET = route({ auth: 'session', action: 'thing.read' }, async () => ({}));\n",
    );
    expect(run('--check')).toBe(1);
    rmSync(path.join(tmp, API, 'v1', 'extra'), { recursive: true, force: true });
    expect(run('--check')).toBe(0);
  });
});
