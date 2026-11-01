# 0015 Built-in keep-warm on the Render free tier

- Status: Accepted
- Date: 2026-10-31

## Context

ShipLens runs on Render's free web service (ADR [0001](./0001-one-nextjs-app-on-render.md)). A free service sleeps after 15 minutes without inbound traffic, and the next visitor waits about a minute for a cold start. Judges open the live link at unpredictable times; a one-minute blank page on first impression costs more than any feature.

Common fixes are an external uptime monitor or a scheduled GitHub Actions job that pings the site. Both add a moving part outside the repository that can silently stop: scheduled workflows are paused on inactive repositories and delayed under load, and an external account belongs to one person.

## Decision

- The app pings itself. `src/instrumentation.ts` `register()` starts the keep-warm loop once per server process when running in the Node.js runtime.
- **Only on Render.** It is active only when `RENDER_EXTERNAL_URL` is set (Render sets it), is a valid `https:` URL, and `KEEP_WARM` is not `'0'`. The target is `${origin}/api/health`, built from that variable alone, never from request data, so it cannot be turned into a request forgery primitive.
- **Through the public URL.** The ping goes out through Render's edge and back in, which counts as inbound traffic. `/api/health` is liveness only and never touches the database.
- **Schedule.** The first ping after 60 seconds plus up to 30 seconds of jitter, then every 10 minutes plus or minus 90 seconds, always well under the 15-minute idle limit. Each request has a 10-second timeout.
- **Safety rules.** A process-wide singleton guard (a `Symbol.for` key on `globalThis`) prevents a double start. Timers are `unref()`'d so they never keep a process alive. Every error is caught and logged through the redacting logger; nothing can throw out of a timer. Each success logs `keepwarm.ping`, which shows up in Render logs as evidence.
- **Budget.** Render gives 750 free instance hours per month; one always-on service uses at most 744 (31 days by 24 hours), so one service fits.
- **Database expiry.** The free Postgres instance expires 30 days after creation. Its creation date and expiry date are recorded in the handover guide so the owner can upgrade or recreate it in time.
- An external uptime monitor stays optional and is documented as an extra in the handover guide.

## Consequences

### Positive

- No external service, account or schedule to maintain; the behaviour is in the repository, reviewed and unit tested with fake timers.
- Judges and donors get a warm service at any hour.
- Turning it off is one environment variable.

### Negative

- **Limit.** If the instance is ever stopped (a failed deploy, platform maintenance, the monthly hours running out), nothing inside it can wake it; the first visitor does, and waits for the cold start.
- Using all free hours on one service leaves none for a second free service in the same workspace.
- The service never idles, so it uses its compute allowance continuously.

### Neutral

- Locally and in CI `RENDER_EXTERNAL_URL` is unset, so the loop never starts there.
- The free database also has no backups; the demo data can be reloaded by the idempotent seed.

## Alternatives considered

- **Scheduled GitHub Actions pinger.** Outside the app, can be paused or delayed, and spends CI minutes.
- **External uptime monitor only.** Works, but depends on a third-party account; kept as an optional extra.
- **Paid Render instance.** No sleeping at all; the simplest upgrade path if the project continues.

## Where it lives

- [`src/app/api/health/route.ts`](../../src/app/api/health/route.ts): the liveness endpoint the loop calls.
- [`src/platform/log/logger.ts`](../../src/platform/log/logger.ts): redacting logger used for ping results.
- [`src/platform/keepwarm/index.ts`](../../src/platform/keepwarm/index.ts): `startKeepWarm` with schedule, guards and logging.
- [`src/instrumentation.ts`](../../src/instrumentation.ts): starts the loop once per server process.
- [`docs/handover.md`](../handover.md): database creation and expiry dates, optional external monitor.
