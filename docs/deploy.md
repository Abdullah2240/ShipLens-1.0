# Deploying to Render

ShipLens runs on Render as two resources, both on the free plan and both described in
`render.yaml` at the repository root (a Render "Blueprint"):

| Resource      | Kind                                | Plan | Region    |
| ------------- | ----------------------------------- | ---- | --------- |
| `shiplens`    | Web service built from `Dockerfile` | Free | Singapore |
| `shiplens-db` | Render Postgres 16                  | Free | Singapore |

Every time the web service starts, the container does three things in order:

1. `node scripts/migrate.mjs` applies any pending database migrations.
2. Because `SEED_ON_BOOT=true`, the same script runs the seed. The seed only adds what is
   missing (the sample branch, the five demo users, the demo data), so it is safe on every
   start and never changes or deletes existing rows.
3. The Next.js server starts on port 10000 and Render begins routing traffic once
   `GET /api/health` answers 200.

No command has to be run by hand on Render, before or after a deploy.

## Recorded facts

Fill these in during the first deploy.

- Database created on: \_\_\_\_ (expires 30 days later: \_\_\_\_; deleted 14 days after
  that unless upgraded)
- Live URL: \_\_\_\_
- Region: \_\_\_\_
- Plans: web \_\_\_\_, database \_\_\_\_
- Card asked for at sign-up: \_\_\_\_
- Deployed branch and commit: \_\_\_\_
- Smoke script result: \_\_\_\_
- Playwright `@smoke` result: \_\_\_\_
- Measured login latency (5 sequential logins): median \_\_\_\_, worst \_\_\_\_
- Deviations from `render.yaml`: \_\_\_\_

## Before you start

- [ ] The branch Render will watch is pushed to GitHub and contains `render.yaml`.
      Normally this is `main` after the overnight work is reviewed and merged. A pushed
      integration branch is acceptable for the very first deploy; switch to `main`
      afterwards (see [Switching the deployed branch](#switching-the-deployed-branch)).
- [ ] CI is green on that branch's latest commit (the `ci-ok` check). The service uses
      `autoDeployTrigger: checksPass`: after the first deploy, Render only deploys a new
      commit once its CI checks have passed.
- [ ] You have chosen the demo password: at least 12 characters, stored in your password
      manager. It is the password of the five test logins in `docs/test-logins.md`. It is
      never committed, never pasted into chat, never written to a file in the repository.
- [ ] On your own machine: a checkout of the same branch, Node 24 (`node --version`) and
      Docker Desktop running (for the Playwright check).

## Step 1: Create the Render account

1. Go to <https://render.com> and choose **Get Started**. Signing up with GitHub is the
   simplest, because Render needs access to the repository anyway.
2. Confirm your email if asked. Render creates a personal workspace for you; free
   resources live there.
3. Note whether Render asked for a payment card, and write it under
   [Recorded facts](#recorded-facts). Free resources do not need one, but Render may ask.

## Step 2: Connect GitHub

1. When Render asks for repository access (during sign-up, or at the first **Connect**
   button in step 3), choose **Only select repositories** and pick the ShipLens repository.
2. If the repository does not appear later, open **Account Settings > Git providers**
   (or GitHub **Settings > Applications > Render > Configure**) and grant access to it.

## Step 3: Create the Blueprint

1. In the Render Dashboard, click **New > Blueprint**.
2. Click **Connect** next to the ShipLens repository.
3. Fill in the form:
   - **Blueprint Name**: `shiplens`.
   - **Branch**: the branch from [Before you start](#before-you-start).
   - **Blueprint Path**: leave empty (`render.yaml` is at the repository root).
4. Render lists the resources it will create. Check that there are exactly two:
   - `shiplens-db`: Postgres, plan Free, region Singapore, version 16.
   - `shiplens`: web service, Docker, plan Free, region Singapore.

   If the page shows an error instead (for example Singapore is not offered, or you
   already have another free Postgres in this workspace: only one can be active), stop
   and fix that first. Both resources must stay in one region; if Singapore is not
   offered, change `region:` for both in `render.yaml` on the branch, push, and start
   this step again.

5. Render asks for the value of `SEED_DEMO_PASSWORD` (it is marked `sync: false`, so it
   is the only value you type). Paste the demo password from your password manager.
   Render asks for it only during this first creation. If the field did not appear, set
   it before the first deploy finishes: **shiplens > Environment > Add Environment
   Variable**, key `SEED_DEMO_PASSWORD`, then **Save, rebuild, and deploy**.
6. Click **Deploy Blueprint**. Render creates the database, then builds and starts the
   web service. This first deploy does not wait for CI.

## Step 4: Watch the first deploy and read the logs

1. Open **shiplens** in the Dashboard. The **Events** page lists every deploy; click the
   running deploy (or open the **Deploys** page and click it) to see its build and start
   logs.
2. The Docker build takes roughly ten minutes the first time. Then the start logs should
   show, in this order:
   - `Applied: 2026...sql, ...` (the migrations, on an empty database).
   - `seed: created ...` lines for the sample branch and the five demo users, then
     `seed: demo data loaded ...` and `seed: done`. The seed never prints the password.
     On later starts these lines read `already present` instead.
   - The Next.js ready line.
3. When the health check passes, the deploy is marked **Live** and the URL at the top of
   the service page (`https://shiplens-xxxx.onrender.com` or similar) works. Render
   waits up to 15 minutes for the first healthy response before it cancels a deploy.
4. Later, the **Logs** page of the service shows the running server's output. Use the
   time range menu (top right) and choose **Live tail** to follow it, or type in the
   search box to filter. Free workspaces keep logs for 7 days.

If the deploy fails, see [Troubleshooting](#troubleshooting).

## Step 5: Record the database dates

1. Open **shiplens-db** in the Dashboard. The info page shows when it was created, and a
   free database also shows its expiry.
2. Write the creation date and the expiry date (creation + 30 days) under
   [Recorded facts](#recorded-facts), and put the expiry date in your calendar with a
   reminder a week before. If the page shows no date, use today's date.
3. Write down the live URL, the region and the plans as well.

What expiry means: 30 days after creation the free database stops working, and the app
stops working with it (`/api/health` stays 200, but every page that reads data fails).
You then have 14 days to upgrade it to a paid plan before Render deletes it with all its
data. Free databases have no backups. See [Before the database expires](#before-the-database-expires).

## Step 6: Verify the deployment from your machine

Run these from the repository root, on the same branch, in a Bash shell (Git Bash on
Windows). Read the password into the shell without echoing it, so it never lands in
your shell history or a file:

```sh
URL=https://shiplens-xxxx.onrender.com      # the live URL, no trailing slash
read -rs -p 'Demo password: ' DEMO_PW; echo

# 1. Liveness and database health (a sleeping free service takes about a minute to wake)
curl -fsS "$URL/api/health"; echo
curl -fsS "$URL/api/health/db"; echo

# 2. Smoke script: health, both locales, every demo user logs in and out, Origin check,
#    cookie flags. Exit code 0 means every check passed.
BASE_URL="$URL" SMOKE_DEMO_PASSWORD="$DEMO_PW" node scripts/smoke.mjs

# 3. Playwright read-only checks in the official browser container, all four projects
#    (English and Urdu, light and dark, desktop and mobile).
E2E_DEMO_PASSWORD="$DEMO_PW" npm run e2e:run -- --base-url "$URL" --grep @smoke

# 4. Full post-deploy verification: health with cold-start time, the smoke checks, every
#    security header, the audit chain and the public report verification. Prints a
#    Markdown summary for the recorded facts; exit code 0 means every check passed.
BASE_URL="$URL" SMOKE_DEMO_PASSWORD="$DEMO_PW" node scripts/verify-deploy.mjs --markdown
```

Expected: the smoke script prints one `PASS` line per check and ends with exit code 0;
Playwright reports every `@smoke` test passed; the verification script ends with exit
code 0 and prints its Markdown block. Copy the summary lines and that block (never the
password) into [Recorded facts](#recorded-facts).

If the deployed branch does not yet contain the login and account pages, the smoke
script's page checks fail with 404; rerun it with `--skip shell,pages` and write that
skip into the recorded facts.

The smoke script makes one deliberately wrong login for `finance@shiplens.test`. Five
failed logins for one email within 15 minutes lock it for the rest of that window, so
do not run the script many times in a row.

## Step 7: Measure login latency

Five sequential logins as the admin demo user, timed from your machine (the first
response includes a cold start if the service was asleep, so wake it with step 6 first):

```sh
URL="$URL" DEMO_PW="$DEMO_PW" node -e '
const url = process.env.URL, times = [];
(async () => {
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const r = await fetch(url + "/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: url },
      body: JSON.stringify({ email: "admin@shiplens.test", password: process.env.DEMO_PW }),
    });
    times.push(Math.round(performance.now() - t));
    if (r.status !== 200) throw new Error("login status " + r.status);
  }
  times.sort((a, b) => a - b);
  console.log("ms:", times.join(", "), "median:", times[2], "worst:", times[4]);
})();'
unset DEMO_PW
```

Record the median and worst case. Password hashing parameters stay at the OWASP minimum
(argon2id, 19 MiB, 2 iterations); slow logins on the free instance are recorded, not
fixed by weakening them.

## Day-to-day operation

- **New deploys.** Push to the deployed branch; when CI passes on that commit, Render
  builds and deploys it. A deploy that never starts usually means CI failed or did not
  run on that commit; the service's **Events** page notes skipped deploys.
- **Deploy by hand.** **shiplens > Manual Deploy > Deploy latest commit**.
- **Changes to `render.yaml`.** Pushing a change to `render.yaml` on the linked branch
  updates the resources automatically (Blueprint auto sync). Values marked
  `sync: false` are never touched by a sync.
- **Sleeping.** The free web service sleeps after 15 minutes without traffic; the next
  request waits about a minute while it starts (migrations and seed are quick no-ops on
  a database that already has them). Do not set up any outside service or scheduled job
  to keep it awake; keep-warm is built into the app in a later phase.
- **Free hours.** A workspace gets 750 free instance hours per month, enough for one
  service running all month. Outbound bandwidth and build minutes are also capped;
  without a payment method Render suspends free services that exceed them.

## Environment variables

| Variable                     | Value                                         | Secret        | Notes                                                                                                                                        |
| ---------------------------- | --------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | From `shiplens-db`, private connection string | Yes (managed) | Set by the Blueprint (`fromDatabase`). Works only inside Render.                                                                             |
| `NODE_ENV`                   | `production`                                  | No            |                                                                                                                                              |
| `PORT`                       | `10000`                                       | No            | Render's default web port; the server and the image's healthcheck read it.                                                                   |
| `SEED_ON_BOOT`               | `true`                                        | No            | Runs the idempotent seed after migrations on every start.                                                                                    |
| `SEED_DEMO_PASSWORD`         | Typed in the dashboard                        | **Yes**       | `sync: false`. 12+ characters; the seed refuses to run without it, so the deploy fails.                                                      |
| `LOG_LEVEL`                  | `info`                                        | No            | `debug`, `info`, `warn` or `error`.                                                                                                          |
| `RENDER_EXTERNAL_URL`        | Set by Render (`https://<name>.onrender.com`) | No            | The app uses it as its own origin (Origin check on every change, `Secure` cookies) because `APP_ORIGIN` is not set.                          |
| `APP_ORIGIN`                 | Not set                                       | No            | Set it (to the live URL, no trailing slash) only if the origin from `RENDER_EXTERNAL_URL` turns out wrong, or when a custom domain is added. |
| `SEED_ROTATE_DEMO_PASSWORDS` | Not set                                       | No            | Set to `true` for one deploy to change the demo password; see below.                                                                         |

The application has no session secret: sessions are random tokens stored (hashed) in
the database.

To change a variable: **shiplens > Environment**, edit, then **Save, rebuild, and
deploy** (or **Save and deploy**). Every variable change restarts the service.

## Rotating the demo password

1. **shiplens > Environment**: set `SEED_DEMO_PASSWORD` to the new value and add
   `SEED_ROTATE_DEMO_PASSWORDS` = `true`. Save and deploy.
2. When the deploy is live, the start log shows `seed: rotated password for ...` once per
   demo user, and the audit log records each change. Only the five demo emails are touched.
3. Delete `SEED_ROTATE_DEMO_PASSWORDS` (or set it to `false`) and save again, so later
   starts leave the passwords alone.
4. Update your password manager and rerun the smoke script with the new password.

## Rollback

1. **shiplens > Deploys**, find the last good deploy, click **Rollback**, then **Rollback
   to this deploy**. Render reuses that deploy's built image, so it is quick, and it
   uses the environment variables that deploy had.
2. A dashboard rollback turns automatic deploys off. Once the fix is pushed and CI is
   green, turn them back on under **shiplens > Settings** (auto-deploy: after CI checks
   pass).
3. Database migrations are not rolled back. Migrations only move forward, so a rollback
   is safe only to a deploy whose code works with the current schema. If it does not,
   fix forward with a new commit instead.

## Switching the deployed branch

If the first deploy used an integration branch, move to `main` once it is merged:

1. Open the `shiplens` Blueprint (Dashboard > **Blueprints**) and check its settings
   for the linked branch; change it to `main` if the page allows it.
2. Open **shiplens > Settings > Build & Deploy > Branch** and set `main`.
3. Confirm that the next push to `main` with green CI deploys, and write the new branch
   under [Recorded facts](#recorded-facts).

## Before the database expires

Choose one before day 30:

- **Upgrade the database** to a paid plan (**shiplens-db > Settings / Upgrade**). Data
  is kept and the date no longer applies. Then set `plan:` for the database in
  `render.yaml` to the same paid plan so a Blueprint sync does not try to change it back.
- **Start over on a new free database.** Data is lost. Delete the old database, create a
  new free one with the same name (or re-sync the Blueprint), and redeploy: the start
  command migrates the empty database and the seed recreates the demo branch, users and
  demo data. Record the new creation date.

## Moving to a paid plan

On a paid web service plan, migrations can run before the new version takes traffic:

1. In `render.yaml`, set the web service `plan:` to the paid plan you chose and add
   `preDeployCommand: node scripts/migrate.mjs` under the `shiplens` service.
2. Push to the deployed branch; the Blueprint sync applies it.
3. The container start command can stay as it is: both migration and seed are
   idempotent, so running them again at start is a quick no-op.

Paid instances also do not sleep, support shell access, and allow more memory and CPU.

## Troubleshooting

| Symptom                                                               | Cause and fix                                                                                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deploy fails right after the build; log mentions `SEED_DEMO_PASSWORD` | The variable is missing or shorter than 12 characters. Set it under **Environment** and save.                                                                                  |
| Log shows `Invalid environment configuration: APP_ORIGIN`             | Neither `APP_ORIGIN` nor `RENDER_EXTERNAL_URL` is set. Add `APP_ORIGIN` with the live URL.                                                                                     |
| Deploy cancelled after a long wait; no ready line in the log          | The server never answered `/api/health`. Check the log for a database error (wrong `DATABASE_URL`, database still being created) or a crash; redeploy once the database is up. |
| Logging in from the browser returns 403                               | The browser's Origin differs from the origin the app derived. Set `APP_ORIGIN` to the exact live URL (scheme and host, no trailing slash) and redeploy.                        |
| A push does not deploy                                                | CI did not pass (or did not run) on that commit. Fix CI, or deploy by hand with **Manual Deploy**.                                                                             |
| Pages fail with a database error after about a month                  | The free database expired. See [Before the database expires](#before-the-database-expires).                                                                                    |
| You need to inspect the database from your machine                    | `ipAllowList` is empty, so outside connections are refused. Add your IP under **shiplens-db > Networking** temporarily, use the external URL, then remove it.                  |

## Running the same image locally

- Production image against the dev database (Compose `full` profile):

  ```sh
  docker compose --profile full up -d --build --wait
  ```

  The app is on <http://localhost:3000> with a throwaway local demo password
  (`local-demo-only-pass` unless `SEED_DEMO_PASSWORD` is exported).

- The isolated end-to-end stack (its own database, removed after the run) is described
  in `docs/e2e.md`: `npm run e2e:docker`.

## Verified locally

On 1 November 2026 the production image was built from this repository with a plain
`docker build` (no build target, exactly as Render builds it) and run the way Render runs
it: `PORT=10000`, `RENDER_EXTERNAL_URL` set, no `APP_ORIGIN`, `NODE_ENV=production`,
`SEED_ON_BOOT=true`, a throwaway generated `SEED_DEMO_PASSWORD`, an empty Postgres 16
database, and the free instance's limits (512 MB memory, 0.1 CPU).

- Image: 204 MB compressed content (about 920 MB unpacked); runs as uid 10001, not root.
- First start on the empty database: all four migrations applied, the seed created the
  sample branch and the five demo users and loaded the demo data; healthy after 63 s
  (147 s on a busier machine). Memory after the smoke run: about 65 MB.
- Smoke script (`--skip shell,pages`, because the login and account pages were not yet
  on this branch): 32 PASS, 2 SKIPPED, 0 FAIL, including the Origin check with the
  origin derived from `RENDER_EXTERNAL_URL`, the session cookie flags, and login and
  logout for all five demo users.
- Restart: healthy again after 25 s; `No pending migrations`, and the seed reported
  `already present` for both steps (no new rows).

Once the login pages are merged, run the smoke script without `--skip` (step 6).
