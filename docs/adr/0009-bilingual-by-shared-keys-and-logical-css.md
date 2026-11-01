# 0009 Bilingual by shared message keys, locale routing and logical CSS

- Status: Accepted
- Date: 2026-10-28

## Context

The brief requires English and Urdu with right-to-left layout across the whole app, public site and private platform alike. Urdu is not an add-on here: many branch volunteers read it first. Common ways this goes wrong:

- strings hard-coded in components, so the Urdu page is half English;
- English and Urdu files drifting apart, so a key renders as its raw name;
- layouts built with `margin-left` and `text-left` that look broken when mirrored;
- Urdu digits or mixed-direction text scrambling amounts, IDs and dates in finance screens.

With two builders adding screens in parallel, these rules had to be enforced by tools, not by memory.

## Decision

- **Shared message keys per module.** Every visible string lives in `messages/<locale>/<namespace>.json`, one file per module (`reports`, `members`, `audit`, ...). The namespace is the file name and the `useTranslations` argument. English and Urdu share identical keys.
- **Parity check in CI.** `npm run i18n:check` fails when a key or an ICU placeholder name exists in one locale and not the other, so translation drift breaks the build.
- **Locale in the URL.** next-intl with a `[locale]` segment and `localePrefix: 'always'` (`/en/...`, `/ur/...`), handled in `src/proxy.ts`. The root layout sets `lang` and `dir` (`rtl` for Urdu) on `<html>`. The language switcher keeps the user on the equivalent page and remembers the choice.
- **Logical CSS only.** Layout uses logical properties and Tailwind's logical utilities (`ms`, `me`, `ps`, `pe`, `start`, `end`, `text-start`). A lint script fails on physical-direction utilities and CSS (`ml-*`, `pr-*`, `left-*`, `text-left`, `margin-left`, `float: right` and similar). It runs as part of `npm run lint`.
- **One formatter.** `src/platform/i18n/format.ts` formats money, integers, dates and date-times in both locales with Latin digits and 3-digit grouping, because finance figures must read the same in both languages and match exports. Money is formatted from decimal strings only (ADR [0007](./0007-money-as-decimal-strings.md)).
- **Bidirectional isolation.** IDs, codes, emails, phones, amounts and dates inside Urdu text are wrapped in `<bdi dir="ltr">`; user-entered names use `<bdi>` with automatic direction. Small components wrap the formatters so screens do not repeat the markup.
- **Typography.** Noto Naskh Arabic for Urdu body text and data; Noto Nastaliq Urdu only for large headings on the public Urdu pages, where its beauty matters and its size cost is acceptable. Fonts are self-hosted from the build.

## Consequences

### Positive

- Adding a screen in both languages is the normal path, not extra work; the parity check makes a missing translation a build failure.
- RTL works by construction: a component written with logical utilities mirrors itself.
- Amounts, report codes and dates read the same in both languages and in exports, which matters for traceability.

### Negative

- Every string needs a key and two entries; small copy changes touch two files.
- The logical CSS lint occasionally needs an explicit ignore comment for a genuinely physical case.
- Urdu copy quality depends on a native reader; the checks prove completeness, not fluency.

### Neutral

- Public pages fall back to English content when an Urdu entry is not published, and the content manager marks the missing translation.

## Alternatives considered

- **Translate only the public site.** The brief asks for the whole app.
- **A single shared message file.** Constant merge conflicts between two builders.
- **Urdu (Eastern Arabic) digits.** Natural in prose but error-prone for finance figures copied between screens, exports and spreadsheets.
- **A separate RTL stylesheet or `rtl:` variants everywhere.** Doubles the styling work and drifts; logical properties solve it once.

## Where it lives

- [`src/i18n/routing.ts`](../../src/i18n/routing.ts): locales, prefix and `dirFor`.
- [`src/i18n/request.ts`](../../src/i18n/request.ts): namespaces loaded per request.
- [`src/proxy.ts`](../../src/proxy.ts): locale routing.
- [`src/app/[locale]/layout.tsx`](../../src/app/[locale]/layout.tsx): `lang` and `dir` on the root element.
- [`messages/`](../../messages/): per-module message files.
- [`scripts/check-i18n.mjs`](../../scripts/check-i18n.mjs) and [`scripts/lib/i18n-parity.mjs`](../../scripts/lib/i18n-parity.mjs): parity check.
- [`scripts/check-logical-css.mjs`](../../scripts/check-logical-css.mjs) and [`scripts/lib/logical-css.mjs`](../../scripts/lib/logical-css.mjs): logical CSS lint.
- [`src/platform/i18n/format.ts`](../../src/platform/i18n/format.ts): the shared formatter.
- [`src/app/fonts.ts`](../../src/app/fonts.ts): Latin, Naskh and Nastaliq fonts.
- [`src/components/LanguageSwitcher.tsx`](../../src/components/LanguageSwitcher.tsx): language switch.
- [`src/components/ui/Bidi.tsx`](../../src/components/ui/Bidi.tsx): `<bdi>` wrappers for left-to-right values and user-entered names.
