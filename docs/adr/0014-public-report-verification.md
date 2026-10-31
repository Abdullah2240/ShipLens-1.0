# 0014 Public verification of approved weekly reports

- Status: Accepted
- Date: 2026-10-31

## Context

The second part of our twist, "Proof, not promises", lets anyone outside the organisation (a donor with a printed summary, a judge, a volunteer who received a WhatsApp message) confirm that an approved report exists, that its total is what they were told, and that its history has not been rewritten, without logging in or seeing personal data.

## Decision

- **Codes.** Every approved report gets a verification code: 10 Crockford base32 characters (`0-9` and `A-Z` without `I`, `L`, `O`, `U`), 50 random bits, shown as `XXXXX-XXXXX`. Codes are generated in SQL from the random bytes of `gen_random_uuid()` (skipping its fixed version and variant bits), using `byte % 32`, which is uniform because 256 is a multiple of 32; a collision retries up to five times. Input is normalised: uppercase, spaces and hyphens dropped, `O` read as `0`, `I` and `L` as `1`.
- **Issued by triggers.** A trigger on `weekly_reports` inserts the code when a row becomes `approved`, on insert or on update, with `ON CONFLICT DO NOTHING`. This covers the approve service and seeded approved reports alike, and the migration backfills existing ones.
- **Append-only.** `report_verifications (report_id, code, issued_at)` rejects updates and deletes. A code never changes.
- **Anchor and seal.** The anchor is the report's latest `report.approve` audit event. Totals evidence is the latest submit or resubmit event before it, whose snapshot holds the frozen total and collection count. Integrity, in order of precedence: `chain_broken` (the audit chain of ADR [0013](./0013-tamper-evident-audit-chain.md) is broken), `unanchored` (an event is missing), `mismatch` (the anchor is not an approval, or the evidence totals differ from the report row, compared with the money module), otherwise `verified`. The seal is the first 16 hex characters of the anchor's hash; a seal passed in the link is reported as `match`, `mismatch` or `not_provided`.
- **Public surface.** `/{locale}/verify` (a plain GET form that works without JavaScript), `/{locale}/verify/{code}?s={seal}` and `GET /api/v1/public/verify/{code}`. The QR code encodes a locale-free link that redirects to the visitor's language. Shown: branch name and city, report week, approved total, collection count, approval date, integrity, anchor event number and seal, chain status and check time. Never shown: names, emails, phones, user ids, collection lines, notes or return reasons. Unknown and malformed codes give the same "not recognised" answer. Result pages are `noindex`.
- **Rate limit.** 30 lookups per minute per client IP, shared by page and API; the API answers 429 with `Retry-After`, the page shows a localised wait message.
- **Authorised surface.** Branch Lead (own branch), Finance Reviewer and Super Admin see the code, QR and seal on the approved report page; anyone else gets the identical 404.

## Consequences

### Positive

- Trust moves from "the organisation says so" to "check it yourself", with no account and no personal data exposed.
- Seals spread outside the database through print, QR and messages, which is what makes a full chain rewrite detectable.

### Negative

- The rate limit is in memory, per process. Acceptable on one instance; a distributed limit is future work.
- A code is a bearer reference: anyone holding it can see that report's public summary. The summary is deliberately limited to what the organisation would publish anyway.

### Neutral

- **Why random, not derived from the report id.** A derived code would reveal internal ids or allow guessing other reports. Random codes with 50 bits cannot be enumerated under the rate limit.
- **Why issuance is not a separate audit row.** It happens inside the approval transaction, the code is random, immutable and carries no business meaning, and the approval event is already the anchor. An extra audit row would also change the per-step audit counts the lifecycle tests assert.

## Alternatives considered

- **Signed tokens (for example an HMAC of the report).** Long, needs key management, and proves only that we issued it, not that history is intact.
- **Login-only verification.** Donors and judges have no account.
- **Public collection lines.** Exposes too much; aggregates are enough.

## Where it lives

- [`src/platform/money/index.ts`](../../src/platform/money/index.ts): exact comparison of totals.
- [`src/platform/audit/command.ts`](../../src/platform/audit/command.ts): writes the approval event the code is anchored to.

## Where it lives (planned)

- [`db/migrations/202610311410_report_verification.sql`](../../db/migrations/202610311410_report_verification.sql): table, issuing triggers and backfill.
- [`src/modules/verification/code.ts`](../../src/modules/verification/code.ts): normalising and formatting codes.
- [`src/modules/verification/service.ts`](../../src/modules/verification/service.ts) and [`src/modules/verification/repo.ts`](../../src/modules/verification/repo.ts): lookup, integrity and seal check.
- [`src/platform/rate-limit/index.ts`](../../src/platform/rate-limit/index.ts): in-memory limiter.
- [`src/app/api/v1/public/verify/[code]/route.ts`](../../src/app/api/v1/public/verify/[code]/route.ts): public API.
- [`src/app/api/v1/reports/[id]/verification/route.ts`](../../src/app/api/v1/reports/[id]/verification/route.ts): authorised code, path and seal.
- [`src/components/verification/Qr.tsx`](../../src/components/verification/Qr.tsx) and [`src/components/verification/VerificationPanel.tsx`](../../src/components/verification/VerificationPanel.tsx): QR as an SVG path and the report page panel.
- Public pages: `src/app/[locale]/(public)/verify/`.
