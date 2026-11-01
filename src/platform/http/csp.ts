// Content Security Policy for HTML pages. Pure: no framework imports, so it is unit
// tested directly and used by src/proxy.ts (see docs/adr/0012-nonce-based-csp.md).
//
// With a nonce, script-src allows only scripts that carry that nonce plus whatever they
// load ('strict-dynamic'); no inline script without the nonce runs. style-src keeps
// 'unsafe-inline' (React style attributes and font CSS): an accepted residual risk,
// since styles cannot run code. A null nonce gives the static fallback policy.

// base64 alphabet only: the nonce is embedded in a header value and an HTML attribute.
const NONCE_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

export type CspOptions = {
  /** Per-request nonce, or null for the static fallback ('unsafe-inline' scripts). */
  nonce: string | null;
  /** Development adds 'unsafe-eval' (React debugging) and ws: (hot reload). */
  dev: boolean;
  /** Adds upgrade-insecure-requests; false for plain http so local runs keep working. */
  https: boolean;
};

/** A fresh, unguessable nonce for one response. */
export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

export function buildCsp({ nonce, dev, https }: CspOptions): string {
  if (nonce !== null && !NONCE_PATTERN.test(nonce)) {
    throw new Error('CSP nonce must be non-empty base64');
  }

  const scriptSrc =
    nonce === null
      ? ["'self'", "'unsafe-inline'"]
      : ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (dev) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'"];
  if (dev) connectSrc.push('ws:');

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (https) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
