# 0007 Money as numeric(14,2) and decimal strings, never floats

- Status: Accepted
- Date: 2026-10-28

## Context

ShipLens records offline collections in Pakistani rupees and rolls them up into weekly reports, a head office dashboard, CSV exports, a public impact page and verification pages. The acceptance gate is that the dashboard shows the expected values for the sample data exactly. A total that is off by one paisa, or that reads `1234.5000000001`, fails that gate and undermines trust in every other number.

JavaScript numbers are binary floating point: `0.1 + 0.2` is not `0.3`. The `pg` driver returns `numeric` as a string by default precisely so that precision is not lost, and it is easy to undo that by calling `Number()` or `parseFloat` somewhere along the way.

## Decision

- **Storage.** Every amount is `numeric(14,2)` in Postgres: two decimal places, up to 12 integer digits. SQL aggregates cast back to the same type and to text (`COALESCE(SUM(amount), 0)::numeric(14,2)::text`) so totals always have two decimals.
- **Transport.** Amounts are decimal strings (`MoneyString`) end to end: from the driver, through services and JSON responses, into components. The driver keeps its default string parsing for `numeric` and `int8`.
- **Arithmetic.** Only `src/platform/money` does arithmetic. It converts a decimal string to BigInt minor units (paisa), adds, subtracts, sums and compares in BigInt, and converts back to a canonical two-decimal string. Floating point is never used in that module, and zero never carries a sign.
- **Input.** `parseMoneyInput` is the only gate for user-entered amounts: positive, at most two decimals, at most 12 integer digits, returning the canonical string or an `invalid_money` error. A shared Zod schema wraps it.
- **Display.** `formatMoney` formats from the string, never from a number: `PKR 1,234.50`, Latin digits and 3-digit grouping in both English and Urdu.
- **Ratios.** Where a bar width or share is needed, it is computed in basis points with BigInt.

## Consequences

### Positive

- Totals are exact, and the reconciliation test can compare figures as strings.
- Frozen report totals, live sums, export total rows and verification pages agree to the paisa because they all use the same arithmetic.
- One module to review for money handling; a code search for `Number(` or `parseFloat` near an amount is a review check.

### Negative

- Every place that touches an amount needs the money helpers instead of plain operators, which is more verbose.
- JSON consumers receive strings, not numbers; the API document states this.
- Values above 12 integer digits are rejected. That is far beyond the scale of a volunteer organisation.

### Neutral

- Counts (collection counts, record counts) are integers and travel as integer strings where they come from `int8`, to keep one shape.
- Only PKR is supported; there is no currency column.

## Alternatives considered

- **JavaScript numbers with rounding at display time.** Errors accumulate in sums before rounding, and the oracle check is exact.
- **decimal.js or big.js.** Correct, but a dependency for four operations that BigInt already covers.
- **Integer minor units in the database (`bigint` paisa).** Exact as well, but every SQL total and every export would need a division and formatting step, and the brief's sample data is in rupees with decimals.
- **Postgres `money` type.** Locale-dependent output and awkward casting; `numeric` is the standard choice.

## Where it lives

- [`src/platform/money/index.ts`](../../src/platform/money/index.ts): BigInt minor-unit arithmetic and input parsing.
- [`src/platform/money/money.test.ts`](../../src/platform/money/money.test.ts): exactness and input rules.
- [`src/platform/db/pool.ts`](../../src/platform/db/pool.ts): driver type parsers.
- [`src/platform/i18n/format.ts`](../../src/platform/i18n/format.ts): `formatMoney` from strings.
- [`db/migrations/202610281010_domain_schema.sql`](../../db/migrations/202610281010_domain_schema.sql): `numeric(14,2)` columns.
- [`src/platform/config/constants.ts`](../../src/platform/config/constants.ts): `MONEY` scale and digit limits.
