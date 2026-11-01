# 0008 UTC instants, PKT business dates and an injected clock

- Status: Accepted
- Date: 2026-10-28

## Context

The organisation works in Pakistan, the server runs in a UTC container on Render, and developers' laptops run in other zones. Several business rules depend on the calendar, not on the clock:

- a collection is editable through day 7 after its collection date and locks at 00:00 PKT on day 8;
- weekly reports cover a Monday to Sunday week;
- dashboard trends bucket collections by month.

If a business date is stored as a timestamp, a collection logged at 01:00 PKT on a Monday falls on Sunday in UTC and lands in the wrong week. If code reads the host clock directly, the lock boundary and midnight cases cannot be tested without waiting for real time to pass.

## Decision

- **Instants** (when something happened: `created_at`, `submitted_at`, `occurred_at`, session expiry) are `timestamptz`, stored and compared in UTC.
- **Business dates** (`collected_on`, `week_start`) are Postgres `date` values on the PKT calendar. In TypeScript they are plain `YYYY-MM-DD` strings (`DateString`), never `Date` objects. The `pg` type parser for `date` returns the raw string so no time zone conversion can happen on the way in.
- The time zone is the IANA name `Asia/Karachi`, not a fixed offset, from one constants module. Weeks start on Monday.
- `src/platform/time` holds the date logic: `pktDate(instant)` (the PKT calendar date of an instant, through `Intl.DateTimeFormat`), `pktWeekStart`, `pktMonth`, `addDays`, `daysBetween`. Date arithmetic on `DateString` runs in UTC internally so the host zone has no effect, and impossible dates such as `2026-02-30` are rejected.
- The SQL function `pkt_week_start(d date)` computes the same Monday in the database; a parity test checks it against the TypeScript function for 400 consecutive dates.
- **Clock injection.** Services never call `new Date()` for business decisions. They receive a `Clock` (`now(): Date`) through the command context. Production uses `systemClock`; tests use `fixedClock`, which can be set and advanced.
- The lock rule is computed from `collected_on` and today's PKT date: editable through `collected_on + 7`, locked from the next PKT midnight.

## Consequences

### Positive

- A collection always belongs to the week and month the branch lead meant, wherever the server runs.
- Boundary tests are exact and fast: the lock on day 7 versus day 8, a submission one second before and after PKT midnight, month ends and year ends, all with a fixed clock.
- SQL and TypeScript cannot drift on week boundaries without a failing test.

### Negative

- Two kinds of time value to keep apart. A reviewer must check that a new column is the right kind.
- Every service that needs "now" must take a clock parameter, which is slightly more plumbing.

### Neutral

- Pakistan has no daylight saving time today; using the IANA name means a future change would be picked up from the time zone database rather than a code change.
- Displayed timestamps are formatted in `Asia/Karachi` with Latin digits in both languages.

## Alternatives considered

- **Store everything as `timestamptz` and convert for business rules.** Every query would need `AT TIME ZONE` math, and a single forgotten conversion moves a collection into the wrong week.
- **A fixed `+05:00` offset.** Works today, silently wrong if the rules change.
- **A date library (date-fns-tz, Luxon, Temporal polyfill).** The operations needed are few and `Intl` covers the zone conversion.
- **Mocking the global clock in tests.** Fragile and leaks between tests; an explicit `Clock` is clearer.

## Where it lives

- [`src/platform/time/index.ts`](../../src/platform/time/index.ts): `Clock`, `fixedClock`, PKT date helpers.
- [`src/platform/time/time.test.ts`](../../src/platform/time/time.test.ts): midnight, week and year boundaries.
- [`src/platform/config/constants.ts`](../../src/platform/config/constants.ts): `TIMEZONE`, `WEEK_START`, `LOCK_DAYS`, `LOCK_ANCHOR`.
- [`db/migrations/202610281000_foundation_identity_audit.sql`](../../db/migrations/202610281000_foundation_identity_audit.sql): `pkt_week_start`.
- [`tests/db/pkt-week-parity.test.ts`](../../tests/db/pkt-week-parity.test.ts): SQL and TypeScript parity.
- [`src/platform/db/pool.ts`](../../src/platform/db/pool.ts): `date` returned as a string.
- [`src/modules/collections/lock.ts`](../../src/modules/collections/lock.ts): the pure lock rule.
- [`tests/lifecycle/lock-boundary.test.ts`](../../tests/lifecycle/lock-boundary.test.ts): day 7 and day 8 and PKT midnight over HTTP.
