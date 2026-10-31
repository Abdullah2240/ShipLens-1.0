# 0010 Weekly report lifecycle as an explicit transition table with conditional updates

- Status: Accepted
- Date: 2026-10-28

## Context

A branch's weekly report is the unit head office trusts. It is drafted automatically, submitted by the Branch Lead, then either returned with a reason or approved by a Finance Reviewer. A returned report is corrected and resubmitted; an approved report is locked forever. The acceptance gate is that a report goes draft, submit, return, resubmit, approve, lock with every step audited.

The risks are classic workflow bugs: a status changed from a place nobody reviewed, two reviewers acting on the same report at the same moment (one approves while the other returns), totals that change after a reviewer has looked at them, and an "approved" report quietly edited later.

## Decision

- **One table of transitions.** The allowed moves are data in one pure module:

  | From | Action | To | Event |
  | --- | --- | --- | --- |
  | draft | submit | submitted | submitted |
  | returned | submit | submitted | resubmitted |
  | submitted | return | returned | returned |
  | submitted | approve | approved | approved |

  `nextReportStatus(from, action)` returns the target or `null`. The UI asks the same function which actions to offer.
- **Conditional updates.** Every transition is one `UPDATE weekly_reports ... WHERE id = $1 AND status = $from AND <scope>` inside `command()`. If no row changes, a scoped existence check decides between 404 (missing or out of scope) and 409 `invalid_transition`. When two reviewers race, exactly one update matches; the other gets 409 and writes nothing.
- **Frozen totals.** Submit and resubmit freeze `total_amount` and `collection_count` from the active collections, set `submitted_at`, `submitted_by` and increment `version`. A report with no collections needs an explicit nil confirmation. Approve re-checks that the frozen total still equals the live sum (409 `totals_mismatch`) and refuses self-approval (409 `self_approval`).
- **Return needs a reason** (3 to 500 characters), stored on the report and in the event.
- **One transaction per step:** the report update, one `report_events` row, then one audit event.
- **Database guards as defence in depth.** Triggers reject any update to an approved report, any status change outside the four transitions, changes to branch or week, and deletes. Collections cannot be inserted into, or changed inside, a submitted or approved report; the only later change allowed on an approved report's collections is marking them routed to the main account.
- **Lazy drafts.** The draft for a branch and week is created on demand with `INSERT ... ON CONFLICT (branch_id, week_start) DO NOTHING`, and audited only when a row was actually inserted.

## Consequences

### Positive

- The lifecycle can be read in one table and tested exhaustively.
- Concurrency is safe without application locks: the database decides the winner.
- Approval means something: the numbers a reviewer saw are the numbers that were approved, and nothing can change them afterwards, even through a bug in application code.
- Every step leaves a report event and an audit event, which the timeline and drill-down show.

### Negative

- There is no override for an approved report, by design. A genuine mistake after approval needs a correcting entry in a later week, not an edit.
- Test fixtures must respect the guards: insert a report as draft, add collections, then move it along allowed transitions.

### Neutral

- "Locked" is not a fifth status; it is the consequence of `approved` being terminal.

## Alternatives considered

- **Status checks scattered in service methods.** Hard to review and easy to bypass with a new endpoint.
- **A state machine library (for example XState).** Four transitions do not need one, and it would not protect against concurrent writers.
- **Row locks (`SELECT ... FOR UPDATE`) then update.** Works, but a conditional update does the same in one statement.
- **Application checks only, no triggers.** One missed check in a future endpoint could edit an approved report.

## Where it lives

- [`src/platform/config/constants.ts`](../../src/platform/config/constants.ts): `REPORT_STATUSES`.
- [`db/migrations/202610281010_domain_schema.sql`](../../db/migrations/202610281010_domain_schema.sql): `weekly_reports` and `report_events`.
- [`src/platform/audit/command.ts`](../../src/platform/audit/command.ts): the transaction each step runs in.

## Where it lives (planned)

- [`src/modules/reports/transitions.ts`](../../src/modules/reports/transitions.ts): the transition table.
- [`src/modules/reports/service.ts`](../../src/modules/reports/service.ts) and [`src/modules/reports/repo.ts`](../../src/modules/reports/repo.ts): submit, return, approve, lazy drafts.
- [`db/migrations/202610311200_finance_guards.sql`](../../db/migrations/202610311200_finance_guards.sql): report and collection guards.
- [`tests/lifecycle/report-lifecycle.test.ts`](../../tests/lifecycle/report-lifecycle.test.ts): the full lifecycle over HTTP, audited at every step.
- [`tests/lifecycle/concurrency.test.ts`](../../tests/lifecycle/concurrency.test.ts): concurrent reviewers, one wins.
