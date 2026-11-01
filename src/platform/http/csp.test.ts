import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce } from './csp';

const PRODUCTION =
  "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; " +
  "form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self' blob:; " +
  'upgrade-insecure-requests';

function directive(csp: string, name: string): string | undefined {
  return csp
    .split('; ')
    .find((d) => d === name || d.startsWith(`${name} `))
    ?.trim();
}

describe('buildCsp', () => {
  it('builds the exact production policy over https', () => {
    expect(buildCsp({ nonce: 'abc', dev: false, https: true })).toBe(PRODUCTION);
  });

  it('omits upgrade-insecure-requests over plain http', () => {
    const csp = buildCsp({ nonce: 'abc', dev: false, https: false });
    expect(csp).toBe(PRODUCTION.replace('; upgrade-insecure-requests', ''));
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it("adds 'unsafe-eval' and ws: only in development", () => {
    const dev = buildCsp({ nonce: 'abc', dev: true, https: false });
    expect(directive(dev, 'script-src')).toBe(
      "script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'",
    );
    expect(directive(dev, 'connect-src')).toBe("connect-src 'self' ws:");

    const prod = buildCsp({ nonce: 'abc', dev: false, https: false });
    expect(prod).not.toContain('unsafe-eval');
    expect(prod).not.toContain('ws:');
  });

  it("never allows 'unsafe-inline' scripts when a nonce is given", () => {
    const csp = buildCsp({ nonce: 'abc', dev: false, https: true });
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
  });

  it("falls back to a static policy with 'unsafe-inline' scripts and no nonce", () => {
    const csp = buildCsp({ nonce: null, dev: false, https: true });
    expect(directive(csp, 'script-src')).toBe("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain('strict-dynamic');
    expect(csp).not.toContain("'nonce-");
    // Everything else is identical to the nonce policy.
    expect(csp.replace("script-src 'self' 'unsafe-inline'", '')).toBe(
      PRODUCTION.replace("script-src 'self' 'nonce-abc' 'strict-dynamic'", ''),
    );
  });

  it('keeps the hardening directives in every mode', () => {
    for (const nonce of ['abc', null]) {
      for (const dev of [true, false]) {
        for (const https of [true, false]) {
          const csp = buildCsp({ nonce, dev, https });
          expect(directive(csp, 'object-src')).toBe("object-src 'none'");
          expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
          expect(directive(csp, 'form-action')).toBe("form-action 'self'");
          expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
        }
      }
    }
  });

  it('rejects a nonce that could break out of the header value', () => {
    expect(() => buildCsp({ nonce: "abc' 'unsafe-inline", dev: false, https: true })).toThrow();
    expect(() => buildCsp({ nonce: 'a;b', dev: false, https: true })).toThrow();
    expect(() => buildCsp({ nonce: '', dev: false, https: true })).toThrow();
  });
});

describe('createNonce', () => {
  it('returns base64 of at least 24 characters', () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(nonce.length).toBeGreaterThanOrEqual(24);
  });

  it('differs on every call', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(seen.size).toBe(50);
  });

  it('is accepted by buildCsp', () => {
    const nonce = createNonce();
    expect(buildCsp({ nonce, dev: false, https: false })).toContain(`'nonce-${nonce}'`);
  });
});
