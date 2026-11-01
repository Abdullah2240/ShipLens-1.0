# 0006 Database-backed opaque sessions and argon2id passwords

- Status: Accepted
- Date: 2026-10-28

## Context

Every private screen and every mutation depends on knowing who the user is, their role and their branch. Users are a handful of staff accounts; there is no self sign-up, social login or password reset in scope. The questions were where the session lives, how it is revoked, how passwords are stored, and how to resist guessing without revealing which emails have accounts.

## Decision

- **Opaque tokens, stored hashed.** Login creates a 256-bit random token (`randomBytes(32)`, 43 base64url characters). Only its sha256 hex reaches the database (`sessions.token_hash`, unique). The raw token exists only in the cookie and is never logged.
- **Cookie.** `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` and the `__Host-` name prefix whenever the app origin is https. Over plain http in local development the cookie has the plain name and no `Secure` flag, because browsers would drop it otherwise.
- **Lifetime.** A session ends at the first of: 7 days absolute, 12 hours idle, explicit logout (sets `revoked_at`), or the user being deactivated. `last_seen_at` is touched at most once a minute.
- **Fresh authority on every request.** Role and branch are read from the `users` row on every request through the session join, so a role change or deactivation takes effect immediately. The `Actor` is built only from that verified row, never from request input.
- **Passwords.** argon2id through `@node-rs/argon2` at the OWASP minimum (memory 19456 KiB, 2 iterations, parallelism 1), capped at 256 characters. The parameters may be raised after measuring on the production instance and never lowered. The same module is used by the app and the seed.
- **Throttling in the database.** Failed logins go to `login_attempts`. After 5 failures for an email string, or 20 for an IP, within 15 minutes, further attempts get 429 with `Retry-After`, even with the correct password. The email is only a key; it does not matter whether an account exists.
- **No account enumeration.** Unknown email and wrong password return the same response, and an unknown email still runs one argon2 verification against a dummy hash so the timing matches.
- Login and logout are audited through `command()` with the real actor; failed attempts are counted and logged through the redacting logger.

## Consequences

### Positive

- Sessions are revocable instantly, which stateless tokens cannot offer.
- A database leak exposes no usable session tokens and only slow, salted password hashes.
- Throttling survives restarts and is shared by any number of processes because it lives in Postgres.
- `SameSite=Lax` plus the Origin check on mutations (ADR [0002](./0002-route-handlers-not-server-actions.md)) gives two independent CSRF defences.

### Negative

- One database read per authenticated request. Acceptable at this scale; an index on `token_hash` keeps it cheap.
- argon2id at these settings costs tens of milliseconds of CPU per login on a small instance, which is the point but also a denial-of-service lever; the throttle limits it.
- No password reset or email verification; accounts are managed by a Super Admin.

### Neutral

- Expired and revoked rows stay in `sessions` until a cleanup job is added; they are harmless because every lookup checks the limits.

## Alternatives considered

- **Auth.js (NextAuth) or another auth framework.** Built for OAuth providers; credentials login with database sessions is the least supported path, and it adds a large dependency to the most security-sensitive code.
- **Signed JWT in a cookie.** No database read, but no instant revocation, and role changes would wait for expiry.
- **bcrypt.** Widely used but not memory-hard; argon2id is the OWASP first choice.
- **In-memory throttling.** Lost on every restart and cold start of the free instance.

## Where it lives

- [`src/modules/auth/session.ts`](../../src/modules/auth/session.ts): token generation, hashing and lifetime checks.
- [`src/modules/auth/cookie.ts`](../../src/modules/auth/cookie.ts): cookie attributes and parsing.
- [`src/modules/auth/throttle.ts`](../../src/modules/auth/throttle.ts): database-backed throttling.
- [`src/modules/auth/service.ts`](../../src/modules/auth/service.ts): login, logout, session resolution, dummy hash.
- [`scripts/lib/password.mjs`](../../scripts/lib/password.mjs): argon2id parameters.
- [`src/platform/config/constants.ts`](../../src/platform/config/constants.ts): session and throttle limits.
- [`src/modules/auth/auth.int.test.ts`](../../src/modules/auth/auth.int.test.ts): login, throttle, expiry and revocation against Postgres.
