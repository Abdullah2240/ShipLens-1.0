# End-to-end tests

Browser tests run with Playwright against the production Docker image, on a database
that exists only for the run.

## What the stack is

`compose.e2e.yaml` is its own compose project (`shiplens-e2e` by default), separate from
the dev database in `compose.yaml`:

| Service      | What it does                                                                                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db`         | Postgres 16 on `tmpfs`, database `shiplens_e2e`. No host port, no volume: it disappears with the stack.                                                                                                                                  |
| `app`        | The production image from `Dockerfile`. On start it applies migrations, seeds the five demo users with a throwaway password and the fictional demo dataset (`SEED_ON_BOOT=true`), then starts the server on `E2E_PORT` (default 3100) inside and outside the container. |
| `playwright` | The official Playwright image at the same version as the `@playwright/test` devDependency. It shares the app's network, so `http://localhost:<E2E_PORT>` is the app and the browser `Origin` equals `APP_ORIGIN`.                        |

Specs and `playwright.config.ts` are mounted into the runner, so editing a spec needs no
image rebuild.

## Commands

```sh
# Everything in one go: build, start, wait for health, run all projects, tear down.
# Exits with Playwright's exit code; the stack and its database are always removed.
npm run e2e:docker

# The full suite as CI runs it: exact-value specs first on a fresh stack, then the rest
# (see "Tags and order" below).
npm run e2e:docker -- --grep @pristine --pass-with-no-tests
npm run e2e:docker -- --grep-invert @pristine

# Keep the stack up between runs (for example while writing a spec).
npm run e2e:up
npm run e2e:run -- --grep @smoke      # in the container
npm run e2e                           # or from the host (see below)
npm run e2e:down

# A deployed URL, without a local stack (read-only checks only).
E2E_DEMO_PASSWORD=<the deployment's seed password> \
  npm run e2e:run -- --base-url https://<live-host> --grep @smoke
```

Arguments after `--` go to `playwright test` (`--project desktop-en-light`, `--grep`,
`--headed` on the host, and so on). `npm run e2e:docker -- --keep` leaves the stack up
after the run.

Host runs need Chromium once: `npx playwright install chromium`. They read `BASE_URL`
(default `http://localhost:3100`) and `E2E_DEMO_PASSWORD` (default stack value:
`e2e-throwaway-pass-0`); export both when the stack uses another port or password.

On failure the wrapper prints the last 200 lines of the app log. It never prints the demo
password.

## Projects

All projects use Chromium.

| Project            | Viewport                | Locale | Theme |
| ------------------ | ----------------------- | ------ | ----- |
| `desktop-en-light` | Desktop Chrome 1280x800 | `en`   | light |
| `desktop-ur-dark`  | Desktop Chrome 1280x800 | `ur`   | dark  |
| `mobile-en-dark`   | Pixel 7                 | `en`   | dark  |
| `mobile-ur-light`  | Pixel 7                 | `ur`   | light |

Tests tagged `@desktop` run in the desktop projects only.

## Writing a spec

- One new file per feature plan: `tests/e2e/<area>.spec.ts`. Never edit another plan's
  spec. Shared fixtures live in `tests/e2e/support/`; a change there is requested from
  the harness owner rather than made in a feature plan.
- Import `test` and `expect` from `./support/fixtures`, not from `@playwright/test`
  directly. Specs import only `@playwright/test` and the support files, never app code.
- Fixtures:
  - `loginAs(role)` logs in through `POST /api/v1/auth/login` as one of the five seeded
    roles (`super_admin`, `finance_reviewer`, `content_editor`, `branch_lead`,
    `hr_lead`), checks `/api/v1/auth/me` returns that role, and leaves the session
    cookie in the browser context.
  - `localePath('/login')` gives `/en/login` or `/ur/login` for the project's locale;
    `uiLocale` and `theme` are the project's options (the `theme` cookie is set for you).
  - `routeExists` and `requireFeature` from `./support/probe` skip a test while the
    feature is not built yet. Skip reasons name the plan that builds it, for example
    `pending plan 01-15: /en/login not built`. A 401 or 403 is never a reason to skip.
- Create your own data with a unique suffix (for example `e2e+<run id>@example.test`);
  never depend on rows another spec creates.
- Tag only read-only checks `@smoke`: they are the ones run against the live deployment.
- At most one failed login per seeded email per full run (five failures in 15 minutes
  lock an email).
- Application submissions run in `desktop-en-light` only, because of the per-IP rate
  limit. Specs that change shared global state run in one project and in serial mode.

## Tags and order

- `@smoke`: read-only checks, safe to run against the live deployment.
- `@pristine`: specs that compare the screen with the exact values of the demo dataset in
  `db/seed/expected.json` (mounted into the runner; `E2E_EXPECTED_JSON` overrides the
  path). Other specs approve reports and change data, so run `@pristine` first on a
  fresh stack and everything else afterwards, as CI does. A single
  `npm run e2e:docker` runs both kinds side by side and can turn the exact-value checks
  red.
- Host-only: `tests/e2e/journeys/tamper.spec.ts` edits a past audit event through
  `docker compose exec`, checks that the audit chain badge and the public verification
  page break, restores the exact row and checks that both heal. It skips unless
  `E2E_DB_EXEC=1`, so container runs and CI skip it. Run it from the host against a stack
  that is up:

  ```sh
  E2E_PROJECT=shiplens-e2e E2E_PORT=3100 npm run e2e:up
  E2E_DB_EXEC=1 E2E_PROJECT=shiplens-e2e E2E_DEMO_PASSWORD=e2e-throwaway-pass-0 \
    BASE_URL=http://localhost:3100 npx playwright test tests/e2e/journeys/tamper.spec.ts --project desktop-en-light
  npm run e2e:down
  ```

## Parallel stacks

Set `E2E_PROJECT` and `E2E_PORT` so stacks do not collide, for example:

```sh
E2E_PROJECT=shiplens-e2e-0212 E2E_PORT=6212 npm run e2e:docker
```

The wrapper refuses the project name `shiplens`, which holds the dev database volume.

## CI

On every push the CI `e2e` job brings the stack up (`npm run e2e:up`), runs the smoke
script, the security header check (`scripts/check-headers.mjs`) and a non-root check
against it, then `npm run e2e:run -- --grep @pristine --pass-with-no-tests` followed by
`npm run e2e:run -- --grep-invert @pristine`, and tears the stack down (with `CI=true`:
two workers, one retry, `test.only` forbidden, GitHub annotations). The wrapper uses only
Node built-ins, so it runs before `npm ci`.

## Reports

- `playwright-report/`: HTML report (`npx playwright show-report`).
- `test-results/`: traces and screenshots of failed tests (`npx playwright show-trace`).

Both folders are git-ignored.
