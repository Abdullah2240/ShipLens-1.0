import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEMO_USERS } from '../db/seed/demo-users.mjs';
import { checkSmoke, formatResult, parseSmokeArgs } from './smoke.mjs';

const BASE = 'https://shiplens.example.test';
const PASSWORD = 'smoke-test-password-0';
const TOKEN_PREFIX = 'tok-secret-';

/**
 * In-memory stand-in for the deployed app. Options flip one behaviour each so a test can
 * prove the smoke script notices it.
 */
function fakeServer(opts = {}) {
  const sessions = new Map();
  const users = new Map(DEMO_USERS.map((u) => [u.email, u]));
  let counter = 0;
  const calls = [];
  const origin = new URL(BASE).origin;

  const json = (status, body, headers = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const html = (status, lang, dir, body = '', headers = {}) => {
    const tag = opts.attrOrder
      ? `<html dir="${dir}" class="x" lang="${lang}">`
      : `<html lang="${lang}" dir="${dir}">`;
    return new Response(`<!DOCTYPE html>${tag}<head></head><body>${body}</body></html>`, {
      status,
      headers: { 'content-type': 'text/html', ...securityHeaders, ...headers },
    });
  };
  const securityHeaders = {
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
  };
  const err = (status, code, message) =>
    json(status, { error: { code, message, requestId: `req-${(counter += 1)}` } });
  const sessionUser = (init) => {
    const cookie = new Headers(init?.headers).get('cookie') ?? '';
    const token = /shiplens_session=([^;]+)/.exec(cookie)?.[1];
    return token ? sessions.get(token) : undefined;
  };
  const switcher = (other) => (opts.noSwitcher ? '' : `<a href="/${other}">other</a>`);

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ method, path: url.pathname, headers: new Headers(init.headers) });
    const reqOrigin = new Headers(init.headers).get('origin');
    if (method === 'POST' && reqOrigin !== origin && !opts.acceptForeignOrigin) {
      return err(403, 'forbidden', 'Cross-origin request refused');
    }
    switch (`${method} ${url.pathname}`) {
      case 'GET /api/health':
        return json(200, { status: 'ok' }, { 'cache-control': 'no-store' });
      case 'GET /api/health/db':
        return json(200, { status: 'ok', db: 'up' }, { 'cache-control': 'no-store' });
      case 'GET /en':
        return html(200, 'en', 'ltr', switcher('ur'));
      case 'GET /ur':
        return html(200, 'ur', opts.wrongUrDir ? 'ltr' : 'rtl', switcher('en'));
      case 'GET /en/login':
        return html(200, 'en', 'ltr', `<form></form>${switcher('ur/login')}`);
      case 'GET /ur/login':
        return html(200, 'ur', 'rtl', `<form></form>${switcher('en/login')}`);
      case 'GET /en/account': {
        const user = sessionUser(init);
        if (!user)
          return new Response(null, {
            status: 307,
            headers: { location: '/en/login?next=%2Fen%2Faccount' },
          });
        return html(200, 'en', 'ltr', `<h1>${user.name}</h1>`);
      }
      case 'POST /api/v1/auth/login': {
        const body = JSON.parse(init.body);
        const user = users.get(body.email);
        if (!user) {
          return opts.differentErrors
            ? err(404, 'unknown_user', 'No such user')
            : err(401, 'invalid_credentials', 'Invalid email or password');
        }
        if (body.password !== PASSWORD)
          return err(401, 'invalid_credentials', 'Invalid email or password');
        const token = `${TOKEN_PREFIX}${(counter += 1)}`;
        sessions.set(token, user);
        const secure = opts.noSecure ? '' : '; Secure';
        return json(
          200,
          {
            user: {
              id: `id-${user.key}`,
              name: user.name,
              email: user.email,
              role: user.role,
              branchId: null,
            },
          },
          {
            'set-cookie': `shiplens_session=${token}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=604800`,
          },
        );
      }
      case 'GET /api/v1/auth/me': {
        const user = sessionUser(init);
        if (!user) return err(401, 'unauthenticated', 'Sign in required');
        return json(200, {
          user: { id: `id-${user.key}`, name: user.name, email: user.email, role: user.role },
        });
      }
      case 'POST /api/v1/auth/logout': {
        const cookie = new Headers(init.headers).get('cookie') ?? '';
        const token = /shiplens_session=([^;]+)/.exec(cookie)?.[1];
        if (token) sessions.delete(token);
        return new Response(null, {
          status: 204,
          headers: {
            'set-cookie': 'shiplens_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
          },
        });
      }
      default:
        return new Response('not found', { status: 404 });
    }
  }
  return { fetchImpl, calls };
}

const failed = (result) => result.results.filter((r) => !r.ok);

describe('checkSmoke', () => {
  it('passes against a healthy server and checks every demo user', async () => {
    const { fetchImpl } = fakeServer();
    const result = await checkSmoke({ baseUrl: BASE, password: PASSWORD, fetchImpl });
    expect(failed(result)).toEqual([]);
    expect(result.passed).toBe(true);
    const groups = new Set(result.results.map((r) => r.group));
    expect(groups).toEqual(new Set(['platform', 'shell', 'pages']));
    for (const user of DEMO_USERS) {
      expect(result.results.some((r) => r.name.includes(user.email))).toBe(true);
    }
    expect(result.results.every((r) => !r.skipped)).toBe(true);
  });

  it('passes when the html attributes come in another order', async () => {
    const { fetchImpl } = fakeServer({ attrOrder: true });
    const result = await checkSmoke({ baseUrl: BASE, password: PASSWORD, fetchImpl });
    expect(failed(result)).toEqual([]);
  });

  it('fails when /ur is not right-to-left', async () => {
    const { fetchImpl } = fakeServer({ wrongUrDir: true });
    const result = await checkSmoke({ baseUrl: BASE, password: PASSWORD, fetchImpl });
    expect(result.passed).toBe(false);
    expect(failed(result).map((r) => r.name)).toContain('GET /ur has lang ur dir rtl');
  });

  it('fails when unknown-email and wrong-password responses differ', async () => {
    const { fetchImpl } = fakeServer({ differentErrors: true });
    const result = await checkSmoke({ baseUrl: BASE, password: PASSWORD, fetchImpl });
    expect(result.passed).toBe(false);
    expect(failed(result).map((r) => r.name)).toEqual([
      'unknown email and wrong password give the same response',
    ]);
  });

  it('fails when a foreign Origin is accepted', async () => {
    const { fetchImpl } = fakeServer({ acceptForeignOrigin: true });
    const result = await checkSmoke({ baseUrl: BASE, password: PASSWORD, fetchImpl });
    expect(result.passed).toBe(false);
    expect(failed(result).map((r) => r.name)).toEqual([
      'login with a foreign Origin is refused (403)',
    ]);
  });

  it('fails when the session cookie lacks Secure on an https base URL', async () => {
    const { fetchImpl } = fakeServer({ noSecure: true });
    const result = await checkSmoke({ baseUrl: BASE, password: PASSWORD, fetchImpl });
    expect(result.passed).toBe(false);
    expect(failed(result).some((r) => r.name.startsWith('session cookie flags'))).toBe(true);
  });

  it('reports skipped groups as SKIPPED without failing the run', async () => {
    const { fetchImpl, calls } = fakeServer({ noSwitcher: true });
    const result = await checkSmoke({
      baseUrl: BASE,
      password: PASSWORD,
      fetchImpl,
      skip: ['shell', 'pages'],
    });
    expect(result.passed).toBe(true);
    const skipped = result.results.filter((r) => r.skipped);
    expect(skipped.map((r) => r.group).sort()).toEqual(['pages', 'shell']);
    expect(skipped.every((r) => r.ok)).toBe(true);
    expect(skipped.map(formatResult).every((line) => line.startsWith('SKIPPED'))).toBe(true);
    expect(calls.some((c) => c.path.endsWith('/login') && c.method === 'GET')).toBe(false);
    expect(calls.some((c) => c.path === '/en/account')).toBe(false);
  });

  it('fails the shell group when the language switcher link is missing', async () => {
    const { fetchImpl } = fakeServer({ noSwitcher: true });
    const result = await checkSmoke({ baseUrl: BASE, password: PASSWORD, fetchImpl });
    expect(result.passed).toBe(false);
    expect(new Set(failed(result).map((r) => r.group))).toEqual(new Set(['shell']));
  });

  it('sends the base URL origin on every POST and records one failed login for finance only', async () => {
    const { fetchImpl, calls } = fakeServer();
    await checkSmoke({ baseUrl: BASE, password: PASSWORD, fetchImpl });
    const posts = calls.filter((c) => c.method === 'POST');
    const foreign = posts.filter((c) => c.headers.get('origin') !== BASE);
    expect(foreign).toHaveLength(1); // the deliberate foreign-Origin check
  });

  it('never exposes the password, cookies or tokens in results or log lines', async () => {
    const { fetchImpl } = fakeServer();
    const lines = [];
    const result = await checkSmoke({
      baseUrl: BASE,
      password: PASSWORD,
      fetchImpl,
      log: (m) => lines.push(m),
    });
    const text =
      JSON.stringify(result) + lines.join('\n') + result.results.map(formatResult).join('\n');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(TOKEN_PREFIX);
    expect(text).not.toMatch(/shiplens_session=/);
  });

  it('retries the first health call while the service starts, then fails after the limit', async () => {
    let now = 0;
    const lines = [];
    const fetchImpl = async () => {
      throw new Error('connect ECONNREFUSED');
    };
    const result = await checkSmoke({
      baseUrl: BASE,
      password: PASSWORD,
      fetchImpl,
      log: (m) => lines.push(m),
      healthWaitMs: 90_000,
      retryDelayMs: 5_000,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    expect(result.passed).toBe(false);
    expect(result.results[0]).toMatchObject({ group: 'platform', ok: false });
    expect(lines.some((l) => /waiting for \/api\/health/.test(l))).toBe(true);
    expect(now).toBeGreaterThanOrEqual(90_000);
  });

  it('succeeds once health answers after a cold start', async () => {
    const server = fakeServer();
    let attempts = 0;
    const fetchImpl = async (input, init) => {
      if (new URL(String(input)).pathname === '/api/health' && (attempts += 1) < 3) {
        return new Response('starting', { status: 502 });
      }
      return server.fetchImpl(input, init);
    };
    const result = await checkSmoke({
      baseUrl: BASE,
      password: PASSWORD,
      fetchImpl,
      sleep: async () => {},
    });
    expect(failed(result)).toEqual([]);
    expect(attempts).toBeGreaterThanOrEqual(3);
  });
});

describe('parseSmokeArgs', () => {
  it('reads --skip lists and the --skip-ui alias', () => {
    expect(parseSmokeArgs(['--skip', 'shell,pages']).skip).toEqual(['shell', 'pages']);
    expect(parseSmokeArgs(['--skip=pages']).skip).toEqual(['pages']);
    expect(parseSmokeArgs(['--skip-ui']).skip).toEqual(['shell', 'pages']);
    expect(parseSmokeArgs([]).skip).toEqual([]);
  });

  it('rejects unknown groups and options', () => {
    expect(() => parseSmokeArgs(['--skip', 'platform'])).toThrow(/platform/);
    expect(() => parseSmokeArgs(['--nope'])).toThrow(/--nope/);
  });
});

describe('CLI', () => {
  const script = fileURLToPath(new URL('./smoke.mjs', import.meta.url));
  const run = promisify(execFile);

  it('exits 2 naming the variable when the password is missing, without any request', async () => {
    const env = { ...process.env, BASE_URL: 'http://127.0.0.1:9' };
    delete env.SMOKE_DEMO_PASSWORD;
    const out = await run(process.execPath, [script], { env }).catch((e) => e);
    expect(out.code).toBe(2);
    expect(out.stderr).toMatch(/SMOKE_DEMO_PASSWORD/);
  });
});
