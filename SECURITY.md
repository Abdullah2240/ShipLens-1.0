# Security policy

## Reporting a vulnerability

Please report security problems privately by email to
**szahid.bese24seecs@seecs.edu.pk**. Do not open a public GitHub issue, pull request or
discussion for a vulnerability.

Please include:

- What the problem is and what an attacker could do with it.
- Steps to reproduce: the URL or endpoint, the role you were signed in as (if any), the
  request and the response. Use the demo logins in [docs/test-logins.md](docs/test-logins.md);
  never test with real people's data.
- The commit or deployed version you tested, if you know it.
- Whether you want to be credited, and how.

A seal on a verified report that no longer matches, or an "audit chain broken" result on
the public check page, is also worth reporting the same way.

## What to expect

- We confirm we received your report within 3 working days.
- We send a first assessment (accepted or not, and how severe) within 10 working days.
- We keep you updated until it is fixed, and agree with you when it can be disclosed.
  Please give us a reasonable time to fix it before you publish anything.

This is a small volunteer-built project, so these are goals rather than guarantees.

## Scope

In scope:

- The live demo deployment on Render.
- The code in this repository: application, database migrations, Docker image, CI
  workflows and scripts.

Out of scope:

- Denial of service and load testing against the live demo (it runs on a free instance).
- Social engineering, physical attacks, and attacks on Render or GitHub themselves.
- Findings that need a compromised device or browser, or only affect outdated browsers.
- Missing best-practice headers or settings with no demonstrated impact (we still welcome
  them as normal issues).

When testing, use only the demo accounts, do not change or delete other people's data,
and stop and report as soon as you can show the problem.

## How ShipLens is secured

The OWASP Top 10 mapping, security headers, secret handling, dependency policy and known
residual risks are in [docs/security.md](docs/security.md). The tamper-evident audit chain
and public report verification are explained in [docs/verification.md](docs/verification.md).
