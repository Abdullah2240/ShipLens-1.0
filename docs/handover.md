# Handover guide

This page is for whoever runs ShipLens next. It covers what you are taking over, the
accounts you need, how to run it, how to deploy and check it on Vercel (production), how to keep the database and the service
alive, how to rotate secrets, how to read the audit chain, and what to do when something
breaks.

The step-by-step deploy, and the evidence recorded from the production deploy, live in
[deploy.md](deploy.md): [Vercel + Neon (production)](deploy.md#deploying-to-vercel--neon-production).
This guide links to it rather than repeating it. Why production runs on Vercel:
[ADR 0017](adr/0017-production-on-vercel-and-neon.md).

Neon limits change; check them at <https://neon.com/pricing>.

## 1. What you are taking over

ShipLens is one Next.js application (public bilingual website, private platform and the
`/api/v1` API) backed by one PostgreSQL database. Production is the Vercel project
`shiplens` (Hobby plan) at <https://shiplens-two.vercel.app>, with a Neon Postgres database
on the free plan. The same app also ships as one Docker image (the `Dockerfile` in the repository). Every change to data goes through one command wrapper that
checks the permission table and writes an audit event in the same transaction; audit
events are linked in a tamper-evident hash chain, and approved weekly reports carry a
public verification code.

Start with:

- [README.md](../README.md): what it does, stack, local run, tests.
- [adr/](adr/README.md): why it is built the way it is (one record per decision).
- [api.md](api.md): every endpoint, request and response.
- [permissions.md](permissions.md): the role-by-action table, generated from
  `src/platform/authz/permissions.ts`.
- [security.md](security.md): OWASP Top 10 mapping with file references.
- [verification.md](verification.md): the audit chain and the public report check.
- [test-logins.md](test-logins.md): the five demo users.

## 2. Accounts and ownership

| What | Where | Who holds it |
| --- | --- | --- |
| Source code | GitHub repository `Abdullah2240/ShipLens-1.0` | Repository owner and collaborators |
| CI | GitHub Actions in the same repository (`.github/workflows/ci.yml`, required check `ci-ok`) | Same as the repository |
| Hosting | Vercel project `shiplens` (Hobby plan, live at <https://shiplens-two.vercel.app>) with the Neon Postgres database `shiplens-db` (Free plan) added through the Vercel marketplace. | Sheikh Abdullah Bin Zahid (the repository owner) |
| Demo password | The value of `SEED_DEMO_PASSWORD` used when the seed runs (from a developer machine for Vercel) | Kept in the owner's password manager; shared with judges only through the submission form. Never in the repository, chat or a file |
| Security reports | `szahid.bese24seecs@seecs.edu.pk` (see [SECURITY.md](../SECURITY.md)) | Sheikh Abdullah Bin Zahid |

When you hand over, add the new maintainer as a collaborator on GitHub and give them access
to the Vercel project and its Neon database, then rotate the demo password (section 8).

## 3. Environment variables

Every variable the code reads is listed in `.env.example` (a test,
`scripts/env-example.test.mjs`, fails if code reads one that is not). Values are never
committed; refer to them by name.

| Name | Purpose | Who sets it | Secret |
| --- | --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | You locally; on Vercel the Neon integration sets it (pooled) | Yes in production |
| `DATABASE_URL_UNPOOLED` | Direct (unpooled) Neon connection string. The app does not read it; pass it as `DATABASE_URL` when running migrations | The Neon integration on Vercel | Yes |
| `APP_ORIGIN` | Public origin used for the Origin check and absolute links | You locally; on Vercel set by hand to `https://shiplens-two.vercel.app` for Production (required, because Vercel has no `RENDER_EXTERNAL_URL`); on a container host that sets `RENDER_EXTERNAL_URL` the app falls back to it | No |
| `RENDER_EXTERNAL_URL` | Public `https://` URL of the service; also the keep-warm target | Set by a container host such as Render; not set on Vercel. Leave empty locally | No |
| `PORT` | Port the server listens on | Docker image (3000) | No |
| `NODE_ENV` | `development`, `test` or `production` | Next.js, Vercel, the image | No |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error` | You (`info` by default) | No |
| `KEEP_WARM` | `0` turns the built-in self-ping off | You (unset means on) | No |
| `SEED_ON_BOOT` | `true` runs the idempotent seed after migrations | You locally; not used on Vercel | No |
| `SEED_DEMO_PASSWORD` | Password of the five demo logins, 12+ characters | You locally; on Vercel, a variable you set | **Yes** |
| `SEED_ROTATE_DEMO_PASSWORDS` | `true` for one boot re-hashes the demo passwords | You, then remove it | No |
| `TEST_DATABASE_URL` | Integration test database (created and migrated by the test setup) | You, CI | No (throwaway local) |
| `BASE_URL` | Base URL of a running app for the smoke script, page check and Playwright | You, CI | No |
| `SMOKE_DEMO_PASSWORD` | Demo password the smoke and post-deploy scripts log in with | You, CI (generated per run) | Yes when it targets the live site |
| `E2E_PROJECT`, `E2E_PORT` | Compose project name and host port of the end-to-end stack | You, CI | No |
| `E2E_DEMO_PASSWORD` | Demo password seeded into the throwaway end-to-end stack | You, CI (generated per run) | Keep out of git |
| `E2E_DB_EXEC` | `1` allows journeys that `docker compose exec` into the database | You | No |
| `PLAYWRIGHT_VERSION` | Playwright version of the end-to-end runner image | Docker build argument | No |
| `E2E_EXPECTED_JSON` | Path of `db/seed/expected.json` for the exact-value end-to-end specs, when the runner cannot find it from its working directory | You, only for such runs | No |
| `API_DOC_ROOT` | Repository root the API doc generator reads; its tests point it at a fixture tree | Tooling only | No |

There is no session secret: sessions are random tokens stored only as SHA-256 hashes in
the database.

## 4. Run locally

You need Node 24 and Docker. From the repository root, in Bash (Git Bash on Windows):

```sh
docker compose up -d --wait db                   # Postgres 16 on localhost:5434
cp .env.example .env.local                       # set SEED_ON_BOOT=true and SEED_DEMO_PASSWORD (12+ characters)
npm ci
node --env-file=.env.local scripts/migrate.mjs   # migrations, then the demo seed
npm run dev                                      # http://localhost:3000
```

Checks before you push:

```sh
npm run lint && npm run typecheck
npm test                       # unit tests
npm run test:integration       # needs the database above
npm run test:coverage          # all tests with the coverage thresholds
```

The production image and the end-to-end stack: [deploy.md](deploy.md#running-the-same-image-locally)
and [e2e.md](e2e.md).

## 5. Deploy (runbook)

### Vercel + Neon (production)

The full version is [deploy.md, Deploying to Vercel + Neon (production)](deploy.md#deploying-to-vercel--neon-production).
The short form:

1. **Project and database.** Vercel project `shiplens` (Hobby, Next.js preset, functions
   in `iad1`) with Neon `shiplens-db` (Free) added through the Vercel marketplace and
   connected to Production, Preview and Development. Neon sets `DATABASE_URL` (pooled, the
   app) and `DATABASE_URL_UNPOOLED` (direct, migrations).
2. **Origin.** `APP_ORIGIN` = `https://shiplens-two.vercel.app` for Production.
3. **Migrate and seed from your machine** (nothing runs at start on Vercel): pull the
   variables with `vercel env pull <file> --environment production` into an ignored file,
   then run
   `DATABASE_URL="<unpooled>" SEED_ON_BOOT=true SEED_DEMO_PASSWORD="<12+ chars>" node scripts/migrate.mjs`.
   Delete the pulled file afterwards and never commit it. Repeat before any release that
   adds a migration.
4. **Deploy.** `vercel deploy --prod` from a clean checkout of `main` (no Git connection
   yet; `vercel git connect` turns on automatic deploys from `main` once the Vercel
   account has a GitHub login connection).
5. **Post-deploy check.**
   `BASE_URL=https://shiplens-two.vercel.app SMOKE_DEMO_PASSWORD=... node scripts/verify-deploy.mjs --markdown`
   (read the password without echoing it, as in step 7 below). Recorded on
   2026-11-01T07:37:03Z: 102/102 PASS, cold start 821 ms
   ([deploy.md, Vercel: recorded facts](deploy.md#vercel-recorded-facts)).

## 6. Database

| Fact | Value |
| --- | --- |
| Name, plan, region | `shiplens-db`, Neon Postgres, Free plan, US East (near the `iad1` functions) |
| Database created on | 2026-11-01 (Neon, added through the Vercel marketplace) |
| Expiry | No fixed expiry on Neon's free plan. Usage limits apply: check Neon's current free-plan limits at <https://neon.com/pricing> and the usage shown for the database |
| Connection strings | `DATABASE_URL` (pooled, used by the app) and `DATABASE_URL_UNPOOLED` (direct, for migrations and `pg_dump`), both set on the Vercel project by the integration |
| Backups | Take your own `pg_dump` before any risky change (below); for what Neon itself keeps, see its current free-plan limits |

**Take a backup on Neon.** Pull the production variables and extract the direct URL into
`UNPOOLED` as in
[deploy.md, Vercel step 5](deploy.md#vercel-step-5-migrate-and-seed-from-your-machine), then
dump:

```sh
pg_dump --no-owner --format=custom "$UNPOOLED" > shiplens-YYYYMMDD.dump
unset UNPOOLED
```

Store the dump outside the repository (it holds password hashes and session hashes);
never commit it. Restoring is described below and is the same for any host.

**Restore.** The database has triggers that matter on restore: `audit_events_chain`
recomputes the chain on every insert, `weekly_reports_issue_verification_*` issue new
verification codes when approved reports are inserted, and the finance guards check
report and collection writes. A plain data restore would therefore rewrite chain hashes
and verification codes, and every seal a donor holds would stop matching. Restore with
triggers disabled, as a role allowed to do so, into an empty database:

```sh
# rehearse locally first (the local compose user is a superuser)
createdb -h localhost -p 5434 -U shiplens shiplens_restore
pg_restore --no-owner --disable-triggers -h localhost -p 5434 -U shiplens \
  -d shiplens_restore shiplens-YYYYMMDD.dump
```

Then point a local app at it and confirm the audit chain is intact (section 9) and a
known verification code still verifies. `--disable-triggers` needs superuser rights, and a restore into Neon has not been rehearsed.

## 7. Keeping the service warm

**On Vercel (production) there is nothing to do.** Serverless functions do not need a
keep-warm ping (measured cold start: 821 ms). The app still contains a built-in self-ping
that starts only when `RENDER_EXTERNAL_URL` is set, which Vercel does not do, so it is
inactive; it exists for container hosts that sleep idle services. How it works and why it is
built this way: [ADR 0015](adr/0015-built-in-keep-warm.md).

## 8. Secrets and access

The only application secret is the demo password. Database credentials are managed by
the Neon integration on Vercel and injected through
`DATABASE_URL`.

**Rotate the demo password (preferred).** Use the audited seed rotation. On Vercel, rerun
the migrate and seed command from your machine once with the new `SEED_DEMO_PASSWORD` and
`SEED_ROTATE_DEMO_PASSWORDS=true`
([deploy.md, Vercel: re-seeding](deploy.md#vercel-re-seeding-redeploying-and-rolling-back)).
Set both for one deploy, then remove the flag. Each change is recorded in the audit log.

**Rotate by hand (any account, or when a deploy is not possible).** This bypasses the
command wrapper, so it writes no audit event; note the date and reason in your handover
log.

1. Generate an argon2id hash on your machine, from the repository root (after `npm ci`):

   ```sh
   read -rs -p 'New password: ' NEW_PW; echo
   NEW_PW="$NEW_PW" node --input-type=module -e "
   import { hashPassword } from './scripts/lib/password.mjs';
   console.log(await hashPassword(process.env.NEW_PW));"
   unset NEW_PW
   ```

2. Connect to the database (section 6 explains outside access) and update the users and
   revoke their sessions in one transaction:

   ```sql
   BEGIN;
   UPDATE users SET password_hash = '<hash from step 1>', updated_at = now()
     WHERE lower(email) IN ('admin@shiplens.test');   -- list the accounts to change
   UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;
   COMMIT;
   ```

   Revoking every live session signs everyone out; their next request asks them to log in
   again.
3. Remove your IP from the database allow list, update the password manager, and never
   commit the password or the hash.

**Access.** Remove departing people from the GitHub repository, the Vercel project and the Neon database.
To lock an application user out without deleting history, set `is_active = false`; a
session of an inactive user is no longer accepted (`src/modules/auth/session.ts`).

## 9. Operating the audit chain

Every row in `audit_events` carries a sequence number, the hash of the previous row and
its own SHA-256 hash, computed by the `audit_events_chain` database trigger
(`db/migrations/202610311400_audit_chain.sql`). How it works and its limits:
[verification.md](verification.md).

- **Check it.** `GET /api/v1/audit/chain` (Super Admin and Finance Reviewer) returns the
  chain status: `intact` with the number of events and the head, `broken` with the first
  failing event number and the reason (`sequence_gap`, `link_mismatch` or
  `hash_mismatch`), or `empty`. Results are cached for 60 seconds; `?fresh=1` walks the
  whole chain again. The audit viewer (`/en/audit`) shows the same result as a badge:
  "Audit chain intact" with "N events checked at T", or "Audit chain broken at event #N"
  with the reason in plain words (for example "This event was changed after it was
  recorded." for `hash_mismatch`); its "Check again" link forces a fresh walk. What each
  reason means: [verification.md, The audit chain](verification.md#the-audit-chain).
- **What a broken chain means.** Someone or something changed, inserted or removed an
  audit row outside the normal write path. The append-only triggers block `UPDATE`,
  `DELETE` and `TRUNCATE` on `audit_events`, so a break needs database rights beyond the
  application's normal behaviour (a disabled trigger, a superuser, a restore done wrong).
  The public check then shows every report as `chain_broken`.

**Incident steps when the chain is broken:**

1. Do not edit, delete or "repair" any audit row. The evidence is the rows as they are.
2. Take a dump immediately (section 6) and store it somewhere read-only, with the time.
3. Note the event number and reason from `GET /api/v1/audit/chain?fresh=1` and the row
   around it:
   `SELECT chain_seq, id, occurred_at, actor_id, action, entity_type, entity_id FROM audit_events WHERE chain_seq BETWEEN <N - 2> AND <N + 2> ORDER BY chain_seq;`
4. Compare seals held outside the database: printed or shared reports carry a seal (the
   first 16 characters of their approval event's hash). A seal that no longer matches
   shows which approvals were rewritten.
5. Rotate the demo password and database credentials (**shiplens-db > Settings**), revoke
   sessions, and review who had dashboard or database access.
6. Escalate to the repository owner and the security contact in
   [SECURITY.md](../SECURITY.md) with the dump location, event number and timeline.

## 10. Health, logs and rate limits

- `GET /api/health`: liveness, no database call. The keep-warm ping uses it.
- `GET /api/health/db`: runs `SELECT 1` with a 2-second limit; 503 with no error detail
  when the database is down or expired.
- **Logs.** One JSON line per event from `src/platform/log/logger.ts`; keys that look like
  passwords, tokens, secrets, cookies, authorisation headers or hashes are replaced with
  `[redacted]`. Read them under **shiplens > Logs** (free workspaces keep 7 days).
  Useful searches: `authz.denied`, `keepwarm.ping`, `error`.
- **Login throttling** is stored in the database (`login_attempts`): 5 failures per email
  or 20 per IP address in 15 minutes block further attempts with 429 and `Retry-After`
  (`src/modules/auth/throttle.ts`). It survives restarts and is shared by all instances.
- **Public verification lookups** are limited to 30 per minute per client IP and public
  membership applications to 5 per hour per client IP, in memory, per server process
  (`src/platform/rate-limit/index.ts`). A restart resets them, and a second instance has
  its own counters. On Vercel each serverless instance keeps its own counters, so the
  effective limit is higher when traffic is spread over several instances; this trade-off
  is accepted ([ADR 0017](adr/0017-production-on-vercel-and-neon.md)). Login throttling
  above is in the database and is not affected. The client IP is the first `X-Forwarded-For` entry; confirm once on the live
  service that the platform replaces, rather than appends to, a value the client sends
  ([security.md, Residual risks](security.md#residual-risks)).

## 11. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Deploy fails at start with a migration checksum error | A migration file that was already applied has changed (the checksum covers the text with line endings normalised, so only real edits count). Migrations are forward-only: restore the original file content from git and add a new migration for the change. Never edit an applied migration. |
| Deploy fails at start; log mentions `SEED_DEMO_PASSWORD` | Missing or shorter than 12 characters. Set it under **Environment** and save. |
| `POST` requests (login, any change) return 403 from the browser | The browser's `Origin` differs from the origin the app derived. Set `APP_ORIGIN` to the exact live URL (scheme and host, no trailing slash) and redeploy. |
| Login answers 429, or keeps failing after the smoke script ran | Login lockout: 5 failed logins for one email in 15 minutes. Wait 15 minutes from the last failure; the response's `Retry-After` header says how long. |
| Browser console shows "Refused to execute inline script" or another Content Security Policy violation | A script without the per-request nonce, or from another origin. Do not add `'unsafe-inline'` to `script-src`; load the script through Next.js so it receives the nonce. The policy and its reasons: [ADR 0012](adr/0012-nonce-based-csp.md) and [security.md](security.md#security-headers). |
| The public verification page says "This report could not be traced" (`unanchored`) | The report has no `report.approve` audit event, or no earlier submit event carrying its totals (for example it was approved by direct SQL). The figures cannot be proven; investigate how the report was approved. Do not insert audit rows by hand. |
| The public verification page says "The audit record cannot be trusted right now" (`chain_broken`) | See section 9, incident steps. |

## 12. Known limits and next steps

From the consequences recorded in the ADRs:

- **Audit chain** ([ADR 0013](adr/0013-tamper-evident-audit-chain.md)): someone with full
  database rights can rewrite the whole chain from an edited row onward, and deleting the
  newest rows leaves no gap. Seals held outside the database are the mitigation. Next
  step: publish a signed daily digest of the chain head outside the database.
- **Public verification** ([ADR 0014](adr/0014-public-report-verification.md)): the rate
  limit is in memory per process; a code is a bearer reference to one report's public
  summary. Next step: a shared rate limit store if the service ever runs more than one
  instance.
- **CSP** ([ADR 0012](adr/0012-nonce-based-csp.md)): `style-src 'unsafe-inline'` remains
  for React style attributes and font CSS.
- **Hosting** ([ADR 0017](adr/0017-production-on-vercel-and-neon.md)): production runs
  Vercel's build, not the Docker image; migrations and the seed are a manual step from a
  developer machine; in-memory rate limits count per serverless instance. Next steps:
  connect the project to Git (`vercel git connect`) and move the in-memory limits to a
  shared store.
- **Keep-warm** ([ADR 0015](adr/0015-built-in-keep-warm.md)): inactive on Vercel, where it
  is not needed.
- **Database**: Neon's free plan has no fixed expiry but has usage limits (section 6), and
  you take your own backups.
- **Tests** ([ADR 0016](adr/0016-testing-strategy.md)): coverage thresholds measure lines
  run, not correctness; the behavioural suites carry the weight.
