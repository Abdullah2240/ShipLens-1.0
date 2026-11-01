// Smoke test for any running ShipLens: a local container, the E2E compose stack, CI or
// the deployed service. Plain ESM on Node built-ins (global fetch) only.
//
//   BASE_URL=https://<host> SMOKE_DEMO_PASSWORD=<demo password> node scripts/smoke.mjs [--skip shell,pages | --skip-ui]
//
// Prints one PASS / FAIL / SKIPPED line per check and exits 1 on any FAIL. It never
// prints the password, cookies, tokens or hashes.
//
// THROTTLE NOTE: each run records exactly one failed login for the finance demo user
// (the wrong-password check) and one for a random unknown email. Five failures inside 15
// minutes lock an email, so wait 15 minutes before a fifth consecutive run against the
// same environment.
//
// Groups:
//   platform  always on: health, locales, security headers, login/me/logout per demo user,
//             identical login failures, foreign-Origin refusal
//   shell     language switcher links on /en, /ur, /en/login, /ur/login
//   pages     login pages and the account page redirect/session behaviour
// Skip shell or pages only while those screens are not merged on the branch being checked.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEMO_USERS } from '../db/seed/demo-users.mjs';
import { hasLinkWithPrefix, parseHtmlAttrs } from './lib/html-attrs.mjs';

export const SKIPPABLE_GROUPS = Object.freeze(['shell', 'pages']);
const FOREIGN_ORIGIN = 'https://foreign-origin.example.test';
const DEFAULT_HEALTH_WAIT_MS = 90_000;
const DEFAULT_RETRY_DELAY_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/** One printable line for a result. */
export function formatResult(r) {
  const status = r.skipped ? 'SKIPPED' : r.ok ? 'PASS' : 'FAIL';
  return `${status} [${r.group}] ${r.name}${r.detail ? ` - ${r.detail}` : ''}`;
}

/**
 * @param {string[]} argv
 * @returns {{ skip: string[], baseUrl?: string }}
 */
export function parseSmokeArgs(argv) {
  const skip = new Set();
  let baseUrl;
  const addSkip = (list) => {
    for (const group of String(list)
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)) {
      if (!SKIPPABLE_GROUPS.includes(group)) {
        throw new Error(
          `Cannot skip group "${group}"; skippable groups: ${SKIPPABLE_GROUPS.join(', ')}`,
        );
      }
      skip.add(group);
    }
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-ui') SKIPPABLE_GROUPS.forEach((g) => skip.add(g));
    else if (arg === '--skip') addSkip(argv[(i += 1)] ?? '');
    else if (arg.startsWith('--skip=')) addSkip(arg.slice('--skip='.length));
    else if (arg === '--base-url') baseUrl = argv[(i += 1)];
    else if (arg.startsWith('--base-url=')) baseUrl = arg.slice('--base-url='.length);
    else throw new Error(`Unknown option ${arg}`);
  }
  return { skip: SKIPPABLE_GROUPS.filter((g) => skip.has(g)), baseUrl };
}

function setCookieList(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

/** name=value pairs of the cookies a response sets (non-empty values only). */
function cookieHeaderFrom(res) {
  return setCookieList(res)
    .map((c) => c.split(';')[0].trim())
    .filter((pair) => /^[^=]+=.+$/.test(pair))
    .join('; ');
}

async function readJson(res) {
  try {
    return JSON.parse(await res.text());
  } catch {
    return undefined;
  }
}

function roleOf(body) {
  return body?.user?.role ?? body?.data?.user?.role ?? body?.data?.role ?? body?.role;
}

function errorCodeOf(body) {
  return body?.error?.code;
}

function withoutRequestId(value) {
  if (Array.isArray(value)) return value.map(withoutRequestId);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== 'requestId')
        .map(([k, v]) => [k, withoutRequestId(v)]),
    );
  }
  return value;
}

/**
 * Run the smoke checks against baseUrl.
 * @param {{ baseUrl: string, password: string, fetchImpl?: typeof fetch, skip?: string[],
 *   log?: (msg: string) => void, onResult?: (r: object) => void, healthWaitMs?: number,
 *   retryDelayMs?: number, requestTimeoutMs?: number, now?: () => number,
 *   sleep?: (ms: number) => Promise<void> }} options
 * @returns {Promise<{ passed: boolean, results: { group: string, name: string, ok: boolean,
 *   detail: string, skipped?: boolean }[] }>}
 */
export async function checkSmoke({
  baseUrl,
  password,
  fetchImpl = globalThis.fetch,
  skip = [],
  log = () => {},
  onResult = () => {},
  healthWaitMs = DEFAULT_HEALTH_WAIT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const base = new URL(baseUrl);
  const origin = base.origin;
  const https = base.protocol === 'https:';
  const results = [];

  const record = (group, name, ok, detail = '', extra = {}) => {
    const r = { group, name, ok: Boolean(ok), detail, ...extra };
    results.push(r);
    onResult(r);
    return r.ok;
  };

  const request = (pathname, { method = 'GET', cookie, json, headers = {}, redirect } = {}) => {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD' && !('origin' in h)) h.origin = origin;
    if (json !== undefined) h['content-type'] = 'application/json';
    const init = { method, headers: h, redirect: redirect ?? 'follow' };
    if (json !== undefined) init.body = JSON.stringify(json);
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      init.signal = AbortSignal.timeout(requestTimeoutMs);
    }
    return fetchImpl(new URL(pathname, base).toString(), init);
  };

  /** Run one check; an exception is a FAIL with its message (never request data). */
  const check = async (group, name, fn) => {
    try {
      const outcome = await fn();
      const [ok, detail] = Array.isArray(outcome) ? outcome : [outcome, ''];
      return record(group, name, ok, detail);
    } catch (err) {
      return record(group, name, false, err instanceof Error ? err.message : String(err));
    }
  };

  const login = (email, pw, headers) =>
    request('/api/v1/auth/login', { method: 'POST', json: { email, password: pw }, headers });

  const checkLocale = (group, pathname, lang, dir) =>
    check(group, `GET ${pathname} has lang ${lang} dir ${dir}`, async () => {
      const res = await request(pathname);
      const attrs = parseHtmlAttrs(await res.text()) ?? {};
      const ok = res.status === 200 && attrs.lang === lang && attrs.dir === dir;
      return [ok, `status ${res.status}, lang=${attrs.lang ?? '-'} dir=${attrs.dir ?? '-'}`];
    });

  // ---- platform ---------------------------------------------------------------------
  // The first health call waits for a cold start.
  const started = now();
  let health;
  let lastProblem = '';
  for (;;) {
    try {
      health = await request('/api/health');
      if (health.status === 200) break;
      lastProblem = `status ${health.status}`;
    } catch (err) {
      lastProblem = err instanceof Error ? err.message : String(err);
    }
    health = undefined;
    const waited = now() - started;
    if (waited >= healthWaitMs) break;
    log(`waiting for /api/health (${Math.round(waited / 1000)}s, ${lastProblem})`);
    await sleep(retryDelayMs);
  }
  if (!health) {
    record(
      'platform',
      'GET /api/health is 200 ok with no-store',
      false,
      `gave up after ${Math.round(healthWaitMs / 1000)}s: ${lastProblem}`,
    );
    return { passed: false, results };
  }
  {
    const body = await readJson(health);
    const cacheControl = health.headers.get('cache-control') ?? '';
    record(
      'platform',
      'GET /api/health is 200 ok with no-store',
      body?.status === 'ok' && /no-store/i.test(cacheControl),
      `status ${health.status}, cache-control=${cacheControl || '-'}`,
    );
  }

  await check('platform', 'GET /api/health/db is 200', async () => {
    const res = await request('/api/health/db');
    return [res.status === 200, `status ${res.status}`];
  });

  await checkLocale('platform', '/en', 'en', 'ltr');
  await checkLocale('platform', '/ur', 'ur', 'rtl');

  await check('platform', 'GET /en carries the security headers', async () => {
    const res = await request('/en');
    const missing = [];
    if (!res.headers.get('strict-transport-security')) missing.push('Strict-Transport-Security');
    if ((res.headers.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') {
      missing.push('X-Content-Type-Options nosniff');
    }
    if (!res.headers.get('referrer-policy')) missing.push('Referrer-Policy');
    if (!res.headers.get('x-frame-options')) missing.push('X-Frame-Options');
    return [missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : ''];
  });

  for (const user of DEMO_USERS) {
    const who = user.email;
    let cookie = '';
    let setCookie = '';
    const loggedIn = await check('platform', `login ${who} returns role ${user.role}`, async () => {
      const res = await login(who, password);
      const body = await readJson(res);
      cookie = cookieHeaderFrom(res);
      setCookie = setCookieList(res)[0] ?? '';
      const role = roleOf(body);
      const code = errorCodeOf(body);
      return [
        res.status === 200 && role === user.role && Boolean(cookie),
        `status ${res.status}${role ? `, role ${role}` : ''}${code ? `, code ${code}` : ''}`,
      ];
    });
    await check('platform', `session cookie flags for ${who}`, async () => {
      if (!loggedIn) return [false, 'not run: login failed'];
      const missing = [];
      if (!/;\s*httponly\b/i.test(setCookie)) missing.push('HttpOnly');
      if (!/;\s*samesite=lax\b/i.test(setCookie)) missing.push('SameSite=Lax');
      if (https && !/;\s*secure\b/i.test(setCookie)) missing.push('Secure');
      return [missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : ''];
    });
    await check(
      'platform',
      `GET /api/v1/auth/me for ${who} returns role ${user.role}`,
      async () => {
        if (!loggedIn) return [false, 'not run: login failed'];
        const res = await request('/api/v1/auth/me', { cookie });
        const role = roleOf(await readJson(res));
        return [
          res.status === 200 && role === user.role,
          `status ${res.status}${role ? `, role ${role}` : ''}`,
        ];
      },
    );
    await check('platform', `logout ${who} is 2xx`, async () => {
      if (!loggedIn) return [false, 'not run: login failed'];
      const res = await request('/api/v1/auth/logout', { method: 'POST', cookie });
      return [res.status >= 200 && res.status < 300, `status ${res.status}`];
    });
    await check('platform', `GET /api/v1/auth/me after logout for ${who} is 401`, async () => {
      if (!loggedIn) return [false, 'not run: login failed'];
      const res = await request('/api/v1/auth/me', { cookie });
      return [res.status === 401, `status ${res.status}`];
    });
  }

  await check('platform', 'unknown email and wrong password give the same response', async () => {
    const finance = DEMO_USERS.find((u) => u.role === 'finance_reviewer');
    const wrong = await login(finance.email, `${password}-wrong`);
    const wrongBody = await readJson(wrong);
    const unknownEmail = `smoke-${randomBytes(6).toString('hex')}@unknown.example.test`;
    const unknown = await login(unknownEmail, `${password}-wrong`);
    const unknownBody = await readJson(unknown);
    const same =
      wrong.status === unknown.status &&
      JSON.stringify(withoutRequestId(wrongBody)) === JSON.stringify(withoutRequestId(unknownBody));
    const failure = wrong.status >= 400 && wrong.status < 500;
    return [
      same && failure,
      `status ${wrong.status}/${unknown.status}, code ${errorCodeOf(wrongBody) ?? '-'}/${errorCodeOf(unknownBody) ?? '-'}`,
    ];
  });

  await check('platform', 'login with a foreign Origin is refused (403)', async () => {
    const admin = DEMO_USERS.find((u) => u.role === 'super_admin');
    const res = await login(admin.email, password, { origin: FOREIGN_ORIGIN });
    return [res.status === 403, `status ${res.status}`];
  });

  // ---- shell ------------------------------------------------------------------------
  if (skip.includes('shell')) {
    record('shell', 'language switcher links', true, 'skipped on request', { skipped: true });
  } else {
    for (const [pathname, other] of [
      ['/en', '/ur'],
      ['/ur', '/en'],
      ['/en/login', '/ur'],
      ['/ur/login', '/en'],
    ]) {
      await check('shell', `GET ${pathname} links to ${other}`, async () => {
        const res = await request(pathname);
        const html = await res.text();
        return [res.status === 200 && hasLinkWithPrefix(html, other), `status ${res.status}`];
      });
    }
  }

  // ---- pages ------------------------------------------------------------------------
  if (skip.includes('pages')) {
    record('pages', 'login and account pages', true, 'skipped on request', { skipped: true });
  } else {
    await checkLocale('pages', '/en/login', 'en', 'ltr');
    await checkLocale('pages', '/ur/login', 'ur', 'rtl');

    const redirectsToLogin = async (cookie) => {
      const res = await request('/en/account', { cookie, redirect: 'manual' });
      const location = res.headers.get('location') ?? '';
      const ok = res.status >= 300 && res.status < 400 && location.includes('/en/login');
      return [
        ok,
        `status ${res.status}${location ? `, location ${new URL(location, base).pathname}` : ''}`,
      ];
    };
    await check('pages', 'GET /en/account without a session redirects to /en/login', () =>
      redirectsToLogin(undefined),
    );

    const lead = DEMO_USERS.find((u) => u.role === 'branch_lead');
    let cookie = '';
    await check('pages', `GET /en/account as ${lead.email} shows the seeded name`, async () => {
      const res = await login(lead.email, password);
      cookie = cookieHeaderFrom(res);
      if (res.status !== 200 || !cookie) return [false, `login status ${res.status}`];
      const page = await request('/en/account', { cookie, redirect: 'manual' });
      const html = await page.text();
      return [page.status === 200 && html.includes(lead.name), `status ${page.status}`];
    });
    await check('pages', 'GET /en/account after logout redirects to /en/login', async () => {
      if (!cookie) return [false, 'not run: login failed'];
      await request('/api/v1/auth/logout', { method: 'POST', cookie });
      return redirectsToLogin(cookie);
    });
  }

  return { passed: results.every((r) => r.ok), results };
}

async function main() {
  let args;
  try {
    args = parseSmokeArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const baseUrl = args.baseUrl ?? process.env.BASE_URL;
  const password = process.env.SMOKE_DEMO_PASSWORD;
  if (!baseUrl) {
    console.error('BASE_URL (or --base-url) is required');
    return 2;
  }
  if (!password) {
    console.error("SMOKE_DEMO_PASSWORD is required (the demo users' password)");
    return 2;
  }
  console.log(`smoke: checking ${new URL(baseUrl).origin}`);
  const { passed, results } = await checkSmoke({
    baseUrl,
    password,
    skip: args.skip,
    log: (m) => console.log(m),
    onResult: (r) => console.log(formatResult(r)),
  });
  const failures = results.filter((r) => !r.ok).length;
  console.log(
    passed ? `smoke: all ${results.length} checks passed` : `smoke: ${failures} check(s) failed`,
  );
  return passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
