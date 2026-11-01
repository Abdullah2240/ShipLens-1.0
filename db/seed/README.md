# Seed

Creates the data a fresh deployment needs to be usable: one sample branch and the five
demo role users. It runs on container start after the migrations when `SEED_ON_BOOT=true`
(`node scripts/migrate.mjs`), or directly from code with `runSeed()`.

```js
import { runSeed } from './db/seed/index.mjs';
await runSeed({ connectionString, env: process.env, log: console.log }); // -> { steps: [...] }
```

## Rules

- **Idempotent.** Running the seed again, or against a database that already has other
  data, changes nothing. Look a row up first and insert only when it is missing; use
  `INSERT ... ON CONFLICT DO NOTHING` as a second safety net.
- **Never removes data.** No truncation and no row removal, ever. Do not update rows the
  current run did not insert (the only exception is the password rotation below).
- **One transaction.** All steps of a run share one transaction. A step that throws rolls
  back everything the run wrote, so a container never starts half-seeded.
- **Serialised.** The runner holds the session advisory lock `727275` (the migrator uses
  `727274`), so concurrent boots seed once.
- **Allowed imports.** Node built-ins, `pg`, files under `db/seed/`, and
  `scripts/lib/password.mjs`. Nothing else exists in the runtime image; in particular
  nothing from `src/` (TypeScript is not compiled there).
- **Sample data only.** Invented names, `.test` email addresses, no real people.
- Audit: every row a step creates gets an `audit_events` row with `actor_role = 'system'`,
  `actor_id` NULL, and only fields allowed by `src/platform/audit/allowlist.ts` in
  `after` (never a password hash or contact details).

## Step contract

Steps are the `*.mjs` files in `db/seed/steps/`, run in filename order.

```js
export const name = '01-demo-branch-and-users';
/** @param client pg client inside the seed transaction
 *  @param ctx { env, log, hashPassword } */
export async function run(client, ctx) {}
```

| Step                           | Adds                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `01-demo-branch-and-users.mjs` | Branch "Sample Branch (Demo)" (Karachi, active, code from `branch_code_seq`) and the five users in `demo-users.mjs` |
| `02-*.mjs` and later           | Reserved for the generated fictional demo dataset and later additions                                               |

`demo-users.mjs` is the single definition of the five demo logins. `docs/test-logins.md`,
`scripts/smoke.mjs` and the end-to-end role fixtures use the same emails, names and roles.

## Environment variables

| Variable                     | Meaning                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEED_ON_BOOT`               | `true` makes `scripts/migrate.mjs` run the seed after migrating. Any other value skips it without loading seed code.                         |
| `SEED_DEMO_PASSWORD`         | Password for the demo users, at least 12 characters. Required; the seed refuses to run without it. Never committed and never logged.         |
| `SEED_ROTATE_DEMO_PASSWORDS` | `true` re-hashes the password of the five demo emails (only those) to the current `SEED_DEMO_PASSWORD`. Set it for one boot, then remove it. |
