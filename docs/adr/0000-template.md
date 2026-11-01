# NNNN Title in plain words

- Status: Accepted | Proposed | Superseded by NNNN
- Date: YYYY-MM-DD

<!--
How to use this template:
- Copy this file to `NNNN-short-slug.md` with the next free number and add a row to README.md.
- The date is the day the decision was made, not the day the record was written.
- One decision per record. 250 to 600 words. Plain, direct English, short paragraphs.
- A record that is replaced is not deleted: set its status to "Superseded by NNNN" and link the new one.
- Never put secrets, real personal data or credentials in a record.
-->

## Context

What problem or force made a decision necessary? Name the constraints (the brief, the deadline, the hosting platform, security requirements, team size) and what would go wrong without a deliberate choice.

## Decision

What we do, stated so a reader could check the code against it. Include the rules that make the decision hold over time (lint rules, tests, database constraints), not only the first implementation.

## Consequences

### Positive

- What gets easier, safer or more traceable.

### Negative

- What it costs, what it rules out, and the accepted residual risk.

### Neutral

- Effects that are neither good nor bad but that a maintainer should know.

## Alternatives considered

- **Alternative name.** Why it was not chosen.

## Where it lives

- [`src/platform/audit/command.ts`](../../src/platform/audit/command.ts): one line on what this file does for the decision. Links are relative to this folder.

<!--
If part of the decision is not implemented yet, add a final section titled
"Where it lives (planned)" that lists the intended files. Nothing else may follow it.
-->
