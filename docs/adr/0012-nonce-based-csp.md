# 0012 Nonce-based Content Security Policy set in the proxy

- Status: Accepted
- Date: 2026-10-31

## Context

A Content Security Policy is the browser-side backstop against cross-site scripting: even if an attacker gets markup into a page, the browser refuses to run scripts the policy does not allow. ShipLens renders user-supplied content (CMS Markdown, member names, report notes), so this backstop matters, and OWASP security is 15 of the 100 judging points.

Next.js inlines small scripts into every page for hydration. A static policy therefore needs `script-src 'unsafe-inline'`, which lets any injected inline script run and removes most of the protection. The alternative is a per-request nonce: the server puts a fresh random value in the policy and on every script tag it emits, and the browser runs only scripts carrying it.

The usual objection to nonces is that they force every page to render dynamically, losing static caching. In ShipLens that cost is already paid: the root layout reads the theme cookie, so every page is dynamic anyway. A nonce adds nothing.

The other complication was composing a nonce with the next-intl locale middleware. Its source shows it copies the incoming request headers into the rewritten or forwarded request, so a nonce set on the request survives it.

## Decision

- `src/proxy.ts` creates a nonce per request (`Buffer.from(crypto.randomUUID()).toString('base64')`), sets `Content-Security-Policy` and `x-nonce` on a cloned request, passes that request to the next-intl middleware, then sets the same `Content-Security-Policy` on the response. Next reads the nonce from the request header and stamps it on its own scripts.
- Production policy:

  `default-src 'self'; script-src 'self' 'nonce-{N}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self' blob:`

  plus `upgrade-insecure-requests` only when the request arrived over https, so local http runs of the Docker image still work. Development adds `'unsafe-eval'` and `ws:` for hot reload.
- Production never needs `'unsafe-eval'`. The one eval in the client bundle was zod's JIT probe (`new Function('')` when an object schema is built, caught but still reported as a violation by the browser). `src/instrumentation-client.ts` sets `z.config({ jitless: true })` in the browser before hydration, so client-side validation runs without eval and with the same results.
- API responses (`/api/*`, not matched by the proxy) get `default-src 'none'; frame-ancestors 'none'` from `next.config.ts`, since they never render HTML.
- Every response also carries HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`; `X-Powered-By` is off.
- `scripts/check-headers.mjs` verifies this against the production build running in Docker: the policy is present on English, Urdu and verification pages, the nonce differs between two requests, every `<script>` tag carries that response's nonce, `script-src` has no `'unsafe-inline'`, and the API and other headers are correct. The same check runs locally, in CI and after deploy.
- **Shipped mode: nonce.** The nonce reaches every script tag Next.js emits, so the static fallback was never needed. Evidence: on 2026-11-01 `scripts/check-headers.mjs` passed all 44 of its checks in nonce mode against the production Docker image (run inside `scripts/verify-deploy.mjs`, which passed 102 of 102), and `tests/e2e/security/csp.spec.ts` fails on any `securitypolicyviolation` across public and signed-in pages. The same header check is a step of the CI end-to-end job.
- Fallback, kept but not used: `buildCsp({ nonce: null })` gives a static policy identical except `script-src 'self' 'unsafe-inline'`, and the header check has a matching `--mode static`. It is switched on only with recorded evidence that the nonce no longer reaches the scripts, and this record is then updated.

## Consequences

### Positive

- Injected inline scripts and scripts from other origins do not run, which is the main point of a CSP.
- `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'` close clickjacking, plugin and base-tag injection paths.
- The policy is tested against the real production build, not only in unit tests.

### Negative

- `style-src 'unsafe-inline'` remains. React `style` attributes and font CSS need it. This is an accepted residual: injected styles can deface a page but cannot run code.
- Every HTML response is dynamic and uncacheable by a CDN. It already was.
- Any third-party script added later must be loaded by a nonced script under `'strict-dynamic'`, or the policy blocks it.

### Neutral

- QR codes are rendered as inline SVG paths by a Server Component, so they need no script or `data:` image exception.

## Alternatives considered

- **Static CSP with `'unsafe-inline'` scripts.** Simple and cacheable, but leaves the main XSS path open.
- **Hash-based CSP.** Next's inline scripts change per build and per page, so hashes cannot be listed in advance.
- **No CSP, rely on output escaping.** React escapes by default, but defence in depth expects a second layer.

## Where it lives

- [`src/platform/http/csp.ts`](../../src/platform/http/csp.ts): policy builder (nonce and static fallback), tested in [`src/platform/http/csp.test.ts`](../../src/platform/http/csp.test.ts).
- [`scripts/check-headers.mjs`](../../scripts/check-headers.mjs): header and nonce check against a running build, run in CI and by [`scripts/verify-deploy.mjs`](../../scripts/verify-deploy.mjs) after a deploy.
- [`tests/e2e/security/csp.spec.ts`](../../tests/e2e/security/csp.spec.ts): browser check that no page reports a policy violation.
- [`src/proxy.ts`](../../src/proxy.ts): proxy where the nonce and policy are applied.
- [`next.config.ts`](../../next.config.ts): headers for every response, including API responses.
- [`src/instrumentation-client.ts`](../../src/instrumentation-client.ts): turns off zod's eval-based JIT in the browser.

