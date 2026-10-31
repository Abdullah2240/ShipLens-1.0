# How we used AI tools

This is the one file in the repository that names the AI tools we used. Everywhere else
(code, comments, docs, commit messages) we keep tool names out, and
`scripts/check-tool-mentions.mjs` enforces that. Lines starting with `OWNER-CONFIRM:` are
open questions for us to answer before submission; they are not claims.

## 1. Summary

We used AI tools heavily: for research and planning, for writing most of the code and the
tests, for review passes and for drafting the documentation. The work was done by AI agents
working from written plans, with many agents running in parallel in separate git worktrees.
The two of us chose the product scope, the stack, the split of work, every recorded
decision, the design direction and the twist, and we review the result before it reaches
`main`. Nothing was merged onto a phase branch without passing typecheck, lint and the
automated tests (unit tests, integration tests against a real Postgres database, and
Playwright browser tests running against the production Docker image).

## 2. Tools

| Tool                                                            | Vendor            | Models                                                     | Used for                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (command-line coding agent)                         | Anthropic         | Claude models (see below)                                  | Research, requirements, roadmap, phase plans, plan checking, most of the code and tests, review passes, documentation drafts, running the overnight lanes |
| GSD planning workflow (open-source command set for Claude Code) | Community project | Uses the Claude Code session's models ("balanced" profile) | The structure of the work: research, roadmap, one plan per unit of work, plan checking, execution and per-plan summaries                                  |
| OpenAI Codex CLI                                                | OpenAI            | gpt-6-luna, gpt-6-sol                                      | Code and tests for Phase 2 plans 02-01 to 02-05                                                                                                           |

- **Claude Code.** The overnight lane that drafted this file ran on Claude Opus 5.5.
  OWNER-CONFIRM: which Claude models, and which Claude Code version, ran the sessions of
  28-31 Oct?
- **OpenAI Codex CLI.** gpt-6-luna at medium reasoning was the configured default (also
  set aside for translation and message files); gpt-6-sol was used for the
  security-sensitive plans (the request adapter, the public application endpoint, the
  members and teams backend). It was launched from a Claude Code session, which wrote its
  prompts and checked its output. OWNER-CONFIRM: Codex CLI version?
- Every session in our record ran on one development machine (see section 4).

OWNER-CONFIRM: did either of us use any other AI tool for this project (a chat app, editor
completions, translation, images, or editing the walkthrough video)? If yes, add a row.

## 3. How we used them, by activity

**Planning.** On 28 Oct we gave Claude Code the brief and our earlier build plan and ran the
GSD workflow: four research agents in parallel (stack and deployment, features,
architecture, pitfalls), a synthesis, a roadmap of four phases, and detailed plans for each
phase. An automatic plan checker reviewed the plans; on the first pass it found 4 blockers
and 7 warnings, which were fixed before any code was written. The remaining Phase 2, Phase 3
and Phase 4 plans were written the same way on 31 Oct, after we made the decisions listed in
section 4. Every plan names its files, its tests and its checks. The planning documents stay
on our machine and are not committed. OWNER-CONFIRM: was the earlier build plan (the team's
own plan from before 28 Oct) written by you without AI tools?

**Code generation.**

- Phase 1, first 11 plans (28 Oct): Claude Code ran several executor agents in parallel, one plan each, for
  the platform kernel (permissions, audit, money, time, sessions, database) and then for the
  bilingual shell (locale routing, fonts, design tokens, shared components).
- Phase 2, plans 02-01 to 02-05 (28 Oct 23:25 to 30 Oct 00:42 PKT, see the git history for
  those dates): OpenAI Codex CLI wrote the code from prompts built by a Claude Code session,
  which then reviewed the files against the plan, ran the tests and fixed what failed. The
  machine ran low on memory and the Claude Code harness killed a Codex CLI run four times; each time we
  stopped, and resumed only when we said so. The run for plan 02-08 died after writing one
  test file and an empty placeholder; a Claude Code lane later checked that file against the plan and finished the plan.
- From the evening of 31 Oct to the morning of 1 Nov: Claude Code agents implemented the
  remaining plans overnight, one plan per git worktree and branch, up to four at a time, each
  with its own test database. An orchestrating session merged each lane onto its phase branch
  only after typecheck, lint and tests passed, and ran a full gate (production image build,
  migrations, seed, Playwright) on the merged branch. A process restart and a usage-limit
  pause interrupted some lanes; those were resumed from their committed and uncommitted work,
  not restarted from scratch.

**Tests.** Tests were written from the plans, test-first where a plan said so, by the same
agents that wrote the code. Integration tests run against a real Postgres 16 database, never
a mock. OWNER-CONFIRM: which test suites did each of us read and check by hand?

**Review.** Plans were checked by an automatic plan checker before execution. Lane output
was checked by the orchestrating session against the plan and by the merge gates. A final
review and documentation reconciliation pass and a coverage top-up are scheduled as the last
overnight steps. We review each phase branch as a pull request before it is merged into
`main` (we merged the first two that way on 31 Oct). OWNER-CONFIRM: did the final review
pass and coverage top-up run, and did you review every remaining pull request before
submission?

**Documentation.** The README, the architecture decision records, the handover, security
and verification guides, the API docs and this file were drafted by Claude Code agents from
the plans and the code; the permission table and the API inventory are generated from code.
We edit and approve them.

**The twist.** No official twist was released, so we chose our own direction, "Proof, not
promises" (a tamper-evident audit chain plus a public verification code and QR for approved
weekly reports), and asked for it to be designed. Claude Code drafted the design and the
plans; we accepted it, and agents implemented it under the same gates as everything else.

**Urdu.** The Urdu text in the app was written by the AI tools, not by a native speaker, and
is flagged for review by one. OWNER-CONFIRM: has a native Urdu speaker reviewed it, and if
so, who and when?

## 4. What people did

The two of us are Sheikh Abdullah Bin Zahid and Saniya Hassan.

- Chose the product and its scope from the brief, the stack (one Next.js app with
  PostgreSQL, deployed as a Docker image on Render) and the split of work into two tracks.
- Picked the differentiators: the drill-down trace from a dashboard figure to the audit
  events, Urdu designed in across the whole app, the WhatsApp share button and the public
  impact page.
- Made the recorded decisions, including on 31 Oct: the deadline; that nothing is cut;
  Render only; keep-warm built into the app every 10 minutes; generated fictional demo data,
  because the organisers' sample data never arrived; the twist direction; Urdu flagged for
  native review; how branches are pushed and merged; the licence holders and the security
  contact; and that this file must be accurate and specific.
- Gave the go-ahead for each run, stopped runs when the machine was struggling, and decided
  when to resume.
- Review the work and open and merge the pull requests into `main`; agents never open or
  merge pull requests to `main`.
- Deploy to Render, check the live site and record the walkthrough video ourselves.

Commits carry our own git identities; no AI tool appears as a commit author.
OWNER-CONFIRM: every Claude Code and Codex CLI session ran on one development machine, and
most commits from 28 Oct 18:32 onward (both tracks, including the overnight lanes) carry
Saniya Hassan's git identity. Say here who directed which sessions, so the record matches
who did the work.

OWNER-CONFIRM: was any code or text in the repository written fully by hand? If yes, name
it here.

## 5. How we checked AI output

AI output was never trusted on its own. These checks run on every change:

- **CI gates** (GitHub Actions): lint, typecheck, permission-doc drift, translation-key
  parity, unit tests; migrations from an empty database twice (the second run must apply
  nothing); integration tests with coverage; the production image with a smoke test, a
  non-root check and Playwright; one required `ci-ok` check.
- **Coverage thresholds** set in `vitest.config.ts` (lines, statements and functions 60%,
  branches 50%) and never lowered to make a run pass.
- **Role-by-action matrix**: every role against every endpoint (462 cases when it landed,
  526 after the head office endpoints were added), plus cross-branch tests proving a branch
  user gets the same 404 for another branch's records as for records that do not exist.
- **Lifecycle and race tests**: a weekly report going draft, submit, return, resubmit,
  approve and lock with every step audited; the 7-day collection lock at the PKT midnight
  boundary; concurrent approve, submit and accept.
- **Reconciliation test**: dashboard figures checked against `db/seed/expected.json`, an
  oracle computed independently from the generated demo data.
- **End-to-end journeys** in Playwright against the production Docker image, in English and
  Urdu, light and dark, desktop and mobile.
- **Security header check** against the production build, a secret scan, and the
  tool-mention check for this file's rule.
- **Manual walkthrough** of the live Render URL by us before submission.

OWNER-CONFIRM: confirm each check above is present and green at the submitted commit, and
that the manual walkthrough on the live URL was done.

## 6. Boundaries

- No real personal data was given to any tool. All demo data is generated and fictional,
  and demo logins use the reserved `.test` domain.
- No secrets were pasted into any tool. Demo passwords are set at deploy time, generated per
  CI run, and never committed.
- We never invented the organisers' sample data or presented the generated data as theirs;
  the README says so.
- No AI tool is a commit author, and by our choice commits carry no attribution lines. This
  file is where we disclose AI use instead.

## 7. Marker

The line below lists the names the tool-mention check looks for in every other file and in
every commit message. Keep it in sync with this file.

<!-- tool-names: Claude | Claude Code | Claude Opus | Anthropic | OpenAI | Codex CLI | OpenAI Codex | GPT | gpt-6-luna | gpt-6-sol | GSD | Co-Authored-By -->
