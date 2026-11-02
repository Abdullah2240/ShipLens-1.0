# Architecture decision records

Each record explains one decision that shapes ShipLens: the problem, what we chose, what it costs, what we rejected, and where to find it in the code. Read them in order for the full picture; each one stands alone. New records start from the [template](./0000-template.md).

Every record below is built: its "Where it lives" section links only to files that exist, checked against the code on 2026-11-01. A future record whose implementation is still landing lists those files under a final "Where it lives (planned)" section until they exist. Records are never deleted; a replaced decision is marked "Superseded by" its successor.

| No. | Decision | Status | Date |
| --- | --- | --- | --- |
| [0001](./0001-one-nextjs-app-on-render.md) | One Next.js full-stack app plus Postgres, one Docker image on Render | Accepted | 2026-10-28 |
| [0002](./0002-route-handlers-not-server-actions.md) | Route handlers under /api/v1 through one route() wrapper, no Server Actions | Accepted | 2026-10-28 |
| [0003](./0003-plain-sql-and-own-migrations.md) | Plain parameterised SQL with pg and our own forward-only migration runner | Accepted | 2026-10-28 |
| [0004](./0004-audit-in-the-same-transaction.md) | Audit events written by command() in the same transaction as the change | Accepted | 2026-10-28 |
| [0005](./0005-permission-table-as-data-and-scopes.md) | Permission table as data, authorize() returns a branded Scope | Accepted | 2026-10-28 |
| [0006](./0006-database-sessions-and-argon2id.md) | Database-backed opaque sessions and argon2id passwords | Accepted | 2026-10-28 |
| [0007](./0007-money-as-decimal-strings.md) | Money as numeric(14,2) and decimal strings, never floats | Accepted | 2026-10-28 |
| [0008](./0008-utc-instants-and-pkt-business-dates.md) | UTC instants, PKT business dates and an injected clock | Accepted | 2026-10-28 |
| [0009](./0009-bilingual-by-shared-keys-and-logical-css.md) | Bilingual by shared message keys, locale routing and logical CSS | Accepted | 2026-10-28 |
| [0010](./0010-report-lifecycle-transition-table.md) | Weekly report lifecycle as an explicit transition table with conditional updates | Accepted | 2026-10-28 |
| [0011](./0011-one-shared-reporting-module.md) | One shared reporting module for every number | Accepted | 2026-10-28 |
| [0012](./0012-nonce-based-csp.md) | Nonce-based Content Security Policy set in the proxy | Accepted | 2026-10-31 |
| [0013](./0013-tamper-evident-audit-chain.md) | Tamper-evident audit chain computed by a database trigger | Accepted | 2026-10-31 |
| [0014](./0014-public-report-verification.md) | Public verification of approved weekly reports | Accepted | 2026-10-31 |
| [0015](./0015-built-in-keep-warm.md) | Built-in keep-warm on the Render free tier | Accepted | 2026-10-31 |
| [0016](./0016-testing-strategy.md) | Testing strategy: real Postgres, generated matrices and full journeys | Accepted | 2026-10-28 |
| [0017](./0017-production-on-vercel-and-neon.md) | Production on Vercel with Neon Postgres | Accepted | 2026-11-01 |

## How the records fit together

- **Platform shape:** 0001 (one app, one image), 0002 (one way into the API), 0003 (SQL and migrations), 0017 (where production runs).
- **Trust and traceability (the Core Value):** 0004 (audit in the same transaction), 0005 (permissions and scopes), 0010 (report lifecycle), 0011 (one definition per number), 0013 and 0014 (proof that approved numbers were not altered).
- **Security:** 0005, 0006 (sessions and passwords), 0012 (CSP), with defence in depth from 0002 and 0004.
- **Correctness of data:** 0007 (money), 0008 (time).
- **People and languages:** 0009 (English and Urdu, right to left).
- **Operations and quality:** 0015 (keep-warm, Render only), 0016 (testing), 0017 (Vercel and Neon in production).
