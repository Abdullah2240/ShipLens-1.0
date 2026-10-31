# Test logins

Every deployment seeds one sample branch and five demo users, one per role, so the
system can be tried end to end on first boot. These are sample data only: the names
are invented and the addresses use the reserved `.test` domain, so no mail is ever
delivered to them.

| Role             | Email                   | Name          | Branch                           |
| ---------------- | ----------------------- | ------------- | -------------------------------- |
| Super Admin      | `admin@shiplens.test`   | Amina Khan    | none (head office, all branches) |
| Finance Reviewer | `finance@shiplens.test` | Bilal Ahmed   | none (head office, all branches) |
| Content Editor   | `editor@shiplens.test`  | Sana Malik    | none (public site content)       |
| Branch Lead      | `lead@shiplens.test`    | Omar Siddiqui | Sample Branch (Demo)             |
| HR Lead          | `hr@shiplens.test`      | Hira Raza     | Sample Branch (Demo)             |

The branch is "Sample Branch (Demo)" in Karachi, status active. Branch Lead and HR Lead
see only that branch's data.

## Password

The password for all five is the value of `SEED_DEMO_PASSWORD` supplied at deploy time;
it is shared with judges through the submission form, never committed.

It must be at least 12 characters. The seed refuses to run without it and never prints it.

## How the accounts are created

On container start `node scripts/migrate.mjs` applies the migrations and then, when
`SEED_ON_BOOT=true`, runs the seed (`db/seed/`). The seed only adds what is missing:
running it again, or against a database that already has data, changes nothing. An
existing user's password is never changed by a normal boot.

## Rotating the demo password

If the deployed `SEED_DEMO_PASSWORD` was wrong, or the password must change:

1. Set `SEED_DEMO_PASSWORD` to the new value and `SEED_ROTATE_DEMO_PASSWORDS=true`.
2. Restart (redeploy) once. The seed re-hashes the password of these five emails only;
   no other account is touched, and each change is recorded in the audit log.
3. Remove `SEED_ROTATE_DEMO_PASSWORDS` (or set it to `false`) so later boots leave the
   passwords alone.

Login is throttled: five failed attempts within 15 minutes lock an email for the rest of
that window.

## Checking a deployment

`scripts/smoke.mjs` logs in as each of these users against any base URL:

```sh
BASE_URL=https://<host> SMOKE_DEMO_PASSWORD=<the deployed password> node scripts/smoke.mjs
```
