import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirFor } from '@/i18n/routing';
import proxy, { config } from './proxy';

// next-intl's middleware imports 'next/server' without an extension, which Node ESM
// cannot resolve under Vitest. The mock records the request the proxy hands to it and
// returns whatever the current test chose.
const intl = vi.hoisted(() => ({
  calls: [] as Request[],
  reply: ((): Response => new Response(null)) as (req: Request) => Response,
}));
vi.mock('next-intl/middleware', () => ({
  default: () => (req: Request) => {
    intl.calls.push(req);
    return intl.reply(req);
  },
}));

// The matcher is a path-to-regexp string. This one only uses a negative lookahead
// group, so anchoring it as a RegExp gives the same behaviour.
function matcherRegExp(): RegExp {
  const source = config.matcher[0];
  return new RegExp('^' + source + '$');
}

describe('proxy matcher', () => {
  const re = matcherRegExp();

  it.each([
    '/api/health',
    '/api/health/db',
    '/api/v1/auth/login',
    '/_next/static/x.js',
    '/_vercel/insights',
    '/favicon.ico',
  ])('skips %s', (path) => {
    expect(re.test(path)).toBe(false);
  });

  it.each(['/', '/en', '/ur', '/ur/branches', '/en/login'])('handles %s', (path) => {
    expect(re.test(path)).toBe(true);
  });
});

describe('dirFor', () => {
  it('returns rtl for Urdu and ltr for English', () => {
    expect(dirFor('ur')).toBe('rtl');
    expect(dirFor('en')).toBe('ltr');
  });
});

function nonceOf(csp: string | null): string {
  const match = /'nonce-([^']+)'/.exec(csp ?? '');
  if (!match?.[1]) throw new Error(`no nonce in ${csp}`);
  return match[1];
}

function scriptSrc(csp: string | null): string {
  return (csp ?? '').split('; ').find((d) => d.startsWith('script-src ')) ?? '';
}

describe('proxy CSP', () => {
  beforeEach(() => {
    intl.calls.length = 0;
    intl.reply = () => new Response(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('forwards the CSP and x-nonce to the render and sets the same CSP on the response', async () => {
    const response = await proxy(new NextRequest('http://localhost:3100/en'));

    expect(intl.calls).toHaveLength(1);
    const forwarded = intl.calls[0]!;
    const requestCsp = forwarded.headers.get('content-security-policy');
    const nonce = nonceOf(requestCsp);
    expect(forwarded.headers.get('x-nonce')).toBe(nonce);
    expect(scriptSrc(requestCsp)).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(response.headers.get('content-security-policy')).toBe(requestCsp);
  });

  it('keeps the incoming request headers, URL and cookies for the locale middleware', async () => {
    await proxy(
      new NextRequest('http://localhost:3100/ur/branches?x=1', {
        headers: { 'accept-language': 'ur', cookie: 'NEXT_LOCALE=ur; theme=dark' },
      }),
    );
    const forwarded = intl.calls[0] as NextRequest;
    expect(forwarded.headers.get('accept-language')).toBe('ur');
    expect(forwarded.nextUrl.pathname).toBe('/ur/branches');
    expect(forwarded.nextUrl.search).toBe('?x=1');
    expect(forwarded.cookies.get('NEXT_LOCALE')?.value).toBe('ur');
  });

  it('overrides a client-supplied nonce or policy', async () => {
    await proxy(
      new NextRequest('http://localhost:3100/en', {
        headers: { 'x-nonce': 'attacker', 'content-security-policy': "script-src 'unsafe-inline'" },
      }),
    );
    const forwarded = intl.calls[0]!;
    expect(forwarded.headers.get('x-nonce')).not.toBe('attacker');
    expect(forwarded.headers.get('content-security-policy')).not.toContain('attacker');
    expect(nonceOf(forwarded.headers.get('content-security-policy'))).toBe(
      forwarded.headers.get('x-nonce'),
    );
  });

  it('uses a fresh nonce on every request', async () => {
    const a = await proxy(new NextRequest('http://localhost:3100/en'));
    const b = await proxy(new NextRequest('http://localhost:3100/en'));
    expect(nonceOf(a.headers.get('content-security-policy'))).not.toBe(
      nonceOf(b.headers.get('content-security-policy')),
    );
  });

  it.each([
    ['plain http', 'http://localhost:3100/en', {}, false],
    ['an https URL', 'https://shiplens.example.test/en', {}, true],
    ['x-forwarded-proto https', 'http://10.0.0.5:10000/en', { 'x-forwarded-proto': 'https' }, true],
    [
      'a proxy chain starting with https',
      'http://10.0.0.5/en',
      { 'x-forwarded-proto': 'https,http' },
      true,
    ],
    ['x-forwarded-proto http', 'http://10.0.0.5/en', { 'x-forwarded-proto': 'http' }, false],
  ])('derives https from %s', async (_label, url, headers, https) => {
    const response = await proxy(new NextRequest(url, { headers }));
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp.includes('upgrade-insecure-requests')).toBe(https);
  });

  it('adds the development relaxations only when NODE_ENV is development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const dev = await proxy(new NextRequest('http://localhost:3100/en'));
    expect(dev.headers.get('content-security-policy')).toContain("'unsafe-eval'");
    expect(dev.headers.get('content-security-policy')).toContain('ws:');

    vi.stubEnv('NODE_ENV', 'production');
    const prod = await proxy(new NextRequest('http://localhost:3100/en'));
    expect(prod.headers.get('content-security-policy')).not.toContain('unsafe-eval');
    expect(prod.headers.get('content-security-policy')).not.toContain('ws:');
  });

  it('keeps the locale middleware response: redirect status, location and its headers', async () => {
    intl.reply = (req) => {
      const res = NextResponse.redirect(new URL('/en', req.url), 307);
      res.headers.set('link', '<http://localhost:3100/en>; rel="alternate"; hreflang="en"');
      return res;
    };
    const response = await proxy(new NextRequest('http://localhost:3100/'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3100/en');
    expect(response.headers.get('link')).toContain('hreflang="en"');
    expect(response.headers.get('content-security-policy')).toContain("'nonce-");
  });

  it('keeps the request header override that next-intl puts on a next() response', async () => {
    intl.reply = (req) => NextResponse.next({ request: { headers: new Headers(req.headers) } });
    const response = await proxy(new NextRequest('http://localhost:3100/en'));
    const nonce = nonceOf(response.headers.get('content-security-policy'));
    // Next applies x-middleware-request-* headers to the request the page renders with.
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(
      response.headers.get('content-security-policy'),
    );
  });
});

describe('next.config security headers', () => {
  async function headerRules() {
    const { default: nextConfig } = await import('../next.config');
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = (await nextConfig.headers?.()) ?? [];
    return (source: string) =>
      Object.fromEntries(
        (rules.find((r) => r.source === source)?.headers ?? []).map((h) => [h.key, h.value]),
      );
  }

  it('sends the Phase 1 headers plus COOP and CORP on every path', async () => {
    const all = (await headerRules())('/:path*');
    expect(all).toEqual({
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    // The page CSP is per request, so it never comes from the static config.
    expect(all).not.toHaveProperty('Content-Security-Policy');
  });

  it("locks API responses down with default-src 'none'", async () => {
    expect((await headerRules())('/api/:path*')).toEqual({
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
  });
});
