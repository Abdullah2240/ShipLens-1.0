# Security

How ShipLens addresses the OWASP Top 10 (2021), where each control lives in the code, and
which tests prove it. Paths are relative to the repository root.

Every control below exists in the code; each file and test path was checked against the
code on 1 November 2026. The review behind this mapping, with what it found and fixed, is
summarised in [Review log](#review-log).

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## OWASP Top 10 (2021) mapping

### A01 Broken Access Control

| Control | Where | Proof |
| --- | --- | --- |
| One permission table as data: every action lists the roles allowed and their scope (`all` or `own_branch`); anything not listed is denied | `src/platform/authz/permissions.ts`, generated view [permissions.md](permissions.md) | `src/platform/authz/permissions.test.ts`, drift check `scripts/gen-permissions-doc.test.mjs` |
| `authorize(actor, action)` fails closed and returns a branded `Scope`; repositories require a `Scope`, so a query cannot be written without one | `src/platform/authz/authorize.ts`, `src/platform/authz/scope.ts` | `src/platform/authz/authorize.test.ts` |
| Generated role-by-action matrix: every action is tested for every role | `src/platform/authz/permissions.ts` | `src/platform/authz/matrix.test.ts`, `tests/http/role-matrix.test.ts`, route registry check `tests/http/route-registry.test.ts` |
| Out of scope and missing are the identical 404, so other branches' records cannot be probed | Repositories via `scopeWhere()` in `src/platform/authz/scope.ts` | `tests/db/scope-404.test.ts`, `tests/http/cross-branch.test.ts` |
| Every API route goes through one wrapper: session, then `authorize()`, before the handler runs | `src/platform/http/route.ts` | `src/platform/http/route.test.ts` ("returns 401 without a session and 403 for a denied action, never reaching the handler"), `src/platform/http/route.int.test.ts` |
| Finance Reviewer sees only finance audit entities; audit chain status is limited to Super Admin and Finance Reviewer (`audit.read_finance`) | `src/modules/audit-log/policy.ts`, `GET /api/v1/audit/chain` | `src/modules/audit-log/audit-log.int.test.ts`, `tests/http/audit-viewer.test.ts`, `tests/http/audit-chain.test.ts` |

### A02 Cryptographic Failures

| Control | Where | Proof |
| --- | --- | --- |
| Passwords hashed with argon2id at the OWASP minimum (19 MiB, 2 iterations, parallelism 1); parameters may only be raised | `scripts/lib/password.mjs` | `scripts/lib/password.test.mjs` |
| Session tokens are 256 random bits; only their SHA-256 hash is stored; the raw token is never logged | `src/modules/auth/session.ts`, `sessions.token_hash` in `db/migrations/202610281000_foundation_identity_audit.sql` | `src/modules/auth/auth.int.test.ts` |
| HTTPS only on Render; `Strict-Transport-Security: max-age=63072000; includeSubDomains`; session cookie uses the `__Host-` prefix and `Secure` over https | `next.config.ts`, `src/modules/auth/cookie.ts` | `src/modules/auth/cookie.test.ts`, `scripts/smoke.mjs` (cookie flags against a running build) |
| No secrets in logs: the logger redacts any key matching pass, token, secret, cookie, authorization or hash; the seed never prints the demo password | `src/platform/log/logger.ts` | `src/platform/log/logger.test.ts` |
| Audit chain uses SHA-256 over a length-prefixed canonical form | `db/migrations/202610311400_audit_chain.sql`, `src/platform/audit/chain/canonical.ts` | `src/platform/audit/chain/canonical.test.ts`, `tests/db/audit-chain.test.ts` |

### A03 Injection

| Control | Where | Proof |
| --- | --- | --- |
| Parameterised SQL only (`$1`, `$2`, ... with `pg`); the one interpolated identifier (scope column) comes from code and is checked against a strict pattern | Repositories under `src/modules/*/repo.ts`, `scopeWhere()` in `src/platform/authz/scope.ts` | `src/platform/authz/authorize.test.ts`, the integration suites under `src/modules/**/*.int.test.ts` |
| Every request body and query string is validated by a Zod schema before the handler; bodies over 64 KiB are refused | `src/modules/*/schema.ts`, `src/platform/http/route.ts` | `src/modules/*/schema.test.ts`, `src/platform/http/route.test.ts` |
| Public content Markdown is rendered without raw HTML (`skipHtml`), with an element allow list and a safe URL transform; no `dangerouslySetInnerHTML` | `src/components/content/SafeMarkdown.tsx` | `src/components/content/SafeMarkdown.test.tsx` |
| CSV exports neutralise cells starting with `=`, `+`, `-`, `@`, tab or carriage return so a spreadsheet does not run them as formulas | `src/platform/csv/index.ts` | `src/platform/csv/csv.test.ts`, `tests/http/exports.test.ts` |
| Strict nonce-based Content Security Policy for pages (no `'unsafe-inline'` in `script-src`) | `src/proxy.ts`, `src/platform/http/csp.ts`, `next.config.ts` | `src/platform/http/csp.test.ts`, `src/proxy.test.ts`, `scripts/check-headers.mjs` against the production build (CI and after deploy), `tests/e2e/security/csp.spec.ts` |
| Verification code input is length-capped and matched against a strict alphabet before any lookup | `src/modules/verification/code.ts` | `src/modules/verification/code.test.ts` |

### A04 Insecure Design

| Control | Where | Proof |
| --- | --- | --- |
| Weekly report lifecycle as an explicit transition table (draft, submitted, returned, approved); the database rejects any other status change and any update of an approved report | `src/modules/reports/transitions.ts`, `db/migrations/202610311200_finance_guards.sql` | `src/modules/reports/transitions.test.ts`, `tests/db/finance-guards.test.ts`, `tests/lifecycle/report-lifecycle.test.ts` |
| Conditional updates (`WHERE id = $1 AND status = <expected status>`, version bumped on every transition) so two reviewers cannot both act on the same report | `src/modules/reports/repo.ts` | `tests/lifecycle/concurrency.test.ts` |
| Collections lock 7 days after the collection date; locked rows cannot be changed | `src/modules/collections/lock.ts`, `db/migrations/202610311200_finance_guards.sql` | `src/modules/collections/lock.test.ts`, `src/modules/collections/lock-rules.int.test.ts`, `tests/lifecycle/lock-boundary.test.ts` |
| Every mutation runs inside `command()`, which writes its audit events in the same transaction; a command without an audit event is a programming error | `src/platform/audit/command.ts` | `src/platform/audit/command.test.ts`, `src/platform/audit/command.int.test.ts`, `tests/lifecycle/audit-rollback.test.ts` |
| Tamper-evident audit chain computed by a database trigger for every writer; audited writes run at READ COMMITTED so the trigger always sees the newest chain head | `db/migrations/202610311400_audit_chain.sql`; verifier `src/platform/audit/chain/verify.ts` | `tests/db/audit-chain.test.ts`, `src/platform/audit/chain/verify.test.ts`, `src/platform/audit/chain/tamper.int.test.ts`, `src/platform/audit/isolation-guard.test.ts` |
| Public verification shows aggregates only, never personal data; codes are random (50 bits) and cannot be enumerated under the rate limit | `db/migrations/202610311410_report_verification.sql`, `src/modules/verification/service.ts`, `src/modules/verification/repo.ts`, pages under `src/app/[locale]/(public)/verify/` | `tests/db/report-verification.test.ts`, `src/modules/verification/service.int.test.ts`, `tests/http/verify.test.ts` |

### A05 Security Misconfiguration

| Control | Where | Proof |
| --- | --- | --- |
| Security headers on every response (see [Security headers](#security-headers)); `X-Powered-By` disabled (`poweredByHeader: false`) | `next.config.ts`; page CSP in `src/proxy.ts` | `src/proxy.test.ts`, `scripts/check-headers.mjs` against the production build (CI end-to-end job, and `scripts/verify-deploy.mjs` after a deploy) |
| Production image runs as uid 10001, not root; only explicitly listed files are copied; no runtime configuration baked into the image | `Dockerfile` | `scripts/docker-config.test.mjs`; CI step "App container runs as a non-root user" in `.github/workflows/ci.yml` |
| Environment validated at start with Zod; the app refuses to start without a database URL or a usable origin | `src/platform/config/env.ts` | `src/platform/config/env.test.ts`, `scripts/env-example.test.mjs` |
| Unexpected errors become a generic 500 with a code and request id, never a stack trace; the database health check returns no error detail | `src/platform/errors/index.ts`, `src/platform/http/route.ts`, `src/app/api/health/handlers.ts` | `src/platform/errors/errors.test.ts`, `src/app/api/health/health.test.ts` |
| Database not reachable from the internet (`ipAllowList: []`) | `render.yaml` | Reviewed in [deploy.md](deploy.md) |

### A06 Vulnerable and Outdated Components

| Control | Where | Proof |
| --- | --- | --- |
| `npm audit --omit=dev --audit-level=high` blocks CI; a full `npm audit` runs as a report | `.github/workflows/ci.yml` (job `audit`) | CI run on every push; 0 production advisories on 1 November 2026 |
| Dependabot for npm, Docker and GitHub Actions, weekly | `.github/dependabot.yml` | Pull requests from Dependabot |
| CodeQL code scanning | `.github/workflows/codeql.yml` | Code scanning results |
| Actions pinned to full commit SHAs (version in a comment); the secret-scan image pinned by tag and digest | `.github/workflows/ci.yml`, `.github/workflows/codeql.yml` | Review of the workflow files; Dependabot proposes SHA updates |
| Few runtime dependencies, each listed in the README credits; new ones are checked for licence, maintenance and size first | `package.json`, [README.md](../README.md#credits) | Review |

### A07 Identification and Authentication Failures

| Control | Where | Proof |
| --- | --- | --- |
| Login throttling stored in the database: 5 failures per email or 20 per IP in 15 minutes give 429 with `Retry-After` | `src/modules/auth/throttle.ts`, `LOGIN_THROTTLE` in `src/platform/config/constants.ts` | `src/modules/auth/auth.int.test.ts`, `tests/http/auth-endpoints.test.ts` |
| The same response for an unknown email and a wrong password; unknown emails are checked against a dummy hash so timing does not reveal accounts | `src/modules/auth/service.ts` | `src/modules/auth/auth.int.test.ts` |
| Sessions expire after 12 hours idle or 7 days absolute; logout revokes the session in the database; inactive users' sessions are refused | `src/modules/auth/session.ts`, `src/modules/auth/repo.ts`, `SESSION` in `src/platform/config/constants.ts` | `src/modules/auth/auth.int.test.ts` |
| Session cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` and `__Host-` prefix over https | `src/modules/auth/cookie.ts` | `src/modules/auth/cookie.test.ts`, `scripts/smoke.mjs` |
| Cross-site request forgery: every state-changing request must carry an `Origin` equal to the app origin | `src/platform/http/origin.ts`, `src/platform/http/route.ts` | `src/platform/http/origin.test.ts`, `src/platform/http/route.test.ts` |
| Public form and public report check are rate limited per address (5 applications per hour, 30 lookups per minute) by one shared limiter | `src/platform/rate-limit/index.ts`, `src/modules/applications/rate-limit.ts`, `src/modules/verification/config.ts` | `src/platform/rate-limit/rate-limit.test.ts`, `src/modules/applications/rate-limit-shared.test.ts`, `tests/http/applications-submit.test.ts`, `tests/http/verify.test.ts` |
| Safe post-login redirects: only local paths are followed | `src/modules/auth/next-path.ts` | `src/modules/auth/next-path.test.ts` |

### A08 Software and Data Integrity Failures

| Control | Where | Proof |
| --- | --- | --- |
| Reproducible installs: `npm ci` from the committed lockfile in CI and in every Docker stage | `package-lock.json`, `Dockerfile`, `.github/workflows/ci.yml` | `scripts/docker-config.test.mjs` |
| Base images pinned by major version (`node:24-slim`, `postgres:16`); actions pinned by full commit SHA | `Dockerfile`, `compose.yaml`, `.github/workflows/ci.yml` | Review |
| Audit log is append-only: triggers reject `UPDATE`, `DELETE` and `TRUNCATE` on `audit_events` | `db/migrations/202610281000_foundation_identity_audit.sql` | `tests/db/schema.test.ts`, `tests/db/audit-chain.test.ts` |
| Hash chain over every audit event, and seals on approved reports held outside the database | `db/migrations/202610311400_audit_chain.sql`, `db/migrations/202610311410_report_verification.sql` | `tests/db/audit-chain.test.ts`, `tests/db/report-verification.test.ts`; tamper journey `tests/e2e/journeys/tamper.spec.ts` (run from the host) |
| Migrations are forward-only, applied once each with a recorded checksum; a changed applied file stops the start | `scripts/migrate.mjs` | `scripts/migrate.int.test.mjs` |
| Secret scan of the full git history with gitleaks | `.github/workflows/ci.yml` (job `secrets`), `.gitleaks.toml` | CI run on every push; no leaks in the full history on 1 November 2026 |

### A09 Security Logging and Monitoring Failures

| Control | Where | Proof |
| --- | --- | --- |
| Structured JSON logger with key-based redaction; denied authorisations log `authz.denied` with role and user id | `src/platform/log/logger.ts`, `src/platform/authz/authorize.ts` | `src/platform/log/logger.test.ts` |
| Audit trail of every change (actor, role, action, entity, before and after with sensitive fields masked), written in the same transaction; failed logins are recorded in `login_attempts` without the password | `src/platform/audit/command.ts`, `src/platform/audit/mask.ts`, `src/platform/audit/allowlist.ts` | `src/platform/audit/mask.test.ts`, `src/platform/audit/command.int.test.ts`, `src/modules/auth/auth.int.test.ts` ("records failures without an audit event or any secret in the log") |
| Audit viewer for Super Admin and Finance Reviewer, with filters and before/after tables | `src/modules/audit-log/`, `src/app/[locale]/(app)/audit/` | `src/modules/audit-log/components/audit-viewer.test.tsx`, `tests/e2e/audit/audit-viewer.spec.ts` |
| Chain status check in the API and as a badge in the audit viewer, with a re-check that walks the whole chain | `GET /api/v1/audit/chain`, `src/components/verification/ChainStatusBadge.tsx`, `src/components/verification/AuditChainSection.tsx` | `tests/http/audit-chain.test.ts`, `src/components/verification/verification.test.tsx`, `src/components/verification/sections.test.tsx`, `tests/e2e/journeys/tamper.spec.ts` |
| Health endpoints for liveness and database readiness | `src/app/api/health/` | `src/app/api/health/health.test.ts` |
| Request id on every API response for correlating logs | `src/platform/http/route.ts` | `src/platform/http/route.test.ts` |

### A10 Server-Side Request Forgery

| Control | Where | Proof |
| --- | --- | --- |
| No user-controlled outbound requests: the server never fetches a URL taken from a request, form or database row | Whole codebase | `grep -rn "fetch(" src` finds only the keep-warm pinger on the server; the other matches are browser components calling fixed same-origin `/api/v1` paths |
| The keep-warm target is built only from the platform variable `RENDER_EXTERNAL_URL`, must be `https:`, and the path is fixed to `/api/health` | `src/platform/keepwarm/index.ts` | `src/platform/keepwarm/keepwarm.test.ts`, `src/instrumentation.test.ts` |

## Security headers

| Header | Value | Applies to |
| --- | --- | --- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | All responses |
| `X-Content-Type-Options` | `nosniff` | All responses |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | All responses |
| `X-Frame-Options` | `DENY` | All responses |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | All responses |
| `X-Powered-By` | Not sent | All responses |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'nonce-{N}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'; worker-src 'self' blob:`, plus `upgrade-insecure-requests` when the request arrived over https. A new nonce for every request. Development adds `'unsafe-eval'` and `ws:` | Pages (set in `src/proxy.ts`) |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | API responses (`/api/*`, from `next.config.ts`) |
| `Cross-Origin-Opener-Policy` | `same-origin` | All responses |
| `Cross-Origin-Resource-Policy` | `same-origin` | All responses |

The header check (`scripts/check-headers.mjs`) runs against the production build (in the
CI end-to-end job and after every deploy) and asserts that the CSP is present on `/en`, `/ur` and `/en/verify`, that the nonce
differs between requests and is on every `<script>` tag, that `script-src` has no
`'unsafe-inline'`, the API policy, the other headers and the absence of `X-Powered-By`.
It passed all 44 checks in nonce mode against the production image on 1 November 2026; the
static fallback policy is not used. Why a nonce-based policy: [ADR 0012](adr/0012-nonce-based-csp.md).

## Secret handling

- The only application secret is the demo password (`SEED_DEMO_PASSWORD`). It is typed
  into the Render dashboard (`sync: false` in `render.yaml`), kept in the owner's
  password manager and shared with judges only through the submission form.
- `DATABASE_URL` is injected by Render from the managed database. There is no session
  signing secret: sessions are opaque random tokens stored as hashes.
- `.env.example` holds placeholders only; `.env*` files with values are git-ignored and
  never committed. CI generates throwaway passwords per run.
- Logs redact sensitive keys (`src/platform/log/logger.ts`); the seed never prints the
  password; audit snapshots mask sensitive columns (`src/platform/audit/mask.ts`).
- Rotation: [handover.md, Secrets and access](handover.md#8-secrets-and-access).

## Dependency policy

- Add a dependency only when writing it ourselves would be riskier or much larger; check
  its licence (MIT-compatible), maintenance, transitive dependencies and size first, and
  pin it in `package-lock.json`.
- Install with `npm ci` only, in CI and in Docker.
- A high or critical advisory in a production dependency blocks CI; fix it
  with a non-major update where possible, otherwise record why it does not apply.
- Dependabot pull requests go through the same CI as any change.

## Residual risks

| Risk | Why accepted | What would remove it |
| --- | --- | --- |
| `style-src 'unsafe-inline'` in the CSP | React `style` attributes and font CSS need it; injected styles can deface a page but cannot run code | Moving all inline styles to classes and hashing the remaining ones |
| Public verification and application rate limits are in memory, per process | On Vercel each serverless instance keeps its own counters and a cold start resets them; login throttling is stored in the database and is shared | A shared store (for example Postgres or Redis) for the limiter |
| Rate limits key on the first `X-Forwarded-For` entry | It is the address the hosting proxy reports (Vercel in production); whether the proxy replaces or appends a value the client sent has not been confirmed on the live service | Log one request's header in production; if the proxy appends, key on the entry it adds |
| Single region (Vercel `iad1`, Neon US East) | Free plans | Move the in-memory limiter to a shared store before relying on more regions |
| A database superuser can rewrite the whole audit chain; deleting the newest rows leaves no gap | Seals held by donors detect a rewrite of any approval they hold | A signed daily digest of the chain head published outside the database |
| Free Neon database: free-plan limits, no paid backup tier | Demo deployment; manual `pg_dump` documented | A paid database plan with backups ([handover.md](handover.md#6-database)) |
| Dependabot does not track the secret-scan image digest in the workflow | One image from the official publisher | Bump the tag and digest by hand with each gitleaks release |

## Review log

A whole-system security and code review of the merged code on 1 November 2026, run against
this checklist. Each fix came with a test that failed before it.

| Area | What was checked | Result |
| --- | --- | --- |
| Injection | Every SQL statement is parameterised; every interpolated identifier is a fixed name from code (the scope column checked by `scopeWhere`, column maps for partial updates, figure predicates checked against a pattern) | Pass |
| Access control | Every `/api/v1` route is built with `route()` (`src/platform/http/route-usage.test.ts`); services authorise and pass a `Scope`; pages and routes never import a repository (lint); the role-by-endpoint matrix and the cross-branch suite cover every route, the three verification endpoints included | Pass |
| Audit | Every mutation runs in `command()`; no application code updates or deletes audit rows; audited writes run at READ COMMITTED | Fixed: a CSV export wrote its audit event inside a REPEATABLE READ transaction, so it failed on the chain's unique index when another audited write committed while the file was being built. Rows are now read in a read-only snapshot and the event is recorded afterwards (`src/modules/reporting/export.int.test.ts`); `src/platform/audit/isolation-guard.test.ts` keeps it that way. Also fixed: the seed held the audit chain's advisory lock key for its whole run, so a boot seed held up every audited write of a running instance; it now has its own key (`scripts/advisory-lock-keys.test.mjs`) |
| Output | No `dangerouslySetInnerHTML`; Markdown rendered without raw HTML; CSV cells neutralised; nonce CSP with no `'unsafe-inline'` scripts | Pass |
| Sessions | Cookie flags, logout revocation, login throttling, identical login failures, same-origin `next` after login | Pass |
| Secrets and data | Logger redaction keys; placeholders only in `.env.example`; gitleaks over the full history found nothing; demo data fictional (`.test` addresses, synthetic phone numbers) | Pass |
| Errors | 500 bodies carry only a code and a request id; error pages show no stack | Pass |
| Dependencies | `npm audit --omit=dev --audit-level=high` | Pass: 0 vulnerabilities |
| Layering | Services and kernel code import no framework code | Fixed: the lint rule did not cover the rate limiter, CSV, keep-warm and formatter folders; it does now (`scripts/lint-layers.test.mjs`) |
| Duplication | One implementation of each platform concern | Fixed: the application form carried its own copy of the rate limiter; it now uses `src/platform/rate-limit/index.ts` (`src/modules/applications/rate-limit-shared.test.ts`) |

Open item for the owner: confirm how Render sets `X-Forwarded-For` (see the residual risk
above).
