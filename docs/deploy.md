# Deploying to Vercel + Neon (production)

Production runs on Vercel with a Neon Postgres database. The owner decided this on
1 November 2026 because the first plan, Render, asks for a payment card before it creates
the free resources. The Docker image is still built and tested in CI. Why and what it
costs: [ADR 0017](adr/0017-production-on-vercel-and-neon.md).

| Resource      | Kind                                                  | Plan  | Region              |
| ------------- | ----------------------------------------------------- | ----- | ------------------- |
| `shiplens`    | Vercel project, Next.js preset (serverless functions) | Hobby | Functions in `iad1` |
| `shiplens-db` | Neon Postgres, added through the Vercel marketplace   | Free  | US East             |

What to know about this setup:

- **No container entrypoint.** Vercel builds the Next.js app itself and runs it as
  serverless functions; the `Dockerfile` is not used. Migrations and the seed therefore
  do not run on deploy: you run them once from your machine
  ([Vercel step 5](#vercel-step-5-migrate-and-seed-from-your-machine)), and again
  whenever a release adds a migration.
- **`APP_ORIGIN` is required.** Vercel does not set `RENDER_EXTERNAL_URL` (the variable a
  container host would provide), so the app cannot derive its origin and refuses to start
  in production without `APP_ORIGIN`.
- **Keep-warm is inactive.** The built-in self-ping only starts when
  `RENDER_EXTERNAL_URL` is set. Serverless functions do not need it.
- **In-memory rate limits are per instance.** The limits on public applications and on
  public verification lookups are kept in memory, so each serverless instance has its
  own counters. Login throttling is stored in the database and stays shared.

## Vercel: recorded facts

| Fact                     | Value                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live URL                 | <https://shiplens-two.vercel.app>                                                                                                                                                          |
| Project                  | `shiplens`, Hobby plan, Next.js framework preset, function region `iad1`                                                                                                                   |
| Database                 | Neon Postgres, Free plan, resource `shiplens-db`, added through the Vercel marketplace                                                                                                     |
| Database created on      | 2026-11-01                                                                                                                                                                                 |
| Database expiry          | No fixed expiry on Neon's free plan. Usage limits apply: see <https://neon.com/pricing>                                                     |
| Database connected to    | Production, Preview and Development environments of the project                                                                                                                            |
| Variables from Neon      | `DATABASE_URL` (pooled, used by the app), `DATABASE_URL_UNPOOLED` (direct, used for migrations)                                                                                            |
| Variables set by hand    | `APP_ORIGIN` = `https://shiplens-two.vercel.app` (Production). `NODE_ENV` is set by Vercel                                                                                                 |
| Migrations and seed      | Run once from a developer machine against `DATABASE_URL_UNPOOLED`; the seed took about 460 s from Pakistan (round trips to US East)                                                        |
| Deploy method            | Git connected on 2026-11-01: a merge to `main` deploys to production; `vercel.json` turns off builds for every other branch                                                                |
| Post-deploy verification | `scripts/verify-deploy.mjs --markdown`: 102/102 PASS on 2026-11-01T07:37:03Z (health 2, smoke 41, headers 44, chain 2, verify 13)                                                          |
| Cold start               | 821 ms                                                                                                                                                                                     |
| Full live browser run    | 2026-11-01, against the Git-deployed `main` (a3d9a7a): every spec on English/Urdu, light/dark, desktop/mobile. Tests that write data run on one project only and were left out (see below) |
| Keep-warm                | Inactive (no `RENDER_EXTERNAL_URL` on Vercel)                                                                                                                                              |

## Vercel step 1: Account and CLI login

1. Create a Vercel account at <https://vercel.com> on the free Hobby plan.
2. On your machine, install the Vercel CLI (`npm install -g vercel`) and log in with
   `vercel login`.
3. You also need Node 24 and a checkout of the repository, as for local development.

## Vercel step 2: Create the project

1. In a clean checkout of `main` (`git status` shows nothing to commit), run
   `vercel link` and create a new project named `shiplens` in your personal (Hobby)
   scope.
2. Vercel detects the Next.js framework preset. Keep the default build settings; the
   project needs no `vercel.json`.
3. Functions run in `iad1` (US East). Keep the database in the same area, because every
   request makes several database round trips.

## Vercel step 3: Add Neon through the marketplace

1. In the Vercel dashboard open the `shiplens` project, then **Storage**, and create a
   Neon Postgres database on the **Free** plan. Name the resource `shiplens-db`.
2. Connect it to the **Production**, **Preview** and **Development** environments.
3. The integration adds the connection variables to the project, among them:
   - `DATABASE_URL`: the pooled connection string. The app uses it.
   - `DATABASE_URL_UNPOOLED`: the direct connection string. Use it for migrations: the
     migration runner takes a session-level advisory lock, which needs a direct
     connection rather than a pooled one.
4. Neon's free plan has no fixed expiry date. It has usage
   limits; see Neon's current free-plan limits at <https://neon.com/pricing>.

## Vercel step 4: Set APP_ORIGIN

`APP_ORIGIN` must be set for Production, to the live URL with no trailing slash:

```sh
vercel env add APP_ORIGIN production     # value: https://shiplens-two.vercel.app
```

Do not set `NODE_ENV` (Vercel sets it), `PORT`, `SEED_ON_BOOT` or `SEED_DEMO_PASSWORD` on
Vercel: nothing seeds at start, and the demo password stays out of the hosting platform.
`KEEP_WARM` has no effect there.

## Vercel step 5: Migrate and seed from your machine

Run this once before the first deploy, and again before deploying any release that adds a
migration. From the repository root, in a Bash shell (Git Bash on Windows):

```sh
# Pull the production variables into an ignored file (matches .env.* in .gitignore).
vercel env pull .env.vercel.production --environment production
UNPOOLED=$(grep '^DATABASE_URL_UNPOOLED=' .env.vercel.production | cut -d= -f2- | tr -d '"')
rm .env.vercel.production                # never commit it, never keep it around

read -rs -p 'Demo password (12+ characters): ' DEMO_PW; echo
DATABASE_URL="$UNPOOLED" SEED_ON_BOOT=true SEED_DEMO_PASSWORD="$DEMO_PW" node scripts/migrate.mjs
unset UNPOOLED
```

The output is `Applied: ...` for the migrations, then the
`seed: ...` lines and `seed: done`. The seed only adds what is missing, so running it again
is safe. Expect it to be slow from far away: from Pakistan the first seed took about
460 seconds, because every statement is a round trip to US East.

## Vercel step 6: Deploy

From the same clean checkout of `main`:

```sh
vercel deploy --prod
```

The project is not connected to Git yet, so this command is how every release reaches
production. Deploy only a commit whose CI is green. The CLI prints the deployment URL;
production is served at <https://shiplens-two.vercel.app>.

## Vercel step 7: Verify

With `DEMO_PW` still in the shell from step 5:

```sh
URL=https://shiplens-two.vercel.app
curl -fsS "$URL/api/health"; echo
curl -fsS "$URL/api/health/db"; echo
BASE_URL="$URL" SMOKE_DEMO_PASSWORD="$DEMO_PW" node scripts/verify-deploy.mjs --markdown
unset DEMO_PW
```

The verification script checks health with the cold-start time, the smoke checks (both
locales, a login for every role, cookie flags), every security header, the audit chain and
the public report verification. It exits 0 only when every check passes. Copy its summary
(never the password) into [Vercel: recorded facts](#vercel-recorded-facts). The first run
recorded 102/102 PASS. The script makes one deliberately wrong login, so do not run it many
times in a row (five failures for one email lock it for 15 minutes).

## Vercel: full live browser run (2026-11-01)

Run from a developer machine in Pakistan against `https://shiplens-two.vercel.app`, with the
Playwright image and the five demo logins, in all four projects (English and Urdu, light and
dark, desktop and mobile). Tests that create or change data are guarded to `desktop-en-light`;
they were run there last, on the live site, and left their rows behind.

| Pass          | Scope                                                              | Result                                                                   |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1             | desktop-ur-dark, mobile-en-dark, mobile-ur-light, all specs        | 440 passed, 167 skipped by design, 16 failed on the default 30 s limit   |
| 2             | desktop-en-light, the 25 spec files that never write               | 129 passed, 21 skipped by design, 2 failed on the default 30 s limit     |
| 3             | desktop-en-light, the 14 spec files that write data                | 58 passed, 8 skipped by design, 1 failed (real bug), 2 not run behind it |
| Retries       | every failure above, one worker, 120 s limit, assertions unchanged | all passed; the one URL assertion that failed twice passed 6 of 6 alone  |
| After the fix | whole branch-register file, 3 repeats                              | 18 of 18 passed                                                          |

The 18 timeout failures were slow requests (Pakistan to US East) and dropped connections;
Vercel logs showed no 5xx in the window. The one real bug was in the branch details form: a
page refresh after a status change reset every field, so text typed just before it landed was
wiped and Save changes went back to disabled. It is fixed in PR #14 (62411c1), with two
regression tests. The tamper journey needs host Docker access and was not run live; it runs
in CI. `verify-deploy` passed 102 of 102 on the Git-deployed build.

The data-writing pass left test rows on the live database (branches, members, content,
approved reports, audit rows). To return to the demo state, wipe the schema and run step 5
again; every report ID and verification code is regenerated.

## Vercel: connect Git (optional)

Once the Vercel account has a GitHub login connection, run `vercel git connect` in the
checkout. From then on a merge to `main` deploys to production automatically, and step 6
is no longer needed. Two cautions:

- Migrations still do not run on deploy. Run step 5 before merging a pull request that adds
  a migration.
- `vercel.json` sets `git.deploymentEnabled` so only `main` builds. Without it, every other
  branch (Dependabot included) would get a preview deployment, and the Neon variables are
  shared with Preview, so previews would run against the production database. To allow
  previews again, give Preview its own Neon branch first, then remove the `"**": false` rule.

## Vercel: re-seeding, redeploying and rolling back

- **Redeploy the same code**: run `vercel deploy --prod` again from a clean checkout of
  `main`.
- **Release with a new migration**: step 5 first, then step 6, then step 7. Between the
  two, the live version runs against the new schema; check that the migration does not
  break it, as with any forward-only migration.
- **Re-seed**: rerun step 5. Existing rows are left alone; only missing ones are added.
- **Rotate the demo password**: rerun step 5 with the new password and
  `SEED_ROTATE_DEMO_PASSWORDS=true` added to the command, once. The seed prints
  `seed: rotated password for ...` per demo user and the audit log records each change.
- **Change a variable**: `vercel env rm` / `vercel env add`, then redeploy; a deployment
  keeps the variables it was built with.
- **Roll back**: promote an earlier production deployment from the project's
  **Deployments** page. Migrations are not rolled back, so go back only to a
  deployment whose code works with the current schema.

## Running the same image locally

- Production image against the dev database (Compose `full` profile):

  ```sh
  docker compose --profile full up -d --build --wait
  ```

  The app is on <http://localhost:3000> with a throwaway local demo password
  (`local-demo-only-pass` unless `SEED_DEMO_PASSWORD` is exported).

- The isolated end-to-end stack (its own database, removed after the run) is described
  in `docs/e2e.md`: `npm run e2e:docker`.
