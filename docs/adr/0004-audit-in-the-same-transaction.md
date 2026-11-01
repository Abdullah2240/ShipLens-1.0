# 0004 Audit events written by command() in the same transaction as the change

- Status: Accepted
- Date: 2026-10-28

## Context

The Core Value of ShipLens is traceability: any approved number can be followed down to the branch, the approved weekly report, its collections and the audit events that show who did what. That only holds if a change and its audit record can never be separated. If the audit write is a separate step, a crash or a forgotten call leaves a change with no trace.

Audit rows also must not leak sensitive data. Applicant contact details, free-text messages and content bodies should never be copied into an append-only table that cannot be cleaned later.

## Decision

- Every mutation runs inside `command(ctx, name, fn)`. It opens one transaction, runs `fn(tx, audit)`, then inserts every audit event that `fn` emitted using the same transaction handle, and commits. The change and its audit rows commit or roll back together.
- A command that emits zero audit events fails with `MissingAuditError` and rolls back. The only exception is a named allowlist (`COMMANDS_WITHOUT_AUDIT`, today only the failed-login counter).
- A command needs an actor. Anonymous commands are a short named list (`SYSTEM_COMMANDS`: the failed-login counter and the public volunteer application); they are recorded with role `system`.
- One command per request context at a time; a nested call is a contract error.
- Each row carries request id, actor id and role, action, entity type and id, branch id, report id (nullable) and before/after snapshots. Every collection and report event sets `report_id`, so one query returns the full trace of a report.
- Snapshots keep only changed fields, and only fields on a per-entity allowlist. An unknown entity type throws. Applicant names, emails, phones and messages are not on the list; content changes store a sha256 digest of the body, not the text.
- `audit_events` is append-only in the database: a trigger rejects every `UPDATE` and `DELETE`, and a statement trigger rejects `TRUNCATE` unless the transaction sets `shiplens.allow_truncate`, which only the test harness does. `actor_id` and `branch_id` have no foreign keys so history survives later changes.

## Consequences

### Positive

- There is no code path where a change commits without its audit row; the database refuses edits to history.
- Least data: snapshots hold the minimum needed to explain a change, which keeps the audit viewer safe to show.
- The report timeline, the drill-down evidence level and the tamper-evident chain (ADR [0013](./0013-tamper-evident-audit-chain.md)) all build on this one table.

### Negative

- Every mutation must go through the wrapper. This is enforced, not hoped for: repositories may not import `@/platform/audit` (ESLint), the command tests prove rollback and refusal, and the lifecycle suites count audit rows per step.
- Adding a field to an audit snapshot is a deliberate edit to the allowlist, reviewed as a possible data leak.
- Failed logins and authorisation denials are logged through the redacting logger rather than audited, to keep the table about changes.

### Neutral

- Audit rows are written last in the transaction, after the business writes, which keeps any lock taken by the audit insert short.

## Alternatives considered

- **Database triggers on each business table.** They would capture every write, but the actor, request id and business meaning of the action are not known to a trigger without passing session variables, and snapshots would include every column.
- **Writing audit rows after commit or through a queue.** Faster requests, but a change can then exist without its trace, which breaks the Core Value.
- **pgAudit or a similar extension.** Logs statements, not business actions.

## Where it lives

- [`src/platform/audit/command.ts`](../../src/platform/audit/command.ts): the `command()` wrapper and its guards.
- [`src/platform/audit/allowlist.ts`](../../src/platform/audit/allowlist.ts): per-entity field allowlist.
- [`src/platform/audit/mask.ts`](../../src/platform/audit/mask.ts): changed-field snapshots.
- [`src/platform/audit/command.int.test.ts`](../../src/platform/audit/command.int.test.ts): transaction, rollback and refusal against Postgres.
- [`db/migrations/202610281000_foundation_identity_audit.sql`](../../db/migrations/202610281000_foundation_identity_audit.sql): table, immutability and truncate guards.
- [`tests/db/schema.test.ts`](../../tests/db/schema.test.ts): immutability proven against the database.
- [`eslint.config.mjs`](../../eslint.config.mjs): repositories cannot import the audit module.
