# 0011 One shared reporting module for every number

- Status: Accepted
- Date: 2026-10-28

## Context

The same totals appear in many places: the head office dashboard cards, the monthly trend, the list of collections not yet routed to the main account, every level of the drill-down, CSV exports, print pages, the public impact page, the WhatsApp share text and the public verification page. If each feature wrote its own `SUM(...)`, the definitions would drift. A draft amount would leak into an "approved" figure somewhere, or a voided collection would be counted on one screen and not on another, and the drill-down would stop adding up.

The Core Value says a head office figure must drill down to branch, report, collections and audit events, and each level must add up to the number that was clicked. The dashboard must also match the expected values for the demo dataset exactly.

## Decision

- `src/modules/reporting/` is the read model. Every screen, export and public page that shows a total calls its services. No other module writes totals SQL.
- **One SQL view encodes the definitions once.** `v_kpi_collections` joins non-voided collections to their report and exposes boolean columns: `is_approved`, `is_pending_approval` (report submitted), `is_in_progress` (draft or returned), `is_not_yet_routed` and `is_routed` (approved, split by `routed_at`). Each money figure is `SUM(amount)` over the view with one of those predicates and the active filters; count figures are active branches and reports awaiting review.
- **Identities hold by construction**, because report statuses partition the collections and `routed_at` partitions the approved ones: collected = approved + pending + in progress, and approved = routed + not yet routed. The service still checks both with the money module and exposes the result.
- **Draft, submitted and returned amounts can never reach an approved figure**, because only `is_approved` rows feed approved, routed and not-yet-routed.
- **One snapshot per read.** Multi-query reads run in one `READ ONLY`, `REPEATABLE READ` transaction, so rows, totals and the "as of" time agree.
- **The drill-down is a proof chain.** Each level re-checks its path (the branch exists, the report belongs to it and satisfies the figure, the collection belongs to the report). Each level's footer total is the SQL sum of the rows shown and must equal the parent figure (`matchesParent`). A broken path is the identical 404.
- Filters (month range, branch) are parsed once, never widen the actor's scope, and serialise to one canonical URL.
- The repositories read other modules' tables with their own SQL, a deliberate read-model exception; audit evidence comes from the timeline service.

## Consequences

### Positive

- Every number has one definition, so the dashboard, drill-down, exports and public pages cannot disagree.
- The reconciliation test can assert every figure, trend month, per-branch value and export total against one expected-values file.
- A "How is this calculated" panel can describe each figure from the same definitions.

### Negative

- Changing a definition is a migration (the view), not a code tweak.
- The read model knows about other modules' tables, which couples it to their schema; tests cover the joins.

### Neutral

- The public impact page uses only aggregate approved figures and active branch names; its SQL is checked by a test that forbids personal data columns.

## Alternatives considered

- **Each feature computes its own totals.** Fast to start, guaranteed to drift.
- **Summing the frozen report totals.** Frozen totals are a check (they must equal the live sum), not the source; collection rows are needed for drill-down and routing anyway.
- **A materialised view or summary table.** Faster at scale, but adds refresh timing to the correctness story; volumes are small.

## Where it lives

- [`src/platform/config/constants.ts`](../../src/platform/config/constants.ts): `KPI_NAMES`.
- [`src/platform/money/index.ts`](../../src/platform/money/index.ts): identity checks in exact arithmetic.

## Where it lives (planned)

- [`db/migrations/202610311300_reporting_views.sql`](../../db/migrations/202610311300_reporting_views.sql): the `v_kpi_collections` view.
- [`src/modules/reporting/figures.ts`](../../src/modules/reporting/figures.ts) and [`src/modules/reporting/filters.ts`](../../src/modules/reporting/filters.ts): figure map and filters.
- [`src/modules/reporting/service-dashboard.ts`](../../src/modules/reporting/service-dashboard.ts): dashboard, trend and unrouted lists.
- [`src/modules/reporting/service-trace.ts`](../../src/modules/reporting/service-trace.ts): drill-down levels.
- [`src/modules/reporting/service-export.ts`](../../src/modules/reporting/service-export.ts): CSV exports.
- [`src/modules/reporting/service-impact.ts`](../../src/modules/reporting/service-impact.ts): public impact figures.
- [`tests/reconciliation/dashboard-reconciliation.test.ts`](../../tests/reconciliation/dashboard-reconciliation.test.ts): every figure against the expected values.
