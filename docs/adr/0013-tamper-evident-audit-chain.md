# 0013 Tamper-evident audit chain computed by a database trigger

- Status: Accepted
- Date: 2026-10-31

## Context

ADR [0004](./0004-audit-in-the-same-transaction.md) makes the audit log append-only, but nobody can prove history was not rewritten: a database owner can disable a trigger, edit a row and re-enable it. Our twist, "Proof, not promises", says donors and judges should not have to take our word that an approved number is real. Part one makes the audit log tamper-evident.

## Decision

- `audit_events` gains `chain_seq` (bigint, unique), `prev_hash` and `hash` (64 lowercase hex characters).
- A `BEFORE INSERT` trigger fills them for every insert from any writer (`command()`, the seed, tests). It takes a transaction advisory lock (key 727275; the migration runner uses 727274 and the seed 727276, and a test keeps the three apart), reads the row with the highest `chain_seq`, and sets `chain_seq = last + 1`, `prev_hash = last.hash` (64 zeros for the first row) and `hash = sha256(canonical_v1)`. Values supplied by the client for these columns are always overwritten.
- **Why `chain_seq` and not `id`.** The identity value is allocated before the trigger takes the lock, so under concurrency `id` order and commit order can differ. `chain_seq` is assigned under the lock. The unique index turns any fork, for example a transaction reading a stale head, into a loud error instead of a silent branch.
- **Writers run at READ COMMITTED.** The head lookup takes a fresh snapshot after the lock is granted, so it sees the row the previous lock holder committed. A writing transaction at REPEATABLE READ or SERIALIZABLE would read a stale head and fail on the unique index. Stronger isolation is used only in `READ ONLY` transactions (the reporting reads), and a guard test rejects any other use in application code.
- **Canonical form v1** is a fixed sequence of fields, each written as `|` plus `length:value`, or `|-` for null: a version tag, `chain_seq`, `prev_hash`, `id`, the UTC timestamp to microseconds, request id, actor id and role, action, entity type and id, branch id, report id, and the `before` and `after` JSON as Postgres renders them. The length prefix makes the encoding unambiguous. The verifier reads the JSON text from Postgres and never re-serialises it.
- **Independent verifier.** `verifyAuditChain` in TypeScript recomputes every hash with Node's crypto in batches of 1000 and reports the first failure. Each row is checked in this order: `sequence_gap` (its `chain_seq` is not one more than the previous row's: a row was deleted or inserted), `hash_mismatch` (its stored fields, `prev_hash` included, no longer hash to its stored `hash`: this row was edited), `link_mismatch` (the row is self-consistent but its `prev_hash` is not the previous row's hash: an earlier row was replaced by a forgery whose hash was recomputed). A cached status (60 seconds, single flight, bypassable) feeds a badge on the audit viewer, with a "Check again" link that forces a fresh walk, and `GET /api/v1/audit/chain` for Super Admin and Finance Reviewer.
- **Backfill without weakening immutability.** The migration hashes existing rows in `id` order, disabling the update guard only inside its own transaction and re-enabling it before commit. A test proves the guard is enabled afterwards and that updates and deletes still fail.
- **External anchors.** Each approved report's public verification code carries a seal: the first 16 hex characters of its approval event's hash (ADR [0014](./0014-public-report-verification.md)). The seal lives on paper, in QR codes and in messages, outside the database.

## Consequences

### Positive

- Editing, deleting or inserting any row in the middle of the log is detected by the verifier and shown on the audit viewer.
- Every writer is covered, including ones that bypass `command()`, because the trigger does the work.
- The verifier is independent of the trigger, so a bug in one is caught by the other.

### Negative

- **Honest limits.** Someone with full database rights can rewrite the whole chain from the edited row onward, and deleting the newest rows leaves no gap. The chain alone cannot detect either.
- **Mitigation.** Seals held outside the database. A rewrite changes the hash of every later approval event, so any seal a donor holds stops matching. Seals are as strong as the number of copies in other hands.
- Inserts into the audit log are serialised by the lock. The lock is held only from the audit insert to commit, and `command()` writes audit rows last, so contention is short at this scale.

### Neutral

- The test harness truncates the table, so the chain restarts at the genesis value in each test run; that is correct behaviour.

## Alternatives considered

- **Hashing in application code.** Misses writers that do not go through `command()`, such as the seed or a manual fix.
- **Merkle tree.** Allows proofs about single rows, but is more complex than a linear chain needs to be here.
- **External timestamping or a signed daily digest of the chain head.** Stronger anchoring; recorded as future work because it needs key management and a publication channel.

## Where it lives

- [`db/migrations/202610281000_foundation_identity_audit.sql`](../../db/migrations/202610281000_foundation_identity_audit.sql): the append-only guards the chain builds on.
- [`src/platform/audit/command.ts`](../../src/platform/audit/command.ts): writes audit rows last in the transaction.
- [`db/migrations/202610311400_audit_chain.sql`](../../db/migrations/202610311400_audit_chain.sql): columns, trigger and backfill.
- [`src/platform/audit/chain/canonical.ts`](../../src/platform/audit/chain/canonical.ts) and [`src/platform/audit/chain/types.ts`](../../src/platform/audit/chain/types.ts): canonical form in TypeScript.
- [`src/platform/audit/chain/verify.ts`](../../src/platform/audit/chain/verify.ts): verifier and cached status.
- [`src/platform/audit/chain/tamper.int.test.ts`](../../src/platform/audit/chain/tamper.int.test.ts): edits, deletions and insertions are detected.
- [`tests/db/audit-chain.test.ts`](../../tests/db/audit-chain.test.ts): trigger, concurrency and backfill.
- [`src/platform/audit/isolation-guard.test.ts`](../../src/platform/audit/isolation-guard.test.ts): no writable REPEATABLE READ or SERIALIZABLE transaction in application code.
- [`src/app/api/v1/audit/chain/route.ts`](../../src/app/api/v1/audit/chain/route.ts): chain status endpoint, tested in [`tests/http/audit-chain.test.ts`](../../tests/http/audit-chain.test.ts).
- [`src/components/verification/ChainStatusBadge.tsx`](../../src/components/verification/ChainStatusBadge.tsx) and [`src/components/verification/AuditChainSection.tsx`](../../src/components/verification/AuditChainSection.tsx): the badge in the audit viewer.
- [`tests/e2e/journeys/tamper.spec.ts`](../../tests/e2e/journeys/tamper.spec.ts): edits a past audit event in the running app, sees the badge and the public check break, restores it and sees both heal.
- [`docs/verification.md`](../verification.md): how to check, and the limits.
