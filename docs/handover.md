# Handover guide

This page is for whoever runs ShipLens next. It covers what you are taking over, the
accounts you need, how to run it, how to deploy and check it on Vercel (production) or
Render (the container alternative), how to keep the database and the service alive, how to rotate secrets, how to read the audit chain, and
what to do when something breaks.

The step-by-step deploy, and the evidence recorded from the production deploy, live in
[deploy.md](deploy.md): first [Vercel + Neon (production)](deploy.md#deploying-to-vercel--neon-production),
then [Render (container)](deploy.md#alternative-render-container) as the alternative. This
guide links to it rather than repeating it. Why production runs on Vercel:
[ADR 0017](adr/0017-production-on-vercel-and-neon.md).

Render facts on this page were checked against Render's documentation
(<https://render.com/docs/free>) on 1 November 2026. Neon limits change; check them at
<https://neon.com/pricing>.

## 1. What you are taking over

ShipLens is one Next.js application (public bilingual website, private platform and the
`/api/v1` API) backed by one PostgreSQL database. Production is the Vercel project
`shiplens` (Hobby plan) at <https://shiplens-two.vercel.app>, with a Neon Postgres database
on the free plan. The same app also ships as one Docker image for Render, the documented
container alternative. Every change to data goes through one command wrapper that
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
| Hosting | Vercel project `shiplens` (Hobby plan, live at <https://shiplens-two.vercel.app>) with the Neon Postgres database `shiplens-db` (Free plan) added through the Vercel marketplace. Render (`render.yaml`) is the documented alternative and is not deployed | OWNER-CONFIRM: Vercel account owner (name and login email) |
| Demo password | The value of `SEED_DEMO_PASSWORD` used when the seed runs (from a developer machine for Vercel; typed into the dashboard on Render) | Kept in the owner's password manager; shared with judges only through the submission form. Never in the repository, chat or a file |
| Security reports | `szahid.bese24seecs@seecs.edu.pk` (see [SECURITY.md](../SECURITY.md)) | Sheikh Abdullah Bin Zahid |

When you hand over, add the new maintainer as a collaborator on GitHub and give them access
to the Vercel project and its Neon database, then rotate the demo password (section 8).

## 3. Environment variables

Every variable the code reads is listed in `.env.example` (a test,
`scripts/env-example.test.mjs`, fails if code reads one that is not). Values are never
committed; refer to them by name.

| Name | Purpose | Who sets it | Secret |
| --- | --- | --- | --- |
| `DATABASE_URL` | Postgres connection string | You locally; on Vercel the Neon integration sets it (pooled); Render injects it from `shiplens-db` (`render.yaml`) | Yes in production |
| `DATABASE_URL_UNPOOLED` | Direct (unpooled) Neon connection string. The app does not read it; pass it as `DATABASE_URL` when running migrations | The Neon integration on Vercel | Yes |
| `APP_ORIGIN` | Public origin used for the Origin check and absolute links | You locally; on Vercel set by hand to `https://shiplens-two.vercel.app` for Production (required, because Vercel has no `RENDER_EXTERNAL_URL`); not set on Render (the app falls back to `RENDER_EXTERNAL_URL`) | No |
| `RENDER_EXTERNAL_URL` | Public `https://` URL of the service; also the keep-warm target | Render, automatically. Leave empty locally | No |
| `PORT` | Port the server listens on | Docker image (3000), `render.yaml` (10000) | No |
| `NODE_ENV` | `development`, `test` or `production` | Next.js, Vercel, the image, `render.yaml` | No |
| `LOG_LEVEL` | `debug`, `info`, `warn` or `error` | You or Render (`info`) | No |
| `KEEP_WARM` | `0` turns the built-in self-ping off | You or Render (unset means on) | No |
| `SEED_ON_BOOT` | `true` runs the idempotent seed after migrations | You locally; `render.yaml` sets `true` | No |
| `SEED_DEMO_PASSWORD` | Password of the five demo logins, 12+ characters | You locally; typed into the Render dashboard (`sync: false`) | **Yes** |
| `SEED_ROTATE_DEMO_PASSWORDS` | `true` for one boot re-hashes the demo passwords | You or Render, then remove it | No |
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

### Alternative: Render (container)

The full click-by-click version is
[deploy.md, Alternative: Render (container)](deploy.md#alternative-render-container), steps 1
to 7. The short form:

1. **Prerequisites.** The branch Render will watch (normally `main`) is pushed, contains
   `render.yaml`, and its latest commit has a green `ci-ok` check. The demo password
   (12+ characters) is in your password manager.
2. **Create the Blueprint.** Render Dashboard, **New > Blueprint**, connect the
   repository, Blueprint name `shiplens`, the branch from step 1, empty Blueprint path.
   Render must list exactly two resources: `shiplens-db` (Postgres 16, Free, Singapore)
   and `shiplens` (Docker web service, Free, Singapore). Both stay in one region; only
   one free Postgres can be active per workspace.
3. **Region.** Singapore, set in `render.yaml` for both resources. If it is not offered,
   change `region:` for both, push, and start again.
4. **Secret.** Paste `SEED_DEMO_PASSWORD` when Render asks (it is the only value you
   type). Do not set `APP_ORIGIN`: the app derives its origin from
   `RENDER_EXTERNAL_URL`. Set `APP_ORIGIN` (exact live URL, no trailing slash) only if
   logins from the browser return 403 (see section 11).
5. **Keep-warm.** Leave `KEEP_WARM` unset: it is on by default whenever
   `RENDER_EXTERNAL_URL` is an `https:` URL (section 7).
6. **Deploy Blueprint.** The first deploy does not wait for CI. The container start
   command (`Dockerfile` `CMD`) runs `node scripts/migrate.mjs`, which applies pending
   migrations and, because `SEED_ON_BOOT=true`, runs the idempotent seed, then starts the
   server. Nothing has to be run by hand. Render marks the deploy **Live** once
   `GET /api/health` answers 200.
7. **Post-deploy check.** From the repository root on your machine, without echoing the
   password:

   ```sh
   URL=https://shiplens-xxxx.onrender.com   # the live URL, no trailing slash
   read -rs -p 'Demo password: ' DEMO_PW; echo
   BASE_URL="$URL" SMOKE_DEMO_PASSWORD="$DEMO_PW" node scripts/verify-deploy.mjs
   unset DEMO_PW
   ```

   `scripts/verify-deploy.mjs` is the post-deploy check: health with the cold-start time,
   database health, the smoke checks (both locales, a login for every role, cookie flags),
   the security headers and CSP nonce, the audit chain status, and the public verification
   of an approved report through the API and both language pages. It exits 0 only when
   every check passes; add `--markdown` to print a summary block for the deploy record.
   The smoke script alone is step 6 of [deploy.md](deploy.md#step-6-verify-the-deployment-from-your-machine).
   The check makes one deliberately wrong login, so do not run it many times in a row
   (section 11, login lockout).
8. **Record the result.** Copy the summary lines (never the password) into
   [deploy.md, Recorded facts](deploy.md#recorded-facts), together with the live URL,
   the deployed commit and the database dates from section 6.

After the first deploy, Render deploys a new commit on the watched branch only after its
CI checks pass (`autoDeployTrigger: checksPass`). Rollback, branch switching and moving to
a paid plan: [deploy.md](deploy.md#rollback).

## 6. Database

| Fact | Value |
| --- | --- |
| Name, plan, region | `shiplens-db`, Neon Postgres, Free plan, US East (near the `iad1` functions) |
| Database created on | 2026-11-01 (Neon, added through the Vercel marketplace) |
| Expiry | No fixed expiry on Neon's free plan, unlike Render's free Postgres (30 days). Usage limits apply: check Neon's current free-plan limits at <https://neon.com/pricing> and the usage shown for the database |
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

### If you run the Render alternative

| Fact | Value |
| --- | --- |
| Name, plan, region | `shiplens-db`, Render Postgres 16, Free, Singapore |
| Database created on | Record it from Render Dashboard -> shiplens-db -> Info if you deploy there |
| Free tier expires on | Creation date + 30 days |
| Deleted on (if not upgraded) | Expiry date + 14 days |
| Storage | 1 GB, fixed |
| Backups | None on the free plan |
| Outside access | Refused: `ipAllowList: []` in `render.yaml`; the web service uses the private connection string |

Put the expiry date in a calendar with a reminder a week before.

**What happens at expiry.** Render's free Postgres expires 30 days after it is created.
The database then stops accepting connections: `/api/health` still answers 200, but
`/api/health/db` answers 503 and every page that reads data fails. You have a 14-day
grace period to upgrade it to a paid plan; after that Render deletes the database and its
data. One free database per workspace means you cannot simply create a second one
alongside it.

**Take a backup on Render** (do this before expiry, and before any risky change). Free
Render databases have no backups, so export one yourself with the external connection string:

1. **shiplens-db > Networking**: add your current IP address to the allow list.
2. **shiplens-db > Info > Connections**: copy the **External Database URL** into your
   shell without echoing it, then dump:

   ```sh
   read -rs -p 'External database URL: ' EXTERNAL_DATABASE_URL; echo
   pg_dump --no-owner --format=custom "$EXTERNAL_DATABASE_URL" > shiplens-YYYYMMDD.dump
   unset EXTERNAL_DATABASE_URL
   ```

   Use a `pg_dump` of major version 16 or newer.
3. Remove your IP from the allow list again. Store the dump outside the repository (it
   holds password hashes and session hashes); never commit it.

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
known verification code still verifies. `--disable-triggers` needs superuser rights;
Render's database user is not a superuser, so a restore into a Render database has not
been rehearsed, and neither has a restore into Neon. On Render, prefer the upgrade path
below, which needs no restore.

**Upgrade path (Render).** Before day 30: **shiplens-db > Upgrade** to a paid plan. Data is kept
and the expiry no longer applies. Then set `plan:` of `shiplens-db` in `render.yaml` to the
same paid plan so a Blueprint sync does not try to change it back. The alternative, a new
free database, loses all data; the seed recreates the demo branch, users and demo data,
but historical audit events and issued verification codes are gone, so printed QR codes
stop working. Details: [deploy.md, Before the database expires](deploy.md#before-the-database-expires).

## 7. Keeping the service warm

**On Vercel (production) there is nothing to do.** The built-in self-ping starts only when
`RENDER_EXTERNAL_URL` is set, which Vercel does not do, so it is inactive there; serverless
functions do not need it (measured cold start: 821 ms). The rest of this section applies to
the Render alternative.

Render's free web service spins down after 15 minutes without inbound traffic, and the
next request waits about a minute while it starts. ShipLens keeps itself awake from
inside the app; no outside pinger or scheduled CI job is involved.

- **How it works.** `src/instrumentation.ts` starts the pinger once per server process
  (`src/platform/keepwarm/index.ts`). It runs only when `RENDER_EXTERNAL_URL` is a valid
  `https:` URL and `KEEP_WARM` is not `0`, so it never runs locally or in CI. It requests
  `<RENDER_EXTERNAL_URL origin>/api/health` about 60 to 90 seconds after start, then every
  10 minutes plus or minus 90 seconds, always well inside the 15-minute idle window. Each
  request times out after 10 seconds; failures are logged and never crash the server.
- **Evidence.** In **shiplens > Logs**, search for `keepwarm.ping`. Each success is one
  JSON line at info level with the HTTP status and the time taken. Failures log
  `keepwarm.ping_failed` at warn level; a failure to start logs `keepwarm.start_failed`.
- **Turn it off.** **shiplens > Environment**, add `KEEP_WARM` = `0`, save and deploy.
- **Hour budget.** A workspace gets 750 free instance hours per calendar month; one
  always-on service uses at most 744 (31 days x 24 hours). That leaves no hours for a
  second free service in the same workspace that should also stay awake.
- **Limits.** If the instance is ever stopped (a failed deploy, platform maintenance,
  free hours or bandwidth exhausted), nothing inside it can wake it; the first visitor
  does and waits for the cold start. Render may also restart free instances at any time.
- **Optional extra.** An external uptime monitor that requests `/api/health` every few
  minutes would also wake a stopped instance. It is not configured; add one only if the
  built-in ping proves insufficient, and point it at `/api/health` (no database call).

Why it is built this way: [ADR 0015](adr/0015-built-in-keep-warm.md).

## 8. Secrets and access

The only application secret is the demo password. Database credentials are managed by
the Neon integration on Vercel (by Render on the alternative) and injected through
`DATABASE_URL`.

**Rotate the demo password (preferred).** Use the audited seed rotation. On Vercel, rerun
the migrate and seed command from your machine once with the new `SEED_DEMO_PASSWORD` and
`SEED_ROTATE_DEMO_PASSWORDS=true`
([deploy.md, Vercel: re-seeding](deploy.md#vercel-re-seeding-redeploying-and-rolling-back)).
On Render, follow [deploy.md, Rotating the demo password](deploy.md#rotating-the-demo-password):
set both for one deploy, then remove the flag. Each change is recorded in the audit log.

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

**Access.** Remove departing people from the GitHub repository and the Render workspace.
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

- `GET /api/health`: liveness, no database call. Render's health check and the keep-warm
  ping use it.
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
  service that Render replaces, rather than appends to, a value the client sends
  ([security.md, Residual risks](security.md#residual-risks)).
- **Single instance (Render).** Free Render web services run one instance. Do not scale
  out there without first moving the in-memory limits to a shared store.

## 11. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| First request takes about a minute (Render) | Cold start after the free instance spun down or was restarted. Check `keepwarm.ping` lines in the logs; if they stopped, see section 7. |
| Deploy fails at start with a migration checksum error | A migration file that was already applied has changed (the checksum covers the text with line endings normalised, so only real edits count). Migrations are forward-only: restore the original file content from git and add a new migration for the change. Never edit an applied migration. |
| Deploy fails at start; log mentions `SEED_DEMO_PASSWORD` | Missing or shorter than 12 characters. Set it under **Environment** and save. |
| `POST` requests (login, any change) return 403 from the browser | The browser's `Origin` differs from the origin the app derived. Set `APP_ORIGIN` to the exact live URL (scheme and host, no trailing slash) and redeploy. |
| Login answers 429, or keeps failing after the smoke script ran | Login lockout: 5 failed logins for one email in 15 minutes. Wait 15 minutes from the last failure; the response's `Retry-After` header says how long. |
| Browser console shows "Refused to execute inline script" or another Content Security Policy violation | A script without the per-request nonce, or from another origin. Do not add `'unsafe-inline'` to `script-src`; load the script through Next.js so it receives the nonce. The policy and its reasons: [ADR 0012](adr/0012-nonce-based-csp.md) and [security.md](security.md#security-headers). |
| The public verification page says "This report could not be traced" (`unanchored`) | The report has no `report.approve` audit event, or no earlier submit event carrying its totals (for example it was approved by direct SQL). The figures cannot be proven; investigate how the report was approved. Do not insert audit rows by hand. |
| The public verification page says "The audit record cannot be trusted right now" (`chain_broken`) | See section 9, incident steps. |
| Pages fail with a database error after about a month (Render) | The free Render database expired. See section 6. On Neon, check the usage limits instead. |

More deploy-specific cases: [deploy.md, Troubleshooting](deploy.md#troubleshooting).

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
- **Keep-warm** ([ADR 0015](adr/0015-built-in-keep-warm.md)): inactive on Vercel. On
  Render it cannot wake a stopped instance and uses the whole monthly free hour budget.
- **Database**: Neon's free plan has no fixed expiry but has usage limits (section 6).
  On Render the free tier expires after 30 days and has no backups.
- **Deploy on Render**: on the free plan migrations run at container start, not before
  traffic. Next step on a paid plan: `preDeployCommand: node scripts/migrate.mjs`
  ([deploy.md, Moving to a paid plan](deploy.md#moving-to-a-paid-plan)).
- **Tests** ([ADR 0016](adr/0016-testing-strategy.md)): coverage thresholds measure lines
  run, not correctness; the behavioural suites carry the weight.
