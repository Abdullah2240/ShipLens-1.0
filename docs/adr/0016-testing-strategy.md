# 0016 Testing strategy: real Postgres, generated matrices and full journeys

- Status: Accepted
- Date: 2026-10-28

## Context

The acceptance gates are behavioural: the dashboard shows the expected values for the demo data, a weekly report goes through its whole lifecycle with every step audited, and no role exceeds its permissions, proved by tests. Tests and a passing CI are worth 15 of the 100 judging points, and the brief asks for at least 60% backend coverage.

Much of the important logic lives in Postgres: triggers, conditional updates, views, sequences, `date` and `numeric` handling. Mocking the database would test our assumptions about it, not the system. Work also runs in parallel, so tests must not share or corrupt each other's state.

## Decision

- **Two Vitest projects.** The `unit` project runs everything named `*.test.*` under `src/` and `scripts/`, needs no database and runs anywhere. The `integration` project runs `tests/**`, `db/**` and `*.int.test.*` files against a real Postgres 16. The naming rule decides which project a file belongs to.
- **A private test database per stream of work.** `TEST_DATABASE_URL` must name a database ending in `_test`; the global setup creates it if missing and runs the real migrations. Integration files run one at a time and reset state by truncating tables, which only the harness is allowed to do on the audit log.
- **Generated role by action matrix.** One test case per action and role is generated from the permission table, so every new action is covered for all five roles. An HTTP-level matrix does the same over the real route handlers.
- **Cross-branch isolation.** A Branch Lead or HR Lead of one branch asks for every kind of record of another branch and must get the identical 404.
- **Lifecycle and race tests.** The full report lifecycle over HTTP with audit row counts per step; the lock boundary on day 7 and day 8 and at PKT midnight with an injected clock; concurrent approve and return (one wins, one gets 409); concurrent application accepts (exactly one member); rollback leaving no audit row.
- **Reconciliation against expected values.** The organisers' sample data never arrived, so a deterministic generator produces a clearly fictional demo dataset, and an independent calculator, sharing no code with the app, writes the expected figures. The reconciliation test loads the dataset and asserts every dashboard figure, trend month, per-branch value, unrouted list, frozen total, drill-down footer and export total equals them exactly.
- **End-to-end journeys.** Playwright runs against the production Docker image with Postgres via Docker Compose, in four projects (desktop and mobile, English and Urdu, light and dark). Journeys cover the five roles, the report lifecycle, application to member, drill-down to audit events, public verification in both languages, and tamper detection with restore. Specs that change data restore it.
- **Coverage thresholds** are 60% lines, statements and functions and 50% branches over `src/modules/**` and `src/platform/**`, enforced in CI and never lowered to pass; missing coverage is fixed with tests.

## Consequences

### Positive

- Database guards, triggers and SQL definitions are tested as they run in production.
- Permission coverage grows automatically with the permission table, which is the strongest evidence for least privilege.
- The reconciliation test ties the most visible number on the dashboard to an independent calculation.

### Negative

- Integration tests need Docker and are slower; they run serially within one database.
- End-to-end runs need the full image build and are the heaviest step in CI.
- Coverage thresholds measure lines run, not correctness; the behavioural suites carry the real weight.

### Neutral

- Unit tests also check build-time rules (layer imports, message parity, logical CSS) so those fail fast.

## Alternatives considered

- **Mock the database.** Fast, but would miss trigger, guard and type-parsing bugs.
- **Transaction rollback per test.** Cannot test code that commits its own transaction or runs concurrent transactions.
- **pg-mem or SQLite in memory.** Different SQL dialect and no triggers or `numeric` parity.
- **Hand-written permission tests.** Drift from the table as actions are added.

## Where it lives

- [`vitest.config.ts`](../../vitest.config.ts): projects, naming rule and coverage thresholds.
- [`tests/support/global-setup.ts`](../../tests/support/global-setup.ts) and [`tests/support/db.ts`](../../tests/support/db.ts): private test database, migrations and reset.
- [`src/platform/authz/matrix.test.ts`](../../src/platform/authz/matrix.test.ts): generated role by action matrix.
- [`tests/db/scope-404.test.ts`](../../tests/db/scope-404.test.ts): 403 versus identical 404.
- [`src/platform/audit/command.int.test.ts`](../../src/platform/audit/command.int.test.ts): audit rollback and refusal.
- [`scripts/lint-layers.test.mjs`](../../scripts/lint-layers.test.mjs): layer rules.
- [`tests/http/role-matrix.test.ts`](../../tests/http/role-matrix.test.ts) and [`tests/http/cross-branch.test.ts`](../../tests/http/cross-branch.test.ts): HTTP matrix and isolation.
- [`tests/lifecycle/`](../../tests/lifecycle/): lifecycle, lock boundary, concurrency and rollback suites.
- [`db/seed/expected.json`](../../db/seed/expected.json): expected values for the demo dataset.
- [`tests/reconciliation/dashboard-reconciliation.test.ts`](../../tests/reconciliation/dashboard-reconciliation.test.ts): reconciliation.
- [`playwright.config.ts`](../../playwright.config.ts) and [`tests/e2e/journeys/`](../../tests/e2e/journeys/): end-to-end journeys.
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml): CI running all of the above.
