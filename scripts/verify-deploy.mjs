// Post-deploy verification for a running ShipLens: the live Render service or the local
// Docker stack. Plain ESM on Node built-ins (global fetch) only.
//
//   BASE_URL=https://<host> SMOKE_DEMO_PASSWORD=<demo password> \
//     node scripts/verify-deploy.mjs [--allow-no-approved] [--markdown]
//
// Prints one PASS / FAIL / SKIPPED line per check and exits 1 on any FAIL. It never
// prints the password, cookies or tokens, and never prints a demo user's name or email
// found where it should not be (the check is named instead).
//
// Groups:
//   health   first /api/health with retry up to 90 s (records the cold-start time), /api/health/db
//   smoke    every check of scripts/smoke.mjs (five logins, logout, cookies, locales)
//   headers  every check of scripts/check-headers.mjs (security headers, CSP nonce)
//   chain    Super Admin -> GET /api/v1/audit/chain?fresh=1 -> status 'intact'
//   verify   Finance Reviewer -> one approved report -> its verification link -> public API
//            (no cookie) and the /en and /ur public pages: integrity, seal, lang/dir,
//            robots noindex, and no demo user's name or email anywhere
//
// THROTTLE NOTE: the smoke group records one failed login for the finance demo user per
// run; see scripts/smoke.mjs. The public verify API allows 30 requests a minute per
// address and this script makes one.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEMO_USERS } from '../db/seed/demo-users.mjs';
import { checkHeaders } from './check-headers.mjs';
import { parseHtmlAttrs } from './lib/html-attrs.mjs';
import { checkSmoke } from './smoke.mjs';

export const GROUPS = Object.freeze(['health', 'smoke', 'headers', 'chain', 'verify']);
const DEFAULT_HEALTH_WAIT_MS = 90_000;
const DEFAULT_RETRY_DELAY_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

const NO_APPROVED_INSTRUCTION =
  'no approved report found: run the demo seed or approve one weekly report as the Finance ' +
  'Reviewer, then rerun (or pass --allow-no-approved to skip these checks)';

/** One printable line for a result. */
export function formatResult(r) {
  const status = r.ok === 'skipped' ? 'SKIPPED' : r.ok ? 'PASS' : 'FAIL';
  return `${status} [${r.group}] ${r.name}${r.detail ? ` - ${r.detail}` : ''}`;
}

/** @param {string[]} argv */
export function parseVerifyArgs(argv) {
  const out = { allowNoApproved: false, markdown: false };
  for (const arg of argv) {
    if (arg === '--allow-no-approved') out.allowNoApproved = true;
    else if (arg === '--markdown') out.markdown = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return out;
}

function setCookieList(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
}

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

/** Keys (never values) of the demo users whose name or email appears in the text. */
export function personalDataIn(text) {
  const haystack = String(text).toLowerCase();
  return DEMO_USERS.filter(
    (u) => haystack.includes(u.email.toLowerCase()) || haystack.includes(u.name.toLowerCase()),
  ).map((u) => u.key);
}

/** True when a <meta name="robots"> tag carries noindex (any attribute order). */
export function hasRobotsNoindex(html) {
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (
      /\bname\s*=\s*["']?robots["']?/i.test(tag) &&
      /\bcontent\s*=\s*["'][^"']*noindex/i.test(tag)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @param {{ baseUrl: string, password: string, fetchImpl?: typeof fetch,
 *   allowNoApproved?: boolean, now?: () => number, sleep?: (ms: number) => Promise<void>,
 *   healthWaitMs?: number, retryDelayMs?: number, requestTimeoutMs?: number,
 *   headerMode?: 'nonce' | 'static', log?: (msg: string) => void,
 *   onResult?: (r: object) => void }} options
 * @returns {Promise<{ passed: boolean, coldStartMs: number | null,
 *   results: { group: string, name: string, ok: true | false | 'skipped', detail: string }[],
 *   markdown: string }>}
 */
export async function verifyDeploy({
  baseUrl,
  password,
  fetchImpl = globalThis.fetch,
  allowNoApproved = false,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  healthWaitMs = DEFAULT_HEALTH_WAIT_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  headerMode = 'nonce',
  log = () => {},
  onResult = () => {},
}) {
  const base = new URL(baseUrl);
  const origin = base.origin;
  const startedAt = now();
  const results = [];
  // Last line of defence: no detail ever carries the password, even if a server echoes it.
  const scrub = (text) =>
    password
      ? String(text ?? '')
          .split(password)
          .join('[redacted]')
      : String(text ?? '');

  const record = (group, name, ok, detail = '') => {
    const r = {
      group,
      name,
      ok: ok === 'skipped' ? 'skipped' : Boolean(ok),
      detail: scrub(detail),
    };
    results.push(r);
    onResult(r);
    return r.ok === true;
  };

  const request = (pathname, { method = 'GET', cookie } = {}) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD') headers.origin = origin;
    const init = { method, headers, redirect: 'follow' };
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      init.signal = AbortSignal.timeout(requestTimeoutMs);
    }
    return fetchImpl(new URL(pathname, base).toString(), init);
  };

  const check = async (group, name, fn) => {
    try {
      const outcome = await fn();
      const [ok, detail] = Array.isArray(outcome) ? outcome : [outcome, ''];
      return record(group, name, ok, detail);
    } catch (err) {
      return record(group, name, false, err instanceof Error ? err.message : String(err));
    }
  };

  /** Logs in a demo user by role; returns the session cookie or '' (with a FAIL recorded). */
  const loginAs = async (group, role) => {
    const user = DEMO_USERS.find((u) => u.role === role);
    let cookie = '';
    await check(group, `login as ${role}`, async () => {
      const res = await fetchImpl(new URL('/api/v1/auth/login', base).toString(), {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email, password }),
        ...(AbortSignal.timeout ? { signal: AbortSignal.timeout(requestTimeoutMs) } : {}),
      });
      await res.text().catch(() => '');
      cookie = cookieHeaderFrom(res);
      return [res.status === 200 && Boolean(cookie), `status ${res.status}`];
    });
    return cookie;
  };

  const logout = async (cookie) => {
    if (!cookie) return;
    try {
      const res = await request('/api/v1/auth/logout', { method: 'POST', cookie });
      await res.text().catch(() => '');
    } catch {
      // Best effort: the session expires on its own.
    }
  };

  // ---- health -----------------------------------------------------------------------
  let coldStartMs = null;
  {
    const started = now();
    let attempts = 0;
    let lastProblem = '';
    for (;;) {
      attempts += 1;
      try {
        const res = await request('/api/health');
        const body = await readJson(res);
        if (res.status === 200 && body?.status === 'ok') {
          coldStartMs = now() - started;
          break;
        }
        lastProblem = `status ${res.status}`;
      } catch (err) {
        lastProblem = err instanceof Error ? err.message : String(err);
      }
      const waited = now() - started;
      if (waited >= healthWaitMs) break;
      log(`waiting for /api/health (${Math.round(waited / 1000)} s, ${lastProblem})`);
      await sleep(retryDelayMs);
    }
    if (coldStartMs === null) {
      record(
        'health',
        'GET /api/health answers 200 ok (cold start)',
        false,
        `gave up after ${Math.round(healthWaitMs / 1000)} s: ${lastProblem}`,
      );
      for (const group of GROUPS.slice(1)) {
        record(group, `${group} checks`, false, 'not run: the service never became healthy');
      }
      return finish();
    }
    record(
      'health',
      'GET /api/health answers 200 ok (cold start)',
      true,
      `ready after ${coldStartMs} ms (${attempts} attempt${attempts === 1 ? '' : 's'})`,
    );
    await check('health', 'GET /api/health/db is 200', async () => {
      const res = await request('/api/health/db');
      await res.text().catch(() => '');
      return [res.status === 200, `status ${res.status}`];
    });
  }

  // ---- smoke (scripts/smoke.mjs) ----------------------------------------------------
  try {
    const smoke = await checkSmoke({
      baseUrl: base.toString(),
      password,
      fetchImpl,
      log,
      now,
      sleep,
      healthWaitMs,
      retryDelayMs,
      requestTimeoutMs,
    });
    for (const r of smoke.results) {
      record('smoke', `${r.group}: ${r.name}`, r.skipped ? 'skipped' : r.ok, r.detail);
    }
  } catch (err) {
    record('smoke', 'smoke checks', false, err instanceof Error ? err.message : String(err));
  }

  // ---- headers (scripts/check-headers.mjs) ------------------------------------------
  try {
    const headers = await checkHeaders({ baseUrl: origin, fetchImpl, mode: headerMode });
    for (const r of headers.results) {
      record('headers', r.name, r.skipped ? 'skipped' : r.ok, r.detail ?? '');
    }
  } catch (err) {
    record('headers', 'header checks', false, err instanceof Error ? err.message : String(err));
  }

  // ---- chain ------------------------------------------------------------------------
  {
    const cookie = await loginAs('chain', 'super_admin');
    await check('chain', 'GET /api/v1/audit/chain?fresh=1 is intact', async () => {
      if (!cookie) return [false, 'not run: login failed'];
      const res = await request('/api/v1/audit/chain?fresh=1', { cookie });
      const status = (await readJson(res))?.data;
      if (res.status !== 200) return [false, `status ${res.status}`];
      if (status?.status === 'intact') {
        return [true, `${status.checkedEvents} events checked, head #${status.head?.chainSeq}`];
      }
      if (status?.status === 'broken') {
        const at = status.brokenAt ?? {};
        return [false, `broken at event #${at.chainSeq} (${at.reason ?? 'unknown reason'})`];
      }
      return [false, `status ${status?.status ?? 'missing'}`];
    });
    await logout(cookie);
  }

  // ---- verify -----------------------------------------------------------------------
  await (async () => {
    const cookie = await loginAs('verify', 'finance_reviewer');
    if (!cookie) {
      record('verify', 'public verification checks', false, 'not run: login failed');
      return;
    }
    let reportId;
    let link;
    try {
      await check('verify', 'an approved report exists', async () => {
        const res = await request('/api/v1/reports?status=approved&limit=1', { cookie });
        const page = (await readJson(res))?.data;
        if (res.status !== 200) return [false, `status ${res.status}`];
        reportId = page?.items?.[0]?.id;
        if (reportId) return [true, `${page.total ?? '?'} approved`];
        if (allowNoApproved) return ['skipped', 'none found (--allow-no-approved)'];
        return [false, NO_APPROVED_INSTRUCTION];
      });
      // No approved report: that check already says FAIL (or SKIPPED); the rest cannot run.
      if (!reportId) return;
      await check('verify', 'authorised verification link has a code and seal', async () => {
        const res = await request(`/api/v1/reports/${encodeURIComponent(reportId)}/verification`, {
          cookie,
        });
        link = (await readJson(res))?.data;
        const ok =
          res.status === 200 &&
          typeof link?.code === 'string' &&
          typeof link?.seal === 'string' &&
          typeof link?.path === 'string' &&
          link.path.startsWith('/verify/');
        return [ok, `status ${res.status}${link?.code ? `, code ${link.code}` : ''}`];
      });
    } finally {
      await logout(cookie);
    }
    if (!link?.code || !link?.path?.startsWith('/verify/')) return;

    // Public API, without any cookie.
    let api;
    let apiText = '';
    const fetched = await check('verify', 'public API answers 200 without a session', async () => {
      const res = await request(`/api/v1/public${link.path}`);
      apiText = await res.text();
      try {
        api = JSON.parse(apiText)?.data;
      } catch {
        api = undefined;
      }
      return [res.status === 200 && Boolean(api), `status ${res.status}`];
    });
    if (fetched) {
      record(
        'verify',
        'public API: integrity verified',
        api.integrity === 'verified',
        `integrity ${api.integrity ?? 'missing'}`,
      );
      record(
        'verify',
        'public API: seal matches the authorised seal',
        api.sealCheck === 'match' && api.anchor?.seal === link.seal,
        `sealCheck ${api.sealCheck ?? 'missing'}, anchor ${api.anchor?.seal === link.seal ? 'same' : 'different'}`,
      );
      const leaks = personalDataIn(apiText);
      record(
        'verify',
        'public API: no personal data',
        leaks.length === 0,
        leaks.length ? `found identifiers of demo users: ${leaks.join(', ')}` : '',
      );
    }

    // Public pages in both languages.
    for (const [locale, dir] of [
      ['en', 'ltr'],
      ['ur', 'rtl'],
    ]) {
      const label = `/${locale}/verify page`;
      let html = '';
      const loaded = await check(
        'verify',
        `${label}: 200 with lang ${locale} dir ${dir}`,
        async () => {
          const res = await request(`/${locale}${link.path}`);
          html = await res.text();
          const attrs = parseHtmlAttrs(html) ?? {};
          return [
            res.status === 200 && attrs.lang === locale && attrs.dir === dir,
            `status ${res.status}, lang=${attrs.lang ?? '-'} dir=${attrs.dir ?? '-'}`,
          ];
        },
      );
      if (!loaded && !html) continue;
      record('verify', `${label}: robots noindex`, hasRobotsNoindex(html), '');
      const leaks = personalDataIn(html);
      record(
        'verify',
        `${label}: no personal data`,
        leaks.length === 0,
        leaks.length ? `found identifiers of demo users: ${leaks.join(', ')}` : '',
      );
    }
  })();

  return finish();

  function finish() {
    const passed = results.every((r) => r.ok !== false);
    return {
      passed,
      coldStartMs,
      results,
      markdown: buildMarkdown({ results, passed, origin, at: startedAt, coldStartMs }),
    };
  }
}

function buildMarkdown({ results, passed, origin, at, coldStartMs }) {
  const count = (list, value) => list.filter((r) => r.ok === value).length;
  const stamp = new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    `### Post-deploy verification, ${stamp}`,
    '',
    `- Base URL: ${origin}`,
    `- Result: ${passed ? 'PASS' : 'FAIL'} (${count(results, true)} passed, ${count(results, false)} failed, ${count(results, 'skipped')} skipped)`,
    `- Cold start: ${coldStartMs === null ? 'not reached' : `${coldStartMs} ms`}`,
    '',
    '| Group | Passed | Failed | Skipped | Result |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const group of GROUPS) {
    const list = results.filter((r) => r.group === group);
    const failed = count(list, false);
    const result = failed ? 'FAIL' : count(list, true) ? 'PASS' : 'SKIPPED';
    lines.push(
      `| ${group} | ${count(list, true)} | ${failed} | ${count(list, 'skipped')} | ${result} |`,
    );
  }
  const failures = results.filter((r) => r.ok === false);
  if (failures.length) {
    lines.push('', 'Failed checks:');
    for (const r of failures) lines.push(`- ${formatResult(r)}`);
  }
  return lines.join('\n');
}

async function main() {
  let args;
  try {
    args = parseVerifyArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  const baseUrl = process.env.BASE_URL;
  const password = process.env.SMOKE_DEMO_PASSWORD;
  if (!baseUrl || !/^https?:\/\/[^/\s]+/.test(baseUrl)) {
    console.error('BASE_URL must be set to the app origin, for example https://<host>');
    return 2;
  }
  if (!password) {
    console.error("SMOKE_DEMO_PASSWORD is required (the demo users' password)");
    return 2;
  }
  console.log(`verify-deploy: checking ${new URL(baseUrl).origin}`);
  const report = await verifyDeploy({
    baseUrl,
    password,
    allowNoApproved: args.allowNoApproved,
    log: (m) => console.log(m),
    onResult: (r) => console.log(formatResult(r)),
  });
  const failures = report.results.filter((r) => r.ok === false).length;
  console.log(
    report.passed
      ? `verify-deploy: all ${report.results.length} checks passed`
      : `verify-deploy: ${failures} of ${report.results.length} checks failed`,
  );
  if (args.markdown) console.log(`\n${report.markdown}`);
  return report.passed ? 0 : 1;
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
