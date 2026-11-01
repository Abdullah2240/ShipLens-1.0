# 0001 One Next.js full-stack app plus Postgres, one Docker image on Render

- Status: Accepted; hosting superseded by [0017](0017-production-on-vercel-and-neon.md) (production runs on Vercel + Neon; this single-container design remains the Render alternative)
- Date: 2026-10-28

## Context

ShipLens has a public bilingual website and a private platform for branches, HR, finance and head office. The brief names Render as the hosting platform and allows a Next.js full-stack app. The team is two people with a deadline of days, not weeks, so every extra moving part (a second service, a second deploy pipeline, cross-origin configuration) costs time that the features need.

Security also pushes towards one origin. Session cookies that must travel between a frontend on one domain and an API on another need `SameSite=None`, CORS rules and extra CSRF defences. Keeping the pages and the API on the same origin lets the session cookie stay `SameSite=Lax` and makes the Origin check on mutations a simple equality test.

## Decision

- One Next.js 16 application written in TypeScript serves the public site, the private app (Server Components that read through services) and the JSON API under `/api/v1`.
- PostgreSQL 16 is the only data store. Render managed Postgres in production; a `postgres:16` container locally and in CI.
- The app ships as one Docker image built from a multi-stage Dockerfile on `node:24-slim`, using Next's `output: 'standalone'`. The runner stage copies the standalone server, `.next/static` and `public/`, sets `HOSTNAME=0.0.0.0` and runs as a non-root user.
- Render runs the image as one web service next to a managed Postgres in the same region. Migrations and the idempotent seed run in the container entrypoint before the server starts, because the pre-deploy command is a paid feature on the free plan.
- Two health endpoints: `/api/health` is liveness only and never touches the database (Render probes it); `/api/health/db` runs `SELECT 1` for diagnosis.

## Consequences

### Positive

- One origin: no CORS, a simple `SameSite=Lax` session cookie, and one `Origin` value to check on mutations.
- One build, one image and one deploy. What runs locally under Docker is what runs on Render.
- Pages and API share the same service layer, so a figure on a page and the same figure from the API come from the same code.

### Negative

- The free Render web service sleeps after 15 minutes without traffic and a cold start takes about a minute. ADR [0015](./0015-built-in-keep-warm.md) adds a built-in keep-warm to reduce this.
- One instance only. There is no horizontal scaling, and in-memory rate limits (public form, verification lookups) are per process.
- The free Postgres instance expires 30 days after creation and has no backups. The creation date is recorded in the handover guide.

### Neutral

- Packages used only by standalone scripts (migration runner, seed) are not traced into the standalone output and must be copied into the runner stage explicitly.
- Every database-backed page is rendered dynamically; the build never needs a database.

## Alternatives considered

- **Frontend on Vercel, API elsewhere.** Two origins, cross-site cookies and CORS, and the brief names Render.
- **Separate API service (for example Express or Fastify) plus a static frontend.** Two deployables and duplicated validation for no gain at this size.
- **Railway or another host.** The brief names Render.
- **Render native Node runtime instead of Docker.** Docker gives the same artefact locally, in CI and in production, and the brief asks for a Dockerfile.

## Where it lives

- [`Dockerfile`](../../Dockerfile): multi-stage build, standalone output, non-root runner.
- [`next.config.ts`](../../next.config.ts): `output: 'standalone'`, `poweredByHeader: false`.
- [`compose.yaml`](../../compose.yaml): local Postgres 16.
- [`src/app/api/health/route.ts`](../../src/app/api/health/route.ts): liveness without the database.
- [`src/app/api/health/db/route.ts`](../../src/app/api/health/db/route.ts): database check.
- [`scripts/migrate.mjs`](../../scripts/migrate.mjs): migration runner and optional seed, run at container start.
- [`render.yaml`](../../render.yaml): Render blueprint (Docker runtime, health check path, deploy on passing checks, one region for web and database).
- [`docs/deploy.md`](../deploy.md): deploy steps and the upgrade path to a pre-deploy command.
