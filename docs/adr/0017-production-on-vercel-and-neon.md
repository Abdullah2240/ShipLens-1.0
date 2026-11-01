# 0017 Production on Vercel with Neon Postgres

- Status: Accepted
- Date: 2026-11-01

## Context

ADR [0001](./0001-one-nextjs-app-on-render.md) planned one Docker image on Render's free web service next to a free Render Postgres, described in `render.yaml`. On deploy day, 1 November 2026, Render asked for a payment card before it would create the resources. The owner decided not to put a card on the account for a demo deployment, and the submission deadline left no room to wait.

The app itself does not depend on Render. It is one Next.js application with route handlers and a Postgres database; only three things were Render-specific: the container entrypoint that migrates and seeds before the server starts, the origin derived from `RENDER_EXTERNAL_URL`, and the keep-warm loop of ADR [0015](./0015-built-in-keep-warm.md).

## Decision

- Production runs on Vercel: project `shiplens`, Hobby plan, Next.js framework preset, functions in region `iad1`. The live URL is <https://shiplens-two.vercel.app>.
- The database is Neon Postgres on the Free plan, added through the Vercel marketplace as resource `shiplens-db` and connected to the Production, Preview and Development environments. The app uses the pooled `DATABASE_URL`; migrations use the direct `DATABASE_URL_UNPOOLED`, because the migration runner takes a session-level advisory lock.
- `APP_ORIGIN` is set by hand for Production. No code changed: the configuration already accepted `APP_ORIGIN` ahead of `RENDER_EXTERNAL_URL`.
- Migrations and the idempotent seed run from a developer machine with `node scripts/migrate.mjs`, before the first deploy and before any release that adds a migration.
- Releases go out with `vercel deploy --prod` from a clean checkout of `main` until the project is connected to Git.
- Render stays documented as the container-based alternative, and `render.yaml` and the `Dockerfile` stay in the repository.

## Consequences

### Positive

- No payment card is needed, and the deployment passed the full post-deploy check (102 of 102) on the day it was decided.
- Neon's free plan has no fixed expiry, so the 30-day deadline of Render's free Postgres no longer applies.
- Cold starts are short (821 ms measured), so nothing has to keep the service awake.

### Negative

- No container runs in production. The `Dockerfile` is still built and tested in CI and by the end-to-end stack, but production runs Vercel's own build of the same source, so the image is no longer what users reach.
- Migrations and the seed are a manual step. Forgetting it before a release that adds a migration breaks that release.
- The in-memory rate limits on public applications and public verification lookups count per serverless instance, so a client spread over several instances gets more attempts. Login throttling is in the database and is unaffected.
- The keep-warm loop is inactive on Vercel: it only starts when `RENDER_EXTERNAL_URL` is set. It is not needed there.
- Functions run in US East, far from the users and from a developer in Pakistan: the first seed took about 460 seconds of round trips.

### Neutral

- Neon's free plan has usage limits instead of an expiry date; see its current limits at <https://neon.com/pricing>.
- Without a Git connection, a merge to `main` does not deploy by itself. Once connected, merges deploy automatically and do not wait for CI.

## Alternatives considered

- **Render with a payment card.** Keeps the planned container setup unchanged; rejected because the owner chose not to attach a card for a demo.
- **Vercel with Render's free Postgres.** Still needs the Render account that asked for a card, and the database would expire after 30 days.

## Where it lives

- [`docs/deploy.md`](../deploy.md): the Vercel and Neon runbook and its recorded facts, followed by the Render alternative.
- [`src/platform/config/env.ts`](../../src/platform/config/env.ts): reads `APP_ORIGIN` first, then `RENDER_EXTERNAL_URL`, and requires an origin in production.
- [`scripts/migrate.mjs`](../../scripts/migrate.mjs): migrations under an advisory lock, then the seed when `SEED_ON_BOOT=true`.
- [`scripts/verify-deploy.mjs`](../../scripts/verify-deploy.mjs): the post-deploy check that recorded 102 of 102.
- [`src/platform/rate-limit/index.ts`](../../src/platform/rate-limit/index.ts): the in-memory limiter that counts per instance.
- [`render.yaml`](../../render.yaml): the Render alternative.
