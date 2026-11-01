# 0003 Plain parameterised SQL with pg and our own forward-only migration runner

- Status: Accepted
- Date: 2026-10-28

## Context

The rules that matter most in ShipLens are enforced in the database or depend on precise SQL:

- the audit log is append-only through triggers;
- report state changes are conditional updates (`UPDATE ... WHERE id = $1 AND status = $from`) so two reviewers cannot both win;
- collections in a submitted or approved report are guarded by triggers;
- every dashboard figure is defined once in a SQL view;
- `numeric(14,2)` money and `date` business dates must come back as strings, never as JavaScript numbers or `Date` objects.

An ORM would have to be bypassed for most of these. Two builders add migrations in parallel, so the format has to merge cleanly.

## Decision

- Data access uses the `pg` driver with hand-written, parameterised SQL in repository files (`repo*.ts`). User input is only ever passed as a parameter. The one interpolated identifier, the scope column, is a constant from code and is validated against an identifier pattern.
- Repositories receive a `Scope` (ADR [0005](./0005-permission-table-as-data-and-scopes.md)), never import another module and never write audit rows. ESLint enforces the last two.
- One shared `Pool` per process (`max` 5). The `date` type parser returns the raw `YYYY-MM-DD` string; `numeric` and `int8` keep the driver default of strings.
- Migrations are plain `.sql` files in `db/migrations/`, named with a timestamp prefix (`YYYYMMDDHHMM_name.sql`) and applied in filename order. They are forward-only: an applied file is never edited, a change is a new file.
- Our own runner (`scripts/migrate.mjs`, plain ESM importing only `pg` and Node built-ins) takes a session advisory lock (key 727274) so concurrent starts serialise, applies each file in its own transaction, records a sha256 checksum per file in `schema_migrations`, and fails hard if an applied file has changed.
- The whole domain schema was declared up front in the first migrations so later work adds guards, views and columns in one ordered sequence.

## Consequences

### Positive

- Triggers, conditional updates, `FOR UPDATE` locks, `ON CONFLICT` and views are written as what they are, and reviewed as SQL.
- No hidden queries: every statement that touches the database is visible in a repository file, which helps the security review and the scope tests.
- The runner is small enough to read in a minute, runs inside the slim runtime image without a TypeScript build, and is tested against a real Postgres.
- The checksum guard catches an edited migration before it silently diverges between environments.

### Negative

- Row mapping is hand-written (`snake_case` columns to `camelCase` fields) and must be kept in step with the schema by tests.
- No generated types from the schema; repository row types are declared by hand.
- No down migrations. A bad migration is fixed forward with a new file.

### Neutral

- Gaps in sequences (branch codes, member IDs) are allowed: a rolled-back transaction consumes a value. Uniqueness is what matters.
- Parallel work uses separate timestamp ranges so files from different streams never collide and later streams always apply last.

## Alternatives considered

- **Drizzle or Prisma.** Typed queries and generated migrations, but the triggers, guards and views would still be raw SQL, money and dates need custom type handling, and generated migration journals conflict when two people add migrations at once.
- **A query builder such as Knex or Kysely.** Still a layer over SQL we write by hand anyway.
- **node-pg-migrate or similar.** Viable; our runner is about 100 lines with exactly the lock and checksum behaviour we need and no extra dependency.

## Where it lives

- [`scripts/migrate.mjs`](../../scripts/migrate.mjs): runner with advisory lock and checksum guard.
- [`scripts/migrate.int.test.mjs`](../../scripts/migrate.int.test.mjs): runner tests against Postgres.
- [`db/migrations/`](../../db/migrations/): ordered SQL migrations.
- [`src/platform/db/pool.ts`](../../src/platform/db/pool.ts): pool and type parsers.
- [`src/platform/db/tx.ts`](../../src/platform/db/tx.ts): `withTransaction`.
- [`src/platform/authz/scope.ts`](../../src/platform/authz/scope.ts): `scopeWhere` with the identifier guard.
- [`src/modules/members/repo.ts`](../../src/modules/members/repo.ts): an example repository.
