// Security header check for any running ShipLens: the production image in Docker, CI or
// the deployed service. Plain ESM on Node built-ins (global fetch) only.
//
//   BASE_URL=http://localhost:3100 node scripts/check-headers.mjs [--mode static]
//
// Prints one PASS / FAIL / SKIPPED line per check and exits 1 on any FAIL.
//
// Nonce mode (default) proves the per-request CSP from src/proxy.ts: script-src carries
// a nonce and 'strict-dynamic' and no 'unsafe-inline', the nonce changes on every
// request, and every <script> tag in the HTML carries that response's nonce. Static mode
// is for the documented fallback policy ('unsafe-inline' scripts, no nonce) and still
// requires every other directive and header. /en/verify is SKIPPED while it returns 404.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODES = Object.freeze(['nonce', 'static']);
const PAGES = ['/en', '/ur', '/en/verify'];
const OPTIONAL_PAGES = new Set(['/en/verify']);
const REQUEST_TIMEOUT_MS = 20_000;

/** One printable line for a result. */
export function formatResult(r) {
  const status = r.skipped ? 'SKIPPED' : r.ok ? 'PASS' : 'FAIL';
  return `${status} ${r.name}${r.detail ? ` - ${r.detail}` : ''}`;
}

/** CSP directives by name (lower case), each as its list of source tokens. */
export function parseCsp(value) {
  const directives = new Map();
  for (const part of String(value ?? '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/** The nonce from a script-src list, or null. */
function nonceFrom(scriptSrc) {
  for (const source of scriptSrc ?? []) {
    const match = /^'nonce-([^']+)'$/.exec(source);
    if (match) return match[1];
  }
  return null;
}

/** Every <script ...> opening tag in the HTML with its nonce attribute (or null). */
export function scriptTags(html) {
  const tags = [];
  for (const m of String(html).matchAll(/<script\b[^>]*>/gi)) {
    const attr = /\snonce\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[0]);
    tags.push({ tag: m[0], nonce: attr ? (attr[1] ?? attr[2] ?? attr[3] ?? '') : null });
  }
  return tags;
}

function hasSources(directives, name, required) {
  const sources = directives.get(name);
  return !!sources && required.every((s) => sources.includes(s));
}

const short = (text, max = 120) => (text.length > max ? `${text.slice(0, max)}...` : text);

/**
 * @param {{ baseUrl: string, fetchImpl?: typeof fetch, mode?: 'nonce' | 'static' }} options
 * @returns {Promise<{ passed: boolean, results: { name: string, ok: boolean, detail?: string, skipped?: boolean }[] }>}
 */
export async function checkHeaders({ baseUrl, fetchImpl = fetch, mode = 'nonce' }) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}"; use ${MODES.join(' or ')}`);
  const base = String(baseUrl).replace(/\/+$/, '');
  const results = [];
  const record = (name, ok, detail) =>
    results.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });

  const get = (pathname, init = {}) =>
    fetchImpl(`${base}${pathname}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  /** Runs `fn`; a thrown error becomes a FAIL line with that name. */
  const attempt = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      record(name, false, err instanceof Error ? err.message : String(err));
      return undefined;
    }
  };

  const checkSharedHeaders = (label, res) => {
    const h = (n) => res.headers.get(n) ?? '';
    record(
      `${label}: Strict-Transport-Security`,
      /max-age=\d+/.test(h('strict-transport-security')),
      h('strict-transport-security') || 'missing',
    );
    record(
      `${label}: X-Content-Type-Options nosniff`,
      h('x-content-type-options').toLowerCase() === 'nosniff',
      h('x-content-type-options') || 'missing',
    );
    record(`${label}: Referrer-Policy`, !!h('referrer-policy'), h('referrer-policy') || 'missing');
    record(
      `${label}: X-Frame-Options DENY`,
      h('x-frame-options').toUpperCase() === 'DENY',
      h('x-frame-options') || 'missing',
    );
    record(
      `${label}: Permissions-Policy`,
      !!h('permissions-policy'),
      h('permissions-policy') || 'missing',
    );
    record(
      `${label}: Cross-Origin-Opener-Policy same-origin`,
      h('cross-origin-opener-policy') === 'same-origin',
      h('cross-origin-opener-policy') || 'missing',
    );
    record(
      `${label}: Cross-Origin-Resource-Policy same-origin`,
      h('cross-origin-resource-policy') === 'same-origin',
      h('cross-origin-resource-policy') || 'missing',
    );
    record(
      `${label}: no X-Powered-By`,
      !res.headers.has('x-powered-by'),
      res.headers.get('x-powered-by') ?? undefined,
    );
  };

  /** Checks one page; returns its nonce (nonce mode) for the freshness check. */
  const checkPage = async (pathname) => {
    const res = await attempt(`${pathname}: GET`, () => get(pathname));
    if (!res) return null;
    if (res.status === 404 && OPTIONAL_PAGES.has(pathname)) {
      results.push({
        name: `${pathname}: page`,
        ok: true,
        skipped: true,
        detail: 'returned 404 (page not merged yet)',
      });
      return null;
    }
    const html = await res.text();
    record(`${pathname}: status 200`, res.status === 200, `status ${res.status}`);

    const csp = res.headers.get('content-security-policy');
    record(`${pathname}: Content-Security-Policy present`, !!csp, csp ? undefined : 'missing');
    const directives = parseCsp(csp);
    const scriptSrc = directives.get('script-src') ?? [];
    const nonce = nonceFrom(scriptSrc);

    if (mode === 'nonce') {
      record(
        `${pathname}: script-src uses a nonce and strict-dynamic`,
        !!nonce && scriptSrc.includes("'strict-dynamic'") && !scriptSrc.includes("'unsafe-inline'"),
        `script-src ${scriptSrc.join(' ') || '(missing)'}`,
      );
    } else {
      record(
        `${pathname}: script-src present (static mode)`,
        scriptSrc.includes("'self'"),
        `script-src ${scriptSrc.join(' ') || '(missing)'}`,
      );
    }

    const hardening = [
      ['object-src', ["'none'"]],
      ['base-uri', ["'self'"]],
      ['frame-ancestors', ["'none'"]],
      ['form-action', ["'self'"]],
    ];
    const missing = hardening
      .filter(([n, s]) => !hasSources(directives, n, s))
      .map(([n, s]) => `${n} ${s.join(' ')}`);
    record(
      `${pathname}: CSP hardening directives`,
      missing.length === 0,
      missing.length ? `missing ${missing.join(', ')}` : undefined,
    );

    if (mode === 'nonce') {
      const tags = scriptTags(html);
      const bad = tags.filter((t) => !nonce || t.nonce !== nonce);
      record(
        `${pathname}: every script tag carries the nonce`,
        tags.length > 0 && bad.length === 0,
        tags.length === 0
          ? 'no script tags found'
          : bad.length
            ? `${bad.length} of ${tags.length} without it, first: ${short(bad[0].tag)}`
            : `${tags.length} script tags`,
      );
    }

    checkSharedHeaders(pathname, res);
    return nonce;
  };

  const nonces = [];
  for (const pathname of PAGES) {
    const nonce = await checkPage(pathname);
    if (pathname === '/en') nonces.push(nonce);
  }

  if (mode === 'nonce') {
    const name = '/en: nonce changes on every request';
    const second = await attempt(name, async () => {
      const res = await get('/en');
      await res.text();
      return nonceFrom(parseCsp(res.headers.get('content-security-policy')).get('script-src'));
    });
    if (second !== undefined) {
      const [first] = nonces;
      record(
        name,
        !!first && !!second && first !== second,
        first && first === second ? 'same nonce twice' : undefined,
      );
    }
  }

  const api = await attempt('/api/health: GET', () => get('/api/health'));
  if (api) {
    await api.text();
    const directives = parseCsp(api.headers.get('content-security-policy'));
    record(
      "/api/health: Content-Security-Policy default-src 'none'",
      hasSources(directives, 'default-src', ["'none'"]) &&
        hasSources(directives, 'frame-ancestors', ["'none'"]),
      api.headers.get('content-security-policy') ?? 'missing',
    );
    record(
      '/api/health: X-Content-Type-Options nosniff',
      (api.headers.get('x-content-type-options') ?? '').toLowerCase() === 'nosniff',
      api.headers.get('x-content-type-options') ?? 'missing',
    );
    record(
      '/api/health: Cache-Control no-store',
      /\bno-store\b/i.test(api.headers.get('cache-control') ?? ''),
      api.headers.get('cache-control') ?? 'missing',
    );
  }

  const root = await attempt('/: redirects to a locale', () => get('/', { redirect: 'manual' }));
  if (root) {
    await root.text().catch(() => '');
    const location = root.headers.get('location') ?? '';
    let target = '';
    try {
      target = new URL(location, `${base}/`).pathname;
    } catch {
      target = '';
    }
    record(
      '/: redirects to a locale',
      root.status >= 300 && root.status < 400 && /^\/(en|ur)(?:\/|$)/.test(target),
      `status ${root.status}${location ? ` to ${location}` : ''}`,
    );
  }

  return { passed: results.every((r) => r.ok || r.skipped), results };
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  let mode = 'nonce';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode') mode = argv[(i += 1)] ?? '';
    else if (arg.startsWith('--mode=')) mode = arg.slice('--mode='.length);
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!MODES.includes(mode)) throw new Error(`--mode must be ${MODES.join(' or ')}`);
  return { mode };
}

async function main() {
  const { mode } = parseArgs(process.argv.slice(2));
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl || !/^https?:\/\/[^/\s]+/.test(baseUrl)) {
    throw new Error('BASE_URL must be set to the app origin, for example http://localhost:3100');
  }
  console.log(`Checking security headers at ${baseUrl} (${mode} mode)`);
  const { passed, results } = await checkHeaders({ baseUrl, mode });
  for (const r of results) console.log(formatResult(r));
  const failures = results.filter((r) => !r.ok && !r.skipped).length;
  console.log(
    passed
      ? `All ${results.length} checks passed.`
      : `${failures} of ${results.length} checks failed.`,
  );
  return passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
