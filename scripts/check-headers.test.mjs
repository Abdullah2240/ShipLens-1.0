import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { checkHeaders, formatResult } from './check-headers.mjs';

const BASE = 'http://shiplens.example.test';

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

function pageCsp(nonce, opts) {
  const script = opts.unsafeInline
    ? "script-src 'self' 'unsafe-inline'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const directives = [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives
    .filter((d) => !(opts.dropDirective && d.startsWith(opts.dropDirective)))
    .join('; ');
}

/**
 * Fake fetch for a compliant app. Each option breaks one thing so a test can prove the
 * check notices it.
 */
function fakeFetch(opts = {}) {
  let counter = 0;
  const calls = [];
  const impl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    calls.push({ pathname, redirect: init.redirect });

    if (pathname === '/') {
      if (opts.noRedirect)
        return new Response('<html></html>', { status: 200, headers: PAGE_HEADERS });
      return new Response(null, {
        status: 307,
        headers: { ...PAGE_HEADERS, location: `${BASE}/en` },
      });
    }

    if (pathname === '/api/health') {
      const headers = {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'strict-transport-security': PAGE_HEADERS['strict-transport-security'],
      };
      if (!opts.noApiCsp)
        headers['content-security-policy'] = "default-src 'none'; frame-ancestors 'none'";
      return new Response('{"status":"ok"}', { status: 200, headers });
    }

    if (pathname === '/en/verify' && opts.verify404) {
      return new Response('not found', { status: 404, headers: PAGE_HEADERS });
    }

    if (['/en', '/ur', '/en/verify'].includes(pathname)) {
      counter += 1;
      const nonce = opts.sameNonce
        ? 'Zml4ZWQ='
        : Buffer.from(`nonce-${counter}`).toString('base64');
      const headers = { ...PAGE_HEADERS };
      if (!opts.noCsp) headers['content-security-policy'] = pageCsp(nonce, opts);
      if (opts.noHsts) delete headers['strict-transport-security'];
      if (opts.poweredBy) headers['x-powered-by'] = 'Next.js';
      const scripts = [
        `<script src="/_next/static/chunks/main.js" async="" nonce="${nonce}"></script>`,
        `<script nonce='${nonce}'>self.__next_f=self.__next_f||[]</script>`,
      ];
      if (opts.scriptWithoutNonce) scripts.push('<script>alert(1)</script>');
      if (opts.scriptWrongNonce) scripts.push('<script nonce="b3RoZXI=">x()</script>');
      const lang = pathname.startsWith('/ur') ? 'ur' : 'en';
      return new Response(
        `<!DOCTYPE html><html lang="${lang}"><head>${scripts[0]}</head><body>${scripts.slice(1).join('')}</body></html>`,
        { status: 200, headers },
      );
    }

    return new Response('not found', { status: 404 });
  };
  return Object.assign(impl, { calls });
}

const failed = (report) => report.results.filter((r) => !r.ok && !r.skipped).map((r) => r.name);

describe('checkHeaders', () => {
  it('passes a fully compliant app', async () => {
    const report = await checkHeaders({ baseUrl: BASE, fetchImpl: fakeFetch() });
    expect(failed(report)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.results.some((r) => r.skipped)).toBe(false);
    // Every page is covered, with one name per check.
    for (const path of ['/en', '/ur', '/en/verify']) {
      expect(report.results.some((r) => r.name.startsWith(`${path}:`))).toBe(true);
    }
    expect(new Set(report.results.map((r) => r.name)).size).toBe(report.results.length);
  });

  it('asks for the redirect without following it', async () => {
    const fetchImpl = fakeFetch();
    await checkHeaders({ baseUrl: `${BASE}/`, fetchImpl });
    expect(fetchImpl.calls.find((c) => c.pathname === '/')?.redirect).toBe('manual');
  });

  it.each([
    ['missing CSP', { noCsp: true }, '/en: Content-Security-Policy present'],
    [
      "'unsafe-inline' in script-src",
      { unsafeInline: true },
      '/en: script-src uses a nonce and strict-dynamic',
    ],
    ['the same nonce twice', { sameNonce: true }, '/en: nonce changes on every request'],
    [
      'a script tag without the nonce',
      { scriptWithoutNonce: true },
      '/en: every script tag carries the nonce',
    ],
    [
      'a script tag with another nonce',
      { scriptWrongNonce: true },
      '/en: every script tag carries the nonce',
    ],
    ['missing HSTS', { noHsts: true }, '/en: Strict-Transport-Security'],
    ['X-Powered-By present', { poweredBy: true }, '/en: no X-Powered-By'],
    [
      'missing API CSP',
      { noApiCsp: true },
      "/api/health: Content-Security-Policy default-src 'none'",
    ],
    ['/ not redirecting', { noRedirect: true }, '/: redirects to a locale'],
    ["missing object-src 'none'", { dropDirective: 'object-src' }, '/en: CSP hardening directives'],
  ])('fails on %s', async (_label, opts, name) => {
    const report = await checkHeaders({ baseUrl: BASE, fetchImpl: fakeFetch(opts) });
    expect(report.passed).toBe(false);
    expect(failed(report)).toContain(name);
  });

  it("static mode accepts 'unsafe-inline' scripts without a nonce", async () => {
    const report = await checkHeaders({
      baseUrl: BASE,
      fetchImpl: fakeFetch({ unsafeInline: true, sameNonce: true, scriptWithoutNonce: true }),
      mode: 'static',
    });
    expect(failed(report)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('static mode still requires the other directives and headers', async () => {
    const report = await checkHeaders({
      baseUrl: BASE,
      fetchImpl: fakeFetch({ unsafeInline: true, dropDirective: 'frame-ancestors', noHsts: true }),
      mode: 'static',
    });
    expect(failed(report)).toEqual(
      expect.arrayContaining(['/en: CSP hardening directives', '/en: Strict-Transport-Security']),
    );
  });

  it('marks /en/verify as SKIPPED, not FAIL, while the page does not exist', async () => {
    const report = await checkHeaders({ baseUrl: BASE, fetchImpl: fakeFetch({ verify404: true }) });
    expect(report.passed).toBe(true);
    const verify = report.results.filter((r) => r.name.startsWith('/en/verify'));
    expect(verify).toHaveLength(1);
    expect(verify[0]).toMatchObject({ skipped: true });
    expect(formatResult(verify[0])).toMatch(/^SKIPPED /);
  });

  it('reports a network error as a failed check instead of throwing', async () => {
    const fetchImpl = async () => {
      throw new Error('ECONNREFUSED');
    };
    const report = await checkHeaders({ baseUrl: BASE, fetchImpl });
    expect(report.passed).toBe(false);
    expect(report.results.every((r) => !r.ok)).toBe(true);
    expect(report.results[0]?.detail).toContain('ECONNREFUSED');
  });

  it('rejects an unknown mode', async () => {
    await expect(
      checkHeaders({ baseUrl: BASE, fetchImpl: fakeFetch(), mode: 'loose' }),
    ).rejects.toThrow(/mode/);
  });
});

describe('formatResult', () => {
  it('prints PASS, FAIL and SKIPPED lines', () => {
    expect(formatResult({ name: 'a', ok: true })).toBe('PASS a');
    expect(formatResult({ name: 'b', ok: false, detail: 'why' })).toBe('FAIL b - why');
    expect(formatResult({ name: 'c', ok: true, skipped: true, detail: '404' })).toBe(
      'SKIPPED c - 404',
    );
  });
});

describe('CLI', () => {
  const script = fileURLToPath(new URL('./check-headers.mjs', import.meta.url));
  const run = promisify(execFile);

  async function withServer(opts, fn) {
    const fake = fakeFetch(opts);
    const server = createServer(async (req, res) => {
      const reply = await fake(`${BASE}${req.url}`, {});
      res.writeHead(reply.status, Object.fromEntries(reply.headers));
      res.end(Buffer.from(await reply.arrayBuffer()));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it('prints one line per check and exits 0 when everything passes', async () => {
    await withServer({}, async (baseUrl) => {
      const { stdout } = await run(process.execPath, [script], {
        env: { ...process.env, BASE_URL: baseUrl },
      });
      const lines = stdout.trim().split('\n');
      expect(lines.filter((l) => /^(PASS|FAIL|SKIPPED) /.test(l)).length).toBeGreaterThan(10);
      expect(lines.some((l) => l.startsWith('FAIL '))).toBe(false);
    });
  });

  it('exits 1 on any FAIL', async () => {
    await withServer({ poweredBy: true }, async (baseUrl) => {
      const error = await run(process.execPath, [script], {
        env: { ...process.env, BASE_URL: baseUrl },
      }).catch((e) => e);
      expect(error.code).toBe(1);
      expect(error.stdout).toContain('FAIL /en: no X-Powered-By');
    });
  });

  it('accepts --mode static', async () => {
    await withServer({ unsafeInline: true, sameNonce: true }, async (baseUrl) => {
      const { stdout } = await run(process.execPath, [script, '--mode', 'static'], {
        env: { ...process.env, BASE_URL: baseUrl },
      });
      expect(stdout).not.toContain('FAIL ');
    });
  });
});
