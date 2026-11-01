import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEMO_USERS } from '../db/seed/demo-users.mjs';
import { formatResult, parseVerifyArgs, verifyDeploy } from './verify-deploy.mjs';

const BASE = 'https://shiplens.example.test';
const PASSWORD = 'verify-test-password-0';
const TOKEN_PREFIX = 'tok-secret-';
const CODE = 'AB2CD-EF3GH';
const SEAL = '0123456789abcdef';
const REPORT_ID = '11111111-2222-3333-4444-555555555555';

const PAGE_HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

const csp = (nonce) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

/**
 * In-memory stand-in for a healthy deployment: health, the smoke and header checks, the
 * audit chain, the report list, the verification link and the public verify API and
 * pages. Each option breaks one thing so a test can prove the script notices it.
 */
function fakeApp(opts = {}) {
  const sessions = new Map();
  const users = new Map(DEMO_USERS.map((u) => [u.email, u]));
  const origin = new URL(BASE).origin;
  let counter = 0;
  const calls = [];

  const json = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
        ...headers,
      },
    });
  const err = (status, code) =>
    json(status, { error: { code, message: code, requestId: `req-${(counter += 1)}` } });
  const page = (lang, body = '', head = '') => {
    counter += 1;
    const nonce = Buffer.from(`nonce-${counter}`).toString('base64');
    const dir = lang === 'ur' ? 'rtl' : 'ltr';
    return new Response(
      `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head>${head}<script nonce="${nonce}" src="/a.js"></script></head><body>${body}</body></html>`,
      {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'content-security-policy': csp(nonce),
          ...PAGE_HEADERS,
        },
      },
    );
  };
  const sessionUser = (init) => {
    const cookie = new Headers(init?.headers).get('cookie') ?? '';
    const token = /shiplens_session=([^;]+)/.exec(cookie)?.[1];
    return token ? sessions.get(token) : undefined;
  };

  const verifyBody = () => ({
    code: CODE,
    branch: { name: 'Sample Branch (Demo)', city: 'Karachi' },
    weekStart: '2026-10-19',
    weekEnd: '2026-10-25',
    approvedTotal: '125000.00',
    collectionCount: 12,
    approvedOn: '2026-10-27',
    integrity: opts.integrity ?? 'verified',
    anchor: { chainSeq: 42, seal: SEAL },
    sealCheck: opts.sealCheck ?? 'match',
    chain: { status: 'intact', checkedEvents: 120, brokenAtSeq: null, checkedAt: 'x' },
    ...(opts.apiLeak ? { approvedBy: 'Bilal Ahmed' } : {}),
  });
  const verifyPage = (lang) => {
    const robots = opts.noRobots ? '' : '<meta name="robots" content="noindex, nofollow"/>';
    const leak = opts.pageLeak ? `<p>${DEMO_USERS[1].email}</p>` : '';
    return page(lang, `<h1>${CODE}</h1>${leak}`, robots);
  };

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    calls.push({ method, path: url.pathname, search: url.search, headers });
    if (method === 'POST' && headers.get('origin') !== origin) return err(403, 'forbidden');
    const user = sessionUser(init);

    switch (`${method} ${url.pathname}`) {
      case 'GET /api/health':
        return json(200, { status: 'ok' });
      case 'GET /api/health/db':
        return json(200, { status: 'ok', db: 'up' });
      case 'GET /':
        return new Response(null, { status: 307, headers: { location: `${BASE}/en` } });
      case 'GET /en':
        return page('en', '<a href="/ur">ur</a>');
      case 'GET /ur':
        return page('ur', '<a href="/en">en</a>');
      case 'GET /en/verify':
        return page('en', '<form></form>');
      case 'GET /en/login':
        return page('en', '<a href="/ur/login">ur</a>');
      case 'GET /ur/login':
        return page('ur', '<a href="/en/login">en</a>');
      case 'GET /en/account':
        if (!user) return new Response(null, { status: 307, headers: { location: '/en/login' } });
        return page('en', `<h1>${user.name}</h1>`);
      case 'POST /api/v1/auth/login': {
        const body = JSON.parse(init.body);
        const found = users.get(body.email);
        if (!found || body.password !== PASSWORD) return err(401, 'invalid_credentials');
        const token = `${TOKEN_PREFIX}${(counter += 1)}`;
        sessions.set(token, found);
        return json(
          200,
          { user: { name: found.name, email: found.email, role: found.role } },
          {
            'set-cookie': `shiplens_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          },
        );
      }
      case 'GET /api/v1/auth/me':
        if (!user) return err(401, 'unauthenticated');
        return json(200, { user: { role: user.role } });
      case 'POST /api/v1/auth/logout': {
        const token = /shiplens_session=([^;]+)/.exec(headers.get('cookie') ?? '')?.[1];
        if (token) sessions.delete(token);
        return new Response(null, { status: 204 });
      }
      case 'GET /api/v1/audit/chain': {
        if (!user) return err(401, 'unauthenticated');
        if (user.role !== 'super_admin' && user.role !== 'finance_reviewer') {
          return err(403, 'forbidden');
        }
        if (opts.chainMissing) return err(404, 'not_found');
        const data = opts.chainBroken
          ? {
              status: 'broken',
              checkedEvents: 57,
              brokenAt: { chainSeq: 57, eventId: 'e-57', reason: 'hash_mismatch' },
              checkedAt: 'x',
            }
          : {
              status: 'intact',
              checkedEvents: 120,
              head: { chainSeq: 120, hash: 'h' },
              checkedAt: 'x',
            };
        return json(200, { data });
      }
      case 'GET /api/v1/reports': {
        if (!user) return err(401, 'unauthenticated');
        const items = opts.noApproved ? [] : [{ id: REPORT_ID, status: 'approved' }];
        return json(200, { data: { items, total: items.length } });
      }
      case `GET /api/v1/reports/${REPORT_ID}/verification`:
        if (!user) return err(401, 'unauthenticated');
        return json(200, { data: { code: CODE, path: `/verify/${CODE}?s=${SEAL}`, seal: SEAL } });
      case `GET /api/v1/public/verify/${CODE}`:
        if (headers.get('cookie')) return err(400, 'cookie_sent');
        return json(200, {
          data: {
            ...verifyBody(),
            sealCheck:
              url.searchParams.get('s') === SEAL ? (opts.sealCheck ?? 'match') : 'mismatch',
          },
        });
      case `GET /en/verify/${CODE}`:
        return verifyPage('en');
      case `GET /ur/verify/${CODE}`:
        return verifyPage('ur');
      default:
        return new Response('not found', { status: 404 });
    }
  }
  return { fetchImpl, calls };
}

const failedNames = (report) =>
  report.results.filter((r) => r.ok === false).map((r) => `${r.group}: ${r.name}`);
const byGroup = (report, group) => report.results.filter((r) => r.group === group);
const run = (opts = {}, extra = {}) =>
  verifyDeploy({
    baseUrl: BASE,
    password: PASSWORD,
    fetchImpl: fakeApp(opts).fetchImpl,
    sleep: async () => {},
    ...extra,
  });

describe('verifyDeploy', () => {
  it('passes a healthy deployment and covers every group', async () => {
    const report = await run();
    expect(failedNames(report)).toEqual([]);
    expect(report.passed).toBe(true);
    for (const group of ['health', 'smoke', 'headers', 'chain', 'verify']) {
      expect(byGroup(report, group).length).toBeGreaterThan(0);
    }
    // All five logins are proven through the smoke checks.
    for (const u of DEMO_USERS) {
      expect(byGroup(report, 'smoke').some((r) => r.name.includes(`login ${u.email}`))).toBe(true);
    }
    expect(byGroup(report, 'verify').map((r) => r.name)).toEqual(
      expect.arrayContaining([
        'public API: integrity verified',
        'public API: seal matches the authorised seal',
        'public API: no personal data',
        '/en/verify page: 200 with lang en dir ltr',
        '/ur/verify page: 200 with lang ur dir rtl',
        '/en/verify page: robots noindex',
        '/ur/verify page: no personal data',
      ]),
    );
    expect(report.results.every((r) => [true, false, 'skipped'].includes(r.ok))).toBe(true);
  });

  it('finds the approved report through the list endpoint and calls the public API without a cookie', async () => {
    const app = fakeApp();
    await verifyDeploy({ baseUrl: BASE, password: PASSWORD, fetchImpl: app.fetchImpl });
    const list = app.calls.find((c) => c.path === '/api/v1/reports');
    expect(new URLSearchParams(list.search).get('status')).toBe('approved');
    expect(new URLSearchParams(list.search).get('limit')).toBe('1');
    const chain = app.calls.find((c) => c.path === '/api/v1/audit/chain');
    expect(new URLSearchParams(chain.search).get('fresh')).toBe('1');
    const pub = app.calls.filter((c) => c.path.startsWith('/api/v1/public/verify/'));
    expect(pub).toHaveLength(1);
    expect(pub[0].headers.get('cookie')).toBeNull();
    expect(new URLSearchParams(pub[0].search).get('s')).toBe(SEAL);
    for (const c of app.calls.filter(
      (x) => x.method === 'POST' && x.path !== '/api/v1/auth/login',
    )) {
      expect(c.headers.get('origin')).toBe(BASE);
    }
  });

  it('records the cold-start time when health answers after two failures', async () => {
    const app = fakeApp();
    let t = 0;
    let attempts = 0;
    const fetchImpl = async (input, init) => {
      if (new URL(String(input)).pathname === '/api/health' && (attempts += 1) <= 2) {
        return new Response('starting', { status: 502 });
      }
      return app.fetchImpl(input, init);
    };
    const report = await verifyDeploy({
      baseUrl: BASE,
      password: PASSWORD,
      fetchImpl,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      retryDelayMs: 4_000,
    });
    const cold = byGroup(report, 'health')[0];
    expect(cold.ok).toBe(true);
    expect(cold.detail).toMatch(/8000 ms/);
    expect(report.coldStartMs).toBe(8000);
    expect(report.passed).toBe(true);
  });

  it('fails after 90 s without health and marks the other groups as not run', async () => {
    let t = 0;
    const report = await verifyDeploy({
      baseUrl: BASE,
      password: PASSWORD,
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    expect(report.passed).toBe(false);
    expect(byGroup(report, 'health')[0]).toMatchObject({ ok: false });
    expect(byGroup(report, 'health')[0].detail).toMatch(/90 s/);
    expect(t).toBeGreaterThanOrEqual(90_000);
    for (const group of ['smoke', 'headers', 'chain', 'verify']) {
      expect(byGroup(report, group)).toEqual([
        expect.objectContaining({ ok: false, detail: expect.stringMatching(/not run/) }),
      ]);
    }
  });

  it('fails the chain group with the event number when the chain is broken', async () => {
    const report = await run({ chainBroken: true });
    const chain = byGroup(report, 'chain').find((r) => r.ok === false);
    expect(chain.detail).toMatch(/57/);
    expect(report.passed).toBe(false);
  });

  it('fails the chain group when the route is missing', async () => {
    const report = await run({ chainMissing: true });
    expect(byGroup(report, 'chain').some((r) => r.ok === false && /404/.test(r.detail))).toBe(true);
  });

  it.each([
    ['integrity mismatch', { integrity: 'mismatch' }, 'public API: integrity verified'],
    ['seal mismatch', { sealCheck: 'mismatch' }, 'public API: seal matches the authorised seal'],
    ['a name in the API body', { apiLeak: true }, 'public API: no personal data'],
    ['an email on the page', { pageLeak: true }, '/en/verify page: no personal data'],
    ['no robots noindex', { noRobots: true }, '/ur/verify page: robots noindex'],
  ])('fails on %s', async (_label, opts, name) => {
    const report = await run(opts);
    expect(failedNames(report)).toContain(`verify: ${name}`);
    expect(report.passed).toBe(false);
  });

  it('names the leak check without printing the leaked value', async () => {
    const report = await run({ pageLeak: true, apiLeak: true });
    // Smoke check names carry the demo emails by design; the verify group must not.
    const text = byGroup(report, 'verify').map(formatResult).join('\n') + report.markdown;
    for (const u of DEMO_USERS) {
      expect(text).not.toContain(u.name);
    }
    expect(text).not.toContain(DEMO_USERS[1].email);
  });

  it('fails with an instruction when there is no approved report', async () => {
    const report = await run({ noApproved: true });
    const found = byGroup(report, 'verify').find((r) => r.ok === false);
    expect(found.detail).toMatch(/approve/i);
    expect(found.detail).toMatch(/--allow-no-approved/);
    expect(report.passed).toBe(false);
  });

  it('skips the verify checks when no approved report is allowed', async () => {
    const report = await run({ noApproved: true }, { allowNoApproved: true });
    expect(byGroup(report, 'verify').some((r) => r.ok === 'skipped')).toBe(true);
    expect(byGroup(report, 'verify').some((r) => r.ok === false)).toBe(false);
    expect(report.passed).toBe(true);
  });

  it('never prints the password, cookies or tokens', async () => {
    const lines = [];
    const report = await run(
      { chainBroken: true, noApproved: true },
      { log: (m) => lines.push(m) },
    );
    const text = [
      JSON.stringify(report),
      lines.join('\n'),
      report.results.map(formatResult).join('\n'),
      report.markdown,
    ].join('\n');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(TOKEN_PREFIX);
    expect(text).not.toMatch(/shiplens_session=/);
  });

  it('builds a Markdown block with date, base URL, counts and every group', async () => {
    const report = await run({}, { now: () => Date.parse('2026-11-01T03:04:05Z') });
    expect(report.markdown).toContain('2026-11-01');
    expect(report.markdown).toContain(BASE);
    expect(report.markdown).toMatch(/\d+ passed, 0 failed/);
    for (const group of ['health', 'smoke', 'headers', 'chain', 'verify']) {
      expect(report.markdown).toMatch(new RegExp(`\\| ${group} \\|`));
    }
  });
});

describe('formatResult', () => {
  it('prints PASS, FAIL and SKIPPED lines', () => {
    expect(formatResult({ group: 'g', name: 'n', ok: true, detail: '' })).toBe('PASS [g] n');
    expect(formatResult({ group: 'g', name: 'n', ok: false, detail: 'd' })).toBe('FAIL [g] n - d');
    expect(formatResult({ group: 'g', name: 'n', ok: 'skipped', detail: '' })).toBe(
      'SKIPPED [g] n',
    );
  });
});

describe('parseVerifyArgs', () => {
  it('reads the flags and rejects unknown ones', () => {
    expect(parseVerifyArgs([])).toEqual({ allowNoApproved: false, markdown: false });
    expect(parseVerifyArgs(['--allow-no-approved', '--markdown'])).toEqual({
      allowNoApproved: true,
      markdown: true,
    });
    expect(() => parseVerifyArgs(['--nope'])).toThrow(/--nope/);
  });
});

describe('CLI', () => {
  const script = fileURLToPath(new URL('./verify-deploy.mjs', import.meta.url));
  const exec = promisify(execFile);

  it('exits 2 naming the variable when the password is missing', async () => {
    const env = { ...process.env, BASE_URL: 'http://127.0.0.1:9' };
    delete env.SMOKE_DEMO_PASSWORD;
    const out = await exec(process.execPath, [script], { env }).catch((e) => e);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/SMOKE_DEMO_PASSWORD/);
  });
});
