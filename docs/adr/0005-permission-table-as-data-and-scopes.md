# 0005 Permission table as data, authorize() returns a branded Scope

- Status: Accepted
- Date: 2026-10-28

## Context

ShipLens has five roles: Super Admin, Finance Reviewer, Content Editor, Branch Lead and HR Lead. Branch Lead and HR Lead may only see their own branch. The acceptance gate is that no role exceeds its permissions, proved by tests, and the brief asks for a documented permission table.

Two failure modes are common in role-based systems. First, permission checks scattered through the code drift away from the documented table. Second, a correct permission check is followed by a query that forgets the branch filter, so a Branch Lead can read another branch's record by guessing its id. We wanted both to be hard to get wrong by construction.

## Decision

- **One table, data only.** `PERMISSIONS` in `src/platform/authz/permissions.ts` maps every action name (for example `report.approve`) to the roles that may perform it and the scope they get: `all` or `own_branch`. The file has no logic. Every action for every feature was declared up front so parallel work never edits it concurrently. Public endpoints are listed separately in `PUBLIC_ENDPOINTS`.
- **authorize() returns a Scope.** `authorize(actor, action)` reads the role and branch only from the server-side `Actor` (resolved from the session, never from the request), fails closed, logs the denial and throws `Forbidden`, or returns a `Scope`: `{ kind: 'all' }` or `{ kind: 'branch', branchId }`.
- **The Scope is type-branded.** Its brand is a type-only unique symbol and it can only be created inside the authz module. An object literal does not type-check as a `Scope`, so repository functions, which all require one, cannot be called without going through `authorize()`. `scopeWhere(scope, column)` turns it into a SQL predicate.
- **Status codes.** A role without the action gets 403. A permitted role asking for a record outside its scope gets 404, with a body identical to the 404 for a record that does not exist (apart from the request id), so ids cannot be probed. Wrong state is 409, invalid input 422.
- **Generated, not hand-written.** `docs/permissions.md` is generated from the table (`npm run permissions:doc`, with a `--check` mode for CI). The role by action matrix test is generated from the same table, so a new action is tested for all five roles automatically.

## Consequences

### Positive

- Least privilege is visible in one file and reviewable in one diff. The document, the code and the tests cannot disagree.
- The compiler enforces that data access is scoped; forgetting the scope is a type error, not a data leak.
- Identical 404s defend against enumeration across branches.

### Negative

- Branch scoping is enforced in the application, not by Postgres row-level security. A raw query written outside a repository could bypass it; lint rules and review guard against that.
- The brand is a compile-time guarantee only. A deliberate cast could forge a `Scope`; code review treats such a cast as a blocker.
- Changing the table is a coordinated edit: table, snapshot test and regenerated document in one change.

### Neutral

- Some rules are finer than the table can express (Finance Reviewer sees finance entities only in the audit viewer, a reviewer may not approve their own submission). Those live in the owning service and have their own tests.

## Alternatives considered

- **Role checks inline in each handler.** Easy to start, impossible to audit against a document.
- **Postgres row-level security.** Strong, but needs per-request session variables on pooled connections and was deferred as a later hardening step.
- **A policy library (CASL, Casbin).** Another language for rules that fit in a 100-line table.

## Where it lives

- [`src/platform/authz/permissions.ts`](../../src/platform/authz/permissions.ts): the table and `PUBLIC_ENDPOINTS`.
- [`src/platform/authz/authorize.ts`](../../src/platform/authz/authorize.ts): `authorize()`.
- [`src/platform/authz/scope.ts`](../../src/platform/authz/scope.ts): the branded `Scope` and `scopeWhere`.
- [`src/platform/authz/matrix.test.ts`](../../src/platform/authz/matrix.test.ts): generated role by action matrix.
- [`tests/db/scope-404.test.ts`](../../tests/db/scope-404.test.ts): 403 versus identical 404.
- [`scripts/gen-permissions-doc.mjs`](../../scripts/gen-permissions-doc.mjs): document generator and drift check.
- [`docs/permissions.md`](../permissions.md): the generated table.
