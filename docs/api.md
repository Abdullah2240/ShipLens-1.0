# API

The ShipLens HTTP API serves the staff screens and the public site. This page has two
parts: hand-written conventions that hold for every endpoint, and a generated reference
(inventory table plus one section per endpoint) built from the route files, the
permission table (`src/platform/authz/permissions.ts`) and the endpoint access registry
(`tests/http/registry`). Regenerate it with `node scripts/gen-api-doc.mjs`; CI runs
`node scripts/gen-api-doc.mjs --check`, which fails when a route is added, removed or
changed without regenerating, when an endpoint has no section, or when a route names an
action that the permission table does not define.

## Overview

- Base path: `/api/v1`. Health checks live outside it at `/api/health` and
  `/api/health/db`.
- JSON in, JSON out, except the CSV export (`GET /api/v1/exports/{kind}`, see
  [CSV exports](#csv-exports)). Request bodies must be sent with
  `Content-Type: application/json` and are limited to 64 KiB.
- Same origin only. The browser app and the API share one origin; there is no CORS.
- Every response carries `X-Request-Id` (an incoming `X-Request-Id` made of letters,
  digits, `_` and `-`, at most 64 characters, is reused) and `X-Content-Type-Options: nosniff`.
  API responses also carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
  and the site-wide security headers ([security.md](security.md#security-headers)).

## Authentication

- Sign in with `POST /api/v1/auth/login` and an email and password. On success the
  response sets the session cookie and returns the user.
- The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`. Over HTTPS it is named
  `__Host-shiplens_session` and is `Secure`; in local development over plain HTTP it is
  `shiplens_session`.
- Sessions expire after 12 hours idle and 7 days at most. `POST /api/v1/auth/logout` ends
  the session and clears the cookie.
- Role and branch always come from the server-side session. A body or query field such
  as `role` or `branchId` never widens what a user can do; login rejects unknown keys.

Example, using a demo login from [test-logins.md](test-logins.md):

```http
POST /api/v1/auth/login
Origin: http://localhost:3000
Content-Type: application/json

{ "email": "finance@shiplens.test", "password": "<demo password>" }
```

```http
HTTP/1.1 200
Set-Cookie: shiplens_session=<token>; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax

{ "user": { "id": "00000000-0000-4000-8000-000000000101", "email": "finance@shiplens.test", "name": "Bilal Ahmed", "role": "finance_reviewer", "branchId": null } }
```

## CSRF and the Origin rule

`POST`, `PUT`, `PATCH` and `DELETE` must carry an `Origin` header exactly equal to the
configured app origin (scheme, host and port). A missing or different `Origin` is refused
with 403 before the session is read. Together with `SameSite=Lax` this blocks cross-site
form posts and scripted requests from other sites. `GET` never changes state.

## Errors

Every error has one body shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "Not found",
    "details": {},
    "requestId": "7c1d2f0e-9b9a-4a51-8a1e-3a6c2f4b9d10"
  }
}
```

`message` is a short fixed English string; clients localise from `code`. `details` is
present only where noted below. Internal errors never include stack traces, SQL or host
names.

| Status | Code                          | When                                                                                  |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------- |
| 401    | `unauthenticated`             | No valid session on a session endpoint.                                               |
| 403    | `forbidden`                   | The role lacks the action, or a mutation failed the Origin rule.                      |
| 404    | `not_found`                   | The record does not exist, or exists outside the caller's scope (see below).          |
| 409    | a state code                  | The record is in the wrong state for the request, e.g. a locked or submitted report.  |
| 422    | `validation_failed`           | The body or query failed validation; `details.fields` lists each problem.             |
| 429    | `rate_limited`                | Too many attempts; `Retry-After` header and `details.retryAfterSeconds` say how long. |
| 500    | `internal_error`              | Anything unexpected. The `requestId` ties the response to the server log.             |

### Identical 404

A branch-scoped user asking for another branch's record gets exactly the same 404 body
as for a record that does not exist. The response never reveals whether the id is real.

## Validation

Bodies and queries are validated with Zod schemas (the schema name is listed per
endpoint). Objects are strict: unknown keys are refused. Failures answer 422 with field
codes, sorted by path, and never echo the submitted value:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Validation failed",
    "details": { "fields": [{ "path": "amount", "code": "invalid_money", "message": "invalid_money" }] },
    "requestId": "7c1d2f0e-9b9a-4a51-8a1e-3a6c2f4b9d10"
  }
}
```

Other body-level codes: `invalid_content_type`, `invalid_json`, `payload_too_large`.

## Pagination

Paged list endpoints take `page` (from 1) and `pageSize` (default 25, at most 100) as
query parameters and answer:

```json
{ "data": { "items": [], "total": 0, "page": 1, "pageSize": 25 } }
```

## Rate limits

- Login: 5 failed attempts per email or 20 per IP address within 15 minutes answer 429.
  Unknown email and wrong password give the same response, so the endpoint does not
  reveal which accounts exist.
- Public membership application: 5 submissions per IP address per hour.
- Public report verification (`GET /api/v1/public/verify/{code}`): 30 lookups per IP address
  per minute, shared with the `/{locale}/verify/{code}` page. Malformed codes count too.
- Rate-limited responses carry `Retry-After` in seconds.
- The login limit is stored in the database. The application and verification limits are
  kept in memory per server process (one instance on the free plan), so a restart resets
  them. The IP address is the first `X-Forwarded-For` entry.

## Caching

Every API response sends `Cache-Control: no-store`. Nothing under `/api` is cached by the
browser or a proxy.

## Response envelope

Successful responses wrap the result in `data`, for example `{ "data": { ... } }`. The
auth endpoints answer `{ "user": ... }`, the public application form answers
`{ "ok": true }`, logout answers 204 with no body, and the health checks answer
`{ "status": "ok" }` (plus `"db": "up"` for the readiness check, or 503 with
`"db": "down"`).

## CSV exports

`GET /api/v1/exports/{kind}` (`kind` is `summary`, `reports`, `collections` or `unrouted`)
answers `200` with `Content-Type: text/csv; charset=utf-8` and
`Content-Disposition: attachment; filename="..."`: UTF-8 with a byte order mark, CRLF line
ends, and every text cell that a spreadsheet could read as a formula prefixed so it stays
text. It takes the dashboard filters plus `figure`, `reportId` and `locale` (`en` or `ur`
for the column headings). A download started by another site (`Sec-Fetch-Site` other than
`same-origin` or `none`) is refused with 403. Each export writes one `export.create` audit
event holding only the kind and the row count; the file is sent only after that event is
stored.

## Report verification

The twist endpoints ("Proof, not promises", [verification.md](verification.md)):

- `GET /api/v1/public/verify/{code}[?s=<seal>]`, public. `code` may be typed in any case,
  with or without the hyphen. The answer is the public projection only:

  ```json
  {
    "data": {
      "code": "7KQ2M-X9D4P",
      "branch": { "name": "Islamabad North (Demo)", "city": "Islamabad" },
      "weekStart": "2026-08-10",
      "weekEnd": "2026-08-16",
      "approvedTotal": "65500.00",
      "collectionCount": 3,
      "approvedOn": "2026-08-18",
      "integrity": "verified",
      "anchor": { "chainSeq": 412, "seal": "0123456789abcdef" },
      "sealCheck": "match",
      "chain": { "status": "intact", "checkedEvents": 512, "brokenAtSeq": null, "checkedAt": "2026-11-01T04:00:00.000Z" }
    }
  }
  ```

  `integrity` is `verified`, `mismatch`, `unanchored` or `chain_broken`; `sealCheck` is
  `match`, `mismatch` or `not_provided`. Unknown, malformed and not yet approved codes are
  the same 404. No names, contact details or individual collections are ever included.
- `GET /api/v1/reports/{id}/verification`, action `report.read` (scoped): the code, the
  locale-free public path and the seal of an approved report,
  `{ "data": { "code": "7KQ2M-X9D4P", "path": "/verify/7KQ2M-X9D4P?s=0123456789abcdef", "seal": "0123456789abcdef" } }`.
  A report that is not approved is the identical 404.
- `GET /api/v1/audit/chain[?fresh=1]`, action `audit.read_finance`: the audit chain
  status, `intact` (with `checkedEvents` and the head event), `broken` (with `brokenAt`:
  event number, event id and reason `sequence_gap`, `hash_mismatch` or `link_mismatch`) or
  `empty`, plus `checkedAt`. Cached for 60 seconds; `?fresh=1` walks the whole chain again.
- `POST /api/v1/reports/{id}/share` returns the share text and a `summary`; for an approved
  report `summary.verifyUrl` is the absolute public verification link (otherwise `null`).

## Endpoint inventory

<!-- api-inventory:start -->
Generated from the route files by `node scripts/gen-api-doc.mjs`. Do not edit between the markers.

| Method | Path | Auth | Action | Roles (scope) | Request body |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/health` | public | - | anyone | - |
| GET | `/api/health/db` | public | - | anyone | - |
| GET | `/api/v1/applications` | session | `application.read` | super_admin (all), hr_lead (own branch) | - |
| GET | `/api/v1/applications/{id}` | session | `application.read` | super_admin (all), hr_lead (own branch) | - |
| POST | `/api/v1/applications/{id}/accept` | session | `application.decide` | hr_lead (own branch), super_admin (all) | - |
| POST | `/api/v1/applications/{id}/decline` | session | `application.decide` | hr_lead (own branch), super_admin (all) | `declineInputSchema` |
| GET | `/api/v1/audit` | session | `audit.read_finance` | finance_reviewer (all), super_admin (all) | - |
| GET | `/api/v1/audit/chain` | session | `audit.read_finance` | finance_reviewer (all), super_admin (all) | - |
| GET | `/api/v1/audit/facets` | session | `audit.read_finance` | finance_reviewer (all), super_admin (all) | - |
| POST | `/api/v1/auth/login` | public | - | anyone | `loginSchema` |
| POST | `/api/v1/auth/logout` | session | - | any signed-in role | - |
| GET | `/api/v1/auth/me` | session | - | any signed-in role | - |
| GET | `/api/v1/branches` | session | `branch.read` | super_admin (all), finance_reviewer (all), branch_lead (own branch), hr_lead (own branch) | - |
| POST | `/api/v1/branches` | session | `branch.create` | super_admin (all) | `branchCreateSchema` |
| GET | `/api/v1/branches/lead-candidates` | session | `user.read` | super_admin (all) | - |
| GET | `/api/v1/branches/{id}` | session | `branch.read` | super_admin (all), finance_reviewer (all), branch_lead (own branch), hr_lead (own branch) | - |
| PATCH | `/api/v1/branches/{id}` | session | `branch.update` | super_admin (all) | `branchPatchSchema` |
| POST | `/api/v1/branches/{id}/leads` | session | `branch.assign_leads` | super_admin (all) | `assignLeadSchema` |
| POST | `/api/v1/branches/{id}/status` | session | `branch.transition` | super_admin (all) | `branchTransitionSchema` |
| GET | `/api/v1/collections` | session | `collection.read` | super_admin (all), finance_reviewer (all), branch_lead (own branch) | - |
| POST | `/api/v1/collections` | session | `collection.create` | branch_lead (own branch) | `collectionInputSchema` |
| GET | `/api/v1/collections/current-week` | session | `collection.create` | branch_lead (own branch) | - |
| GET | `/api/v1/collections/{id}` | session | `collection.read` | super_admin (all), finance_reviewer (all), branch_lead (own branch) | - |
| PATCH | `/api/v1/collections/{id}` | session | `collection.amend` | branch_lead (own branch) | `collectionPatchSchema` |
| POST | `/api/v1/collections/{id}/routed` | session | `collection.mark_routed` | finance_reviewer (all), super_admin (all) | - |
| DELETE | `/api/v1/collections/{id}/routed` | session | `collection.unmark_routed` | finance_reviewer (all), super_admin (all) | - |
| GET | `/api/v1/collections/{id}/timeline` | session | `audit.read_timeline` | super_admin (all), finance_reviewer (all), branch_lead (own branch) | - |
| POST | `/api/v1/collections/{id}/void` | session | `collection.void` | branch_lead (own branch) | `voidInputSchema` |
| GET | `/api/v1/content/entries` | session | `content.read` | content_editor (all), super_admin (all) | - |
| GET | `/api/v1/content/entries/{key}/{locale}` | session | `content.read` | content_editor (all), super_admin (all) | - |
| PUT | `/api/v1/content/entries/{key}/{locale}` | session | `content.edit` | content_editor (all), super_admin (all) | `draftInputSchema` |
| GET | `/api/v1/content/entries/{key}/{locale}/preview` | session | `content.preview` | content_editor (all), super_admin (all) | - |
| POST | `/api/v1/content/entries/{key}/{locale}/publish` | session | `content.publish` | content_editor (all), super_admin (all) | - |
| POST | `/api/v1/content/entries/{key}/{locale}/unpublish` | session | `content.unpublish` | content_editor (all), super_admin (all) | - |
| GET | `/api/v1/content/events` | session | `content.read` | content_editor (all), super_admin (all) | - |
| POST | `/api/v1/content/events` | session | `content.edit` | content_editor (all), super_admin (all) | `eventInputSchema` |
| GET | `/api/v1/content/events/{id}` | session | `content.read` | content_editor (all), super_admin (all) | - |
| PATCH | `/api/v1/content/events/{id}` | session | `content.edit` | content_editor (all), super_admin (all) | `eventPatchSchema` |
| POST | `/api/v1/content/events/{id}/publish` | session | `content.publish` | content_editor (all), super_admin (all) | - |
| POST | `/api/v1/content/events/{id}/unpublish` | session | `content.unpublish` | content_editor (all), super_admin (all) | - |
| GET | `/api/v1/dashboard/routed` | session | `dashboard.read` | super_admin (all), finance_reviewer (all) | - |
| GET | `/api/v1/dashboard/summary` | session | `dashboard.read` | super_admin (all), finance_reviewer (all) | - |
| GET | `/api/v1/dashboard/trend` | session | `dashboard.read` | super_admin (all), finance_reviewer (all) | - |
| GET | `/api/v1/dashboard/unrouted` | session | `dashboard.read` | super_admin (all), finance_reviewer (all) | - |
| POST | `/api/v1/exports/print` | session | `export.create` | super_admin (all), finance_reviewer (all) | `printBodySchema` |
| GET | `/api/v1/exports/{kind}` | session | `export.create` | super_admin (all), finance_reviewer (all) | - |
| GET | `/api/v1/members` | session | `member.read` | super_admin (all), hr_lead (own branch), branch_lead (own branch) | - |
| GET | `/api/v1/members/{id}` | session | `member.read` | super_admin (all), hr_lead (own branch), branch_lead (own branch) | - |
| PATCH | `/api/v1/members/{id}` | session | `member.update` | super_admin (all), hr_lead (own branch) | `memberPatchSchema` |
| POST | `/api/v1/public/applications` | public | - | anyone | `applicationInputSchema` |
| GET | `/api/v1/public/impact` | public | - | anyone | - |
| GET | `/api/v1/public/verify/{code}` | public | - | anyone | - |
| GET | `/api/v1/reports` | session | `report.read` | super_admin (all), finance_reviewer (all), branch_lead (own branch) | - |
| GET | `/api/v1/reports/review-queue` | session | `report.approve` | finance_reviewer (all) | - |
| GET | `/api/v1/reports/{id}` | session | `report.read` | super_admin (all), finance_reviewer (all), branch_lead (own branch) | - |
| POST | `/api/v1/reports/{id}/approve` | session | `report.approve` | finance_reviewer (all) | - |
| POST | `/api/v1/reports/{id}/return` | session | `report.return` | finance_reviewer (all) | `returnInputSchema` |
| POST | `/api/v1/reports/{id}/share` | session | `report.share` | branch_lead (own branch) | `shareInputSchema` |
| POST | `/api/v1/reports/{id}/submit` | session | `report.submit` | branch_lead (own branch) | `submitInputSchema` |
| GET | `/api/v1/reports/{id}/timeline` | session | `audit.read_timeline` | super_admin (all), finance_reviewer (all), branch_lead (own branch) | - |
| GET | `/api/v1/reports/{id}/verification` | session | `report.read` | super_admin (all), finance_reviewer (all), branch_lead (own branch) | - |
| GET | `/api/v1/teams` | session | `team.read` | super_admin (all), hr_lead (own branch), branch_lead (own branch) | - |
| POST | `/api/v1/teams` | session | `team.manage` | super_admin (all), hr_lead (own branch) | `teamInputSchema` |
| PATCH | `/api/v1/teams/{id}` | session | `team.manage` | super_admin (all), hr_lead (own branch) | `renameInputSchema` |
| GET | `/api/v1/trace/{slug}` | session | `trace.read` | super_admin (all), finance_reviewer (all) | - |
| GET | `/api/v1/trace/{slug}/branches/{branchId}` | session | `trace.read` | super_admin (all), finance_reviewer (all) | - |
| GET | `/api/v1/trace/{slug}/branches/{branchId}/reports/{reportId}` | session | `trace.read` | super_admin (all), finance_reviewer (all) | - |
| GET | `/api/v1/trace/{slug}/branches/{branchId}/reports/{reportId}/collections/{collectionId}` | session | `trace.read` | super_admin (all), finance_reviewer (all) | - |

Endpoints that need no session:

- GET `/api/health`
- GET `/api/health/db`
- POST `/api/v1/auth/login`
- POST `/api/v1/public/applications`
- GET `/api/v1/public/impact`
- GET `/api/v1/public/verify/{code}`
<!-- api-inventory:end -->

## Endpoint reference

Each section lists access, roles and their scope, parameters, the request schema, the
service the route calls, the statuses it can return, its entry in the access registry
(which runs the role and cross-branch checks against it), and an example. Example ids and
values are made up; `<...>` marks a placeholder.

<!-- api-endpoints:start -->
Generated from the route files by `node scripts/gen-api-doc.mjs`. Do not edit between the markers.

### GET /api/health

- Access: public, no session.
- Request body: none.
- Success status: 200.
- Access matrix: not in the endpoint registry.
- Source: `src/app/api/health/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/health"
```

```http
HTTP/1.1 200

(JSON written directly by the handler in src/app/api/health/route.ts)
```

### GET /api/health/db

- Access: public, no session.
- Request body: none.
- Success status: 200.
- Access matrix: not in the endpoint registry.
- Source: `src/app/api/health/db/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/health/db"
```

```http
HTTP/1.1 200

(JSON written directly by the handler in src/app/api/health/db/route.ts)
```

### GET /api/v1/applications

- Access: session, action `application.read`.
- Roles (scope): super_admin (all), hr_lead (own branch).
- Request body: none.
- Calls: `listApplications` (`@/modules/applications`), `parseApplicationListQuery` (`@/modules/applications`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `applications.list`.
- Source: `src/app/api/v1/applications/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/applications" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listApplications>" }
```

### GET /api/v1/applications/{id}

- Access: session, action `application.read`.
- Roles (scope): super_admin (all), hr_lead (own branch).
- Path parameters: `id`.
- Request body: none.
- Calls: `getApplication` (`@/modules/applications`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `applications.get`.
- Source: `src/app/api/v1/applications/[id]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/applications/00000000-0000-4000-8000-000000000001" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getApplication>" }
```

### POST /api/v1/applications/{id}/accept

- Access: session, action `application.decide`.
- Roles (scope): hr_lead (own branch), super_admin (all).
- Path parameters: `id`.
- Request body: none.
- Calls: `acceptApplication` (`@/modules/applications`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404.
- Access matrix: registry id `applications.accept`.
- Source: `src/app/api/v1/applications/[id]/accept/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/applications/00000000-0000-4000-8000-000000000001/accept" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from acceptApplication>" }
```

### POST /api/v1/applications/{id}/decline

- Access: session, action `application.decide`.
- Roles (scope): hr_lead (own branch), super_admin (all).
- Path parameters: `id`.
- Request body: `declineInputSchema`; fields `note`.
- Calls: `declineApplication` (`@/modules/applications`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `applications.decline`.
- Source: `src/app/api/v1/applications/[id]/decline/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/applications/00000000-0000-4000-8000-000000000001/decline" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"note":"<note>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from declineApplication>" }
```

### GET /api/v1/audit

- Access: session, action `audit.read_finance`.
- Roles (scope): finance_reviewer (all), super_admin (all).
- Request body: none.
- Calls: `listAuditEvents` (`@/modules/audit-log`), `parseAuditQuery` (`@/modules/audit-log`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `audit.list`.
- Source: `src/app/api/v1/audit/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/audit" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listAuditEvents>" }
```

### GET /api/v1/audit/chain

- Access: session, action `audit.read_finance`.
- Roles (scope): finance_reviewer (all), super_admin (all).
- Request body: none.
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `audit.chain`.
- Source: `src/app/api/v1/audit/chain/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/audit/chain" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<value>" }
```

### GET /api/v1/audit/facets

- Access: session, action `audit.read_finance`.
- Roles (scope): finance_reviewer (all), super_admin (all).
- Request body: none.
- Calls: `getAuditFacets` (`@/modules/audit-log`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `audit.facets`.
- Source: `src/app/api/v1/audit/facets/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/audit/facets" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getAuditFacets>" }
```

### POST /api/v1/auth/login

- Access: public, no session.
- Request body: `loginSchema`; fields `email`, `password`.
- Calls: `login` (`@/modules/auth`), `serializeSessionCookie` (`@/modules/auth`).
- Success status: 200. Error statuses: 403 (Origin), 422.
- Access matrix: registry id `auth.login`.
- Source: `src/app/api/v1/auth/login/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/auth/login" \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<password>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "user": "<from login>" }
```

### POST /api/v1/auth/logout

- Access: session, any signed-in role.
- Request body: none.
- Calls: `clearSessionCookie` (`@/modules/auth`), `logout` (`@/modules/auth`), `readSessionToken` (`@/modules/auth`).
- Success status: 204. Error statuses: 403 (Origin), 401.
- Access matrix: registry id `auth.logout`.
- Source: `src/app/api/v1/auth/logout/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/auth/logout" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 204
```

### GET /api/v1/auth/me

- Access: session, any signed-in role.
- Request body: none.
- Success status: 200. Error statuses: 401.
- Access matrix: registry id `auth.me`.
- Source: `src/app/api/v1/auth/me/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/auth/me" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "user": "<value>" }
```

### GET /api/v1/branches

- Access: session, action `branch.read`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch), hr_lead (own branch).
- Query schema: `branchListQuerySchema`.
- Request body: none.
- Calls: `listBranches` (`@/modules/branches`).
- Success status: 200. Error statuses: 401, 403, 422.
- Access matrix: registry id `branches.list`.
- Source: `src/app/api/v1/branches/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/branches" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listBranches>" }
```

### POST /api/v1/branches

- Access: session, action `branch.create`.
- Roles (scope): super_admin (all).
- Request body: `branchCreateSchema`; fields `name`, `city`, `summary`.
- Calls: `createBranch` (`@/modules/branches`).
- Success status: 201. Error statuses: 403 (Origin), 401, 403, 422.
- Access matrix: registry id `branches.create`.
- Source: `src/app/api/v1/branches/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/branches" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<name>","city":"<city>","summary":"<summary>"}'
```

```http
HTTP/1.1 201
Content-Type: application/json

{ "data": "<from createBranch>" }
```

### GET /api/v1/branches/lead-candidates

- Access: session, action `user.read`.
- Roles (scope): super_admin (all).
- Request body: none.
- Calls: `listLeadCandidates` (`@/modules/branches`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `branches.lead_candidates`.
- Source: `src/app/api/v1/branches/lead-candidates/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/branches/lead-candidates" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listLeadCandidates>" }
```

### GET /api/v1/branches/{id}

- Access: session, action `branch.read`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch), hr_lead (own branch).
- Path parameters: `id`.
- Request body: none.
- Calls: `getBranch` (`@/modules/branches`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `branches.get`.
- Source: `src/app/api/v1/branches/[id]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/branches/00000000-0000-4000-8000-000000000001" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getBranch>" }
```

### PATCH /api/v1/branches/{id}

- Access: session, action `branch.update`.
- Roles (scope): super_admin (all).
- Path parameters: `id`.
- Request body: `branchPatchSchema`; fields `name`, `city`, `summary`.
- Calls: `updateBranch` (`@/modules/branches`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `branches.update`.
- Source: `src/app/api/v1/branches/[id]/route.ts`.

```sh
curl -X PATCH "http://localhost:3000/api/v1/branches/00000000-0000-4000-8000-000000000001" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<name>","city":"<city>","summary":"<summary>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from updateBranch>" }
```

### POST /api/v1/branches/{id}/leads

- Access: session, action `branch.assign_leads`.
- Roles (scope): super_admin (all).
- Path parameters: `id`.
- Request body: `assignLeadSchema`; fields `userId`.
- Calls: `assignLead` (`@/modules/branches`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `branches.assign_lead`.
- Source: `src/app/api/v1/branches/[id]/leads/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/branches/00000000-0000-4000-8000-000000000001/leads" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<userId>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from assignLead>" }
```

### POST /api/v1/branches/{id}/status

- Access: session, action `branch.transition`.
- Roles (scope): super_admin (all).
- Path parameters: `id`.
- Request body: `branchTransitionSchema`; fields `to`.
- Calls: `transitionBranch` (`@/modules/branches`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `branches.transition`.
- Source: `src/app/api/v1/branches/[id]/status/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/branches/00000000-0000-4000-8000-000000000001/status" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"to":"<to>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from transitionBranch>" }
```

### GET /api/v1/collections

- Access: session, action `collection.read`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch).
- Request body: none.
- Calls: `listCollections` (`@/modules/collections`), `parseCollectionQuery` (`@/modules/collections`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `collections.list`.
- Source: `src/app/api/v1/collections/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/collections" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listCollections>" }
```

### POST /api/v1/collections

- Access: session, action `collection.create`.
- Roles (scope): branch_lead (own branch).
- Request body: `collectionInputSchema`; fields `amount`, `collectedOn`, `purpose`, `note`.
- Calls: `createCollection` (`@/modules/collections`).
- Success status: 201. Error statuses: 403 (Origin), 401, 403, 422.
- Access matrix: registry id `collections.create`.
- Source: `src/app/api/v1/collections/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/collections" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":"<amount>","collectedOn":"<collectedOn>","purpose":"<purpose>","note":"<note>"}'
```

```http
HTTP/1.1 201
Content-Type: application/json

{ "data": "<from createCollection>" }
```

### GET /api/v1/collections/current-week

- Access: session, action `collection.create`.
- Roles (scope): branch_lead (own branch).
- Request body: none.
- Calls: `getCurrentWeek` (`@/modules/collections`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `collections.current_week`.
- Source: `src/app/api/v1/collections/current-week/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/collections/current-week" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getCurrentWeek>" }
```

### GET /api/v1/collections/{id}

- Access: session, action `collection.read`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch).
- Path parameters: `id`.
- Request body: none.
- Calls: `getCollection` (`@/modules/collections`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `collections.get`.
- Source: `src/app/api/v1/collections/[id]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/collections/00000000-0000-4000-8000-000000000001" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getCollection>" }
```

### PATCH /api/v1/collections/{id}

- Access: session, action `collection.amend`.
- Roles (scope): branch_lead (own branch).
- Path parameters: `id`.
- Request body: `collectionPatchSchema`; fields `amount`, `collectedOn`, `purpose`, `note`.
- Calls: `amendCollection` (`@/modules/collections`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `collections.amend`.
- Source: `src/app/api/v1/collections/[id]/route.ts`.

```sh
curl -X PATCH "http://localhost:3000/api/v1/collections/00000000-0000-4000-8000-000000000001" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":"<amount>","collectedOn":"<collectedOn>","purpose":"<purpose>","note":"<note>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from amendCollection>" }
```

### POST /api/v1/collections/{id}/routed

- Access: session, action `collection.mark_routed`.
- Roles (scope): finance_reviewer (all), super_admin (all).
- Path parameters: `id`.
- Request body: none.
- Calls: `markCollectionRouted` (`@/modules/collections`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404.
- Access matrix: registry id `collections.mark_routed`.
- Source: `src/app/api/v1/collections/[id]/routed/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/collections/00000000-0000-4000-8000-000000000001/routed" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from markCollectionRouted>" }
```

### DELETE /api/v1/collections/{id}/routed

- Access: session, action `collection.unmark_routed`.
- Roles (scope): finance_reviewer (all), super_admin (all).
- Path parameters: `id`.
- Request body: none.
- Calls: `unmarkCollectionRouted` (`@/modules/collections`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404.
- Access matrix: registry id `collections.unmark_routed`.
- Source: `src/app/api/v1/collections/[id]/routed/route.ts`.

```sh
curl -X DELETE "http://localhost:3000/api/v1/collections/00000000-0000-4000-8000-000000000001/routed" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from unmarkCollectionRouted>" }
```

### GET /api/v1/collections/{id}/timeline

- Access: session, action `audit.read_timeline`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch).
- Path parameters: `id`.
- Request body: none.
- Calls: `getCollectionTimeline` (`@/modules/timeline`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `collections.timeline`.
- Source: `src/app/api/v1/collections/[id]/timeline/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/collections/00000000-0000-4000-8000-000000000001/timeline" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getCollectionTimeline>" }
```

### POST /api/v1/collections/{id}/void

- Access: session, action `collection.void`.
- Roles (scope): branch_lead (own branch).
- Path parameters: `id`.
- Request body: `voidInputSchema`; fields `reason`.
- Calls: `voidCollection` (`@/modules/collections`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `collections.void`.
- Source: `src/app/api/v1/collections/[id]/void/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/collections/00000000-0000-4000-8000-000000000001/void" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"<reason>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from voidCollection>" }
```

### GET /api/v1/content/entries

- Access: session, action `content.read`.
- Roles (scope): content_editor (all), super_admin (all).
- Request body: none.
- Calls: `listEntries` (`@/modules/content`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `content.entries.list`.
- Source: `src/app/api/v1/content/entries/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/content/entries" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listEntries>" }
```

### GET /api/v1/content/entries/{key}/{locale}

- Access: session, action `content.read`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `key`, `locale`.
- Request body: none.
- Calls: `getEntry` (`@/modules/content`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `content.entries.get`.
- Source: `src/app/api/v1/content/entries/[key]/[locale]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/content/entries/example-key/en" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getEntry>" }
```

### PUT /api/v1/content/entries/{key}/{locale}

- Access: session, action `content.edit`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `key`, `locale`.
- Request body: `draftInputSchema`; fields `title`, `body`.
- Calls: `saveDraft` (`@/modules/content`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `content.entries.save_draft`.
- Source: `src/app/api/v1/content/entries/[key]/[locale]/route.ts`.

```sh
curl -X PUT "http://localhost:3000/api/v1/content/entries/example-key/en" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"<title>","body":"<body>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from saveDraft>" }
```

### GET /api/v1/content/entries/{key}/{locale}/preview

- Access: session, action `content.preview`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `key`, `locale`.
- Request body: none.
- Calls: `previewEntry` (`@/modules/content`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `content.entries.preview`.
- Source: `src/app/api/v1/content/entries/[key]/[locale]/preview/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/content/entries/example-key/en/preview" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from previewEntry>" }
```

### POST /api/v1/content/entries/{key}/{locale}/publish

- Access: session, action `content.publish`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `key`, `locale`.
- Request body: none.
- Calls: `publishEntry` (`@/modules/content`), `revalidatePublicPages` (`@/modules/content`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404.
- Access matrix: registry id `content.entries.publish`.
- Source: `src/app/api/v1/content/entries/[key]/[locale]/publish/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/content/entries/example-key/en/publish" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from publishEntry>" }
```

### POST /api/v1/content/entries/{key}/{locale}/unpublish

- Access: session, action `content.unpublish`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `key`, `locale`.
- Request body: none.
- Calls: `revalidatePublicPages` (`@/modules/content`), `unpublishEntry` (`@/modules/content`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404.
- Access matrix: registry id `content.entries.unpublish`.
- Source: `src/app/api/v1/content/entries/[key]/[locale]/unpublish/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/content/entries/example-key/en/unpublish" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from unpublishEntry>" }
```

### GET /api/v1/content/events

- Access: session, action `content.read`.
- Roles (scope): content_editor (all), super_admin (all).
- Request body: none.
- Calls: `listEvents` (`@/modules/content`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `content.events.list`.
- Source: `src/app/api/v1/content/events/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/content/events" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listEvents>" }
```

### POST /api/v1/content/events

- Access: session, action `content.edit`.
- Roles (scope): content_editor (all), super_admin (all).
- Request body: `eventInputSchema`; fields `titleEn`, `titleUr`, `summaryEn`, `summaryUr`, `location`, `startsAt`, `endsAt`, `branchId`.
- Calls: `createEvent` (`@/modules/content`).
- Success status: 201. Error statuses: 403 (Origin), 401, 403, 422.
- Access matrix: registry id `content.events.create`.
- Source: `src/app/api/v1/content/events/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/content/events" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"titleEn":"<titleEn>","titleUr":"<titleUr>","summaryEn":"<summaryEn>","summaryUr":"<summaryUr>","location":"<location>","startsAt":"<startsAt>","endsAt":"<endsAt>","branchId":"<branchId>"}'
```

```http
HTTP/1.1 201
Content-Type: application/json

{ "data": "<from createEvent>" }
```

### GET /api/v1/content/events/{id}

- Access: session, action `content.read`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `id`.
- Request body: none.
- Calls: `getEvent` (`@/modules/content`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `content.events.get`.
- Source: `src/app/api/v1/content/events/[id]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/content/events/00000000-0000-4000-8000-000000000001" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getEvent>" }
```

### PATCH /api/v1/content/events/{id}

- Access: session, action `content.edit`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `id`.
- Request body: `eventPatchSchema`; fields `titleEn`, `titleUr`, `summaryEn`, `summaryUr`, `location`, `startsAt`, `endsAt`, `branchId`.
- Calls: `updateEvent` (`@/modules/content`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `content.events.update`.
- Source: `src/app/api/v1/content/events/[id]/route.ts`.

```sh
curl -X PATCH "http://localhost:3000/api/v1/content/events/00000000-0000-4000-8000-000000000001" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"titleEn":"<titleEn>","titleUr":"<titleUr>","summaryEn":"<summaryEn>","summaryUr":"<summaryUr>","location":"<location>","startsAt":"<startsAt>","endsAt":"<endsAt>","branchId":"<branchId>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from updateEvent>" }
```

### POST /api/v1/content/events/{id}/publish

- Access: session, action `content.publish`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `id`.
- Request body: none.
- Calls: `publishEvent` (`@/modules/content`), `revalidatePublicPages` (`@/modules/content`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404.
- Access matrix: registry id `content.events.publish`.
- Source: `src/app/api/v1/content/events/[id]/publish/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/content/events/00000000-0000-4000-8000-000000000001/publish" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from publishEvent>" }
```

### POST /api/v1/content/events/{id}/unpublish

- Access: session, action `content.unpublish`.
- Roles (scope): content_editor (all), super_admin (all).
- Path parameters: `id`.
- Request body: none.
- Calls: `revalidatePublicPages` (`@/modules/content`), `unpublishEvent` (`@/modules/content`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404.
- Access matrix: registry id `content.events.unpublish`.
- Source: `src/app/api/v1/content/events/[id]/unpublish/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/content/events/00000000-0000-4000-8000-000000000001/unpublish" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from unpublishEvent>" }
```

### GET /api/v1/dashboard/routed

- Access: session, action `dashboard.read`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Request body: none.
- Calls: `listRecentlyRouted` (`@/modules/reporting`), `parsePageQuery` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`), `REPORTING_LIMITS` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `dashboard.routed`.
- Source: `src/app/api/v1/dashboard/routed/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/dashboard/routed" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listRecentlyRouted>" }
```

### GET /api/v1/dashboard/summary

- Access: session, action `dashboard.read`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Request body: none.
- Calls: `getDashboardSummary` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `dashboard.summary`.
- Source: `src/app/api/v1/dashboard/summary/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/dashboard/summary" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getDashboardSummary>" }
```

### GET /api/v1/dashboard/trend

- Access: session, action `dashboard.read`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Request body: none.
- Calls: `getMonthlyTrend` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `dashboard.trend`.
- Source: `src/app/api/v1/dashboard/trend/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/dashboard/trend" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getMonthlyTrend>" }
```

### GET /api/v1/dashboard/unrouted

- Access: session, action `dashboard.read`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Request body: none.
- Calls: `listUnrouted` (`@/modules/reporting`), `parsePageQuery` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`), `REPORTING_LIMITS` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `dashboard.unrouted`.
- Source: `src/app/api/v1/dashboard/unrouted/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/dashboard/unrouted" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listUnrouted>" }
```

### POST /api/v1/exports/print

- Access: session, action `export.create`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Request body: `printBodySchema`; fields `kind`, `reportId`, `rowCount`.
- Calls: `recordPrint` (`@/modules/reporting`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 422.
- Access matrix: registry id `exports.print`.
- Source: `src/app/api/v1/exports/print/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/exports/print" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"<kind>","reportId":"<reportId>","rowCount":"<rowCount>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from recordPrint>" }
```

### GET /api/v1/exports/{kind}

- Access: session, action `export.create`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Path parameters: `kind`.
- Request body: none.
- Calls: `exportCsv` (`@/modules/reporting`), `figureFromSlug` (`@/modules/reporting`), `isExportKind` (`@/modules/reporting`), `isMoneyFigure` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `exports.csv`.
- Source: `src/app/api/v1/exports/[kind]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/exports/example-kind" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200

(JSON written directly by the handler in src/app/api/v1/exports/[kind]/route.ts)
```

### GET /api/v1/members

- Access: session, action `member.read`.
- Roles (scope): super_admin (all), hr_lead (own branch), branch_lead (own branch).
- Request body: none.
- Calls: `listMembers` (`@/modules/members`), `parseMemberQuery` (`@/modules/members`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `members.list`.
- Source: `src/app/api/v1/members/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/members" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listMembers>" }
```

### GET /api/v1/members/{id}

- Access: session, action `member.read`.
- Roles (scope): super_admin (all), hr_lead (own branch), branch_lead (own branch).
- Path parameters: `id`.
- Request body: none.
- Calls: `getMember` (`@/modules/members`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `members.get`.
- Source: `src/app/api/v1/members/[id]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/members/00000000-0000-4000-8000-000000000001" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getMember>" }
```

### PATCH /api/v1/members/{id}

- Access: session, action `member.update`.
- Roles (scope): super_admin (all), hr_lead (own branch).
- Path parameters: `id`.
- Request body: `memberPatchSchema`; fields `teamId`, `memberRole`, `status`.
- Calls: `updateMember` (`@/modules/members`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `members.update`.
- Source: `src/app/api/v1/members/[id]/route.ts`.

```sh
curl -X PATCH "http://localhost:3000/api/v1/members/00000000-0000-4000-8000-000000000001" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"<teamId>","memberRole":"<memberRole>","status":"<status>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from updateMember>" }
```

### POST /api/v1/public/applications

- Access: public, no session.
- Request body: `applicationInputSchema`; fields `fullName`, `email`, `phone`, `message`, `branchId`, `website`.
- Calls: `applicationRateLimiter` (`@/modules/applications`), `submitApplication` (`@/modules/applications`).
- Success status: 201. Error statuses: 403 (Origin), 422, 429.
- Access matrix: registry id `public.applications.submit`.
- Source: `src/app/api/v1/public/applications/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/public/applications" \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"fullName":"<fullName>","email":"<email>","phone":"<phone>","message":"<message>","branchId":"<branchId>","website":"<website>"}'
```

```http
HTTP/1.1 201
Content-Type: application/json

{ "ok": true }
```

### GET /api/v1/public/impact

- Access: public, no session.
- Request body: none.
- Calls: `getPublicImpact` (`@/modules/reporting`).
- Success status: 200.
- Access matrix: registry id `public.impact`.
- Source: `src/app/api/v1/public/impact/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/public/impact"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getPublicImpact>" }
```

### GET /api/v1/public/verify/{code}

- Access: public, no session.
- Path parameters: `code`.
- Request body: none.
- Calls: `lookupVerification` (`@/modules/verification`), `verifyRateLimiter` (`@/modules/verification`).
- Success status: 200. Error statuses: 404, 429.
- Access matrix: registry id `public.verify`.
- Source: `src/app/api/v1/public/verify/[code]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/public/verify/example-code"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from lookupVerification>" }
```

### GET /api/v1/reports

- Access: session, action `report.read`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch).
- Request body: none.
- Calls: `ensureCurrentWeekDrafts` (`@/modules/reports`), `listReports` (`@/modules/reports`), `parseReportQuery` (`@/modules/reports`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `reports.list`.
- Source: `src/app/api/v1/reports/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/reports" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from ensureCurrentWeekDrafts>" }
```

### GET /api/v1/reports/review-queue

- Access: session, action `report.approve`.
- Roles (scope): finance_reviewer (all).
- Request body: none.
- Calls: `listReviewQueue` (`@/modules/reports`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `reports.review_queue`.
- Source: `src/app/api/v1/reports/review-queue/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/reports/review-queue" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listReviewQueue>" }
```

### GET /api/v1/reports/{id}

- Access: session, action `report.read`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch).
- Path parameters: `id`.
- Request body: none.
- Calls: `getReport` (`@/modules/reports`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `reports.get`.
- Source: `src/app/api/v1/reports/[id]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/reports/00000000-0000-4000-8000-000000000001" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getReport>" }
```

### POST /api/v1/reports/{id}/approve

- Access: session, action `report.approve`.
- Roles (scope): finance_reviewer (all).
- Path parameters: `id`.
- Request body: none.
- Calls: `approveReport` (`@/modules/reports`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404.
- Access matrix: registry id `reports.approve`.
- Source: `src/app/api/v1/reports/[id]/approve/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/reports/00000000-0000-4000-8000-000000000001/approve" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from approveReport>" }
```

### POST /api/v1/reports/{id}/return

- Access: session, action `report.return`.
- Roles (scope): finance_reviewer (all).
- Path parameters: `id`.
- Request body: `returnInputSchema`; fields `reason`.
- Calls: `returnReport` (`@/modules/reports`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `reports.return`.
- Source: `src/app/api/v1/reports/[id]/return/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/reports/00000000-0000-4000-8000-000000000001/return" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"<reason>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from returnReport>" }
```

### POST /api/v1/reports/{id}/share

- Access: session, action `report.share`.
- Roles (scope): branch_lead (own branch).
- Path parameters: `id`.
- Request body: `shareInputSchema`; fields `locale`.
- Calls: `shareReport` (`@/modules/reporting`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `reports.share`.
- Source: `src/app/api/v1/reports/[id]/share/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/reports/00000000-0000-4000-8000-000000000001/share" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"locale":"<locale>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from shareReport>" }
```

### POST /api/v1/reports/{id}/submit

- Access: session, action `report.submit`.
- Roles (scope): branch_lead (own branch).
- Path parameters: `id`.
- Request body: `submitInputSchema`; fields `confirmNil`.
- Calls: `submitReport` (`@/modules/reports`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `reports.submit`.
- Source: `src/app/api/v1/reports/[id]/submit/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/reports/00000000-0000-4000-8000-000000000001/submit" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"confirmNil":"<confirmNil>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from submitReport>" }
```

### GET /api/v1/reports/{id}/timeline

- Access: session, action `audit.read_timeline`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch).
- Path parameters: `id`.
- Request body: none.
- Calls: `getReportTimeline` (`@/modules/timeline`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `reports.timeline`.
- Source: `src/app/api/v1/reports/[id]/timeline/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/reports/00000000-0000-4000-8000-000000000001/timeline" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getReportTimeline>" }
```

### GET /api/v1/reports/{id}/verification

- Access: session, action `report.read`.
- Roles (scope): super_admin (all), finance_reviewer (all), branch_lead (own branch).
- Path parameters: `id`.
- Request body: none.
- Calls: `getReportVerification` (`@/modules/verification`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `reports.verification`.
- Source: `src/app/api/v1/reports/[id]/verification/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/reports/00000000-0000-4000-8000-000000000001/verification" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getReportVerification>" }
```

### GET /api/v1/teams

- Access: session, action `team.read`.
- Roles (scope): super_admin (all), hr_lead (own branch), branch_lead (own branch).
- Request body: none.
- Calls: `listTeams` (`@/modules/members`).
- Success status: 200. Error statuses: 401, 403.
- Access matrix: registry id `teams.list`.
- Source: `src/app/api/v1/teams/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/teams" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from listTeams>" }
```

### POST /api/v1/teams

- Access: session, action `team.manage`.
- Roles (scope): super_admin (all), hr_lead (own branch).
- Request body: `teamInputSchema`; fields `name`, `branchId`.
- Calls: `createTeam` (`@/modules/members`).
- Success status: 201. Error statuses: 403 (Origin), 401, 403, 422.
- Access matrix: registry id `teams.create`.
- Source: `src/app/api/v1/teams/route.ts`.

```sh
curl -X POST "http://localhost:3000/api/v1/teams" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<name>","branchId":"<branchId>"}'
```

```http
HTTP/1.1 201
Content-Type: application/json

{ "data": "<from createTeam>" }
```

### PATCH /api/v1/teams/{id}

- Access: session, action `team.manage`.
- Roles (scope): super_admin (all), hr_lead (own branch).
- Path parameters: `id`.
- Request body: `renameInputSchema`; fields `name`.
- Calls: `renameTeam` (`@/modules/members`).
- Success status: 200. Error statuses: 403 (Origin), 401, 403, 404, 422.
- Access matrix: registry id `teams.rename`.
- Source: `src/app/api/v1/teams/[id]/route.ts`.

```sh
curl -X PATCH "http://localhost:3000/api/v1/teams/00000000-0000-4000-8000-000000000001" \
  -H "Origin: http://localhost:3000" \
  -b "shiplens_session=<session token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"<name>"}'
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from renameTeam>" }
```

### GET /api/v1/trace/{slug}

- Access: session, action `trace.read`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Path parameters: `slug`.
- Request body: none.
- Calls: `figureFromSlug` (`@/modules/reporting`), `getFigureByBranch` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `trace.figure`.
- Source: `src/app/api/v1/trace/[slug]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/trace/example-slug" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getFigureByBranch>" }
```

### GET /api/v1/trace/{slug}/branches/{branchId}

- Access: session, action `trace.read`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Path parameters: `slug`, `branchId`.
- Request body: none.
- Calls: `figureFromSlug` (`@/modules/reporting`), `getBranchReports` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `trace.branch`.
- Source: `src/app/api/v1/trace/[slug]/branches/[branchId]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/trace/example-slug/branches/00000000-0000-4000-8000-000000000002" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getBranchReports>" }
```

### GET /api/v1/trace/{slug}/branches/{branchId}/reports/{reportId}

- Access: session, action `trace.read`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Path parameters: `slug`, `branchId`, `reportId`.
- Request body: none.
- Calls: `figureFromSlug` (`@/modules/reporting`), `getReportCollections` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `trace.report`.
- Source: `src/app/api/v1/trace/[slug]/branches/[branchId]/reports/[reportId]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/trace/example-slug/branches/00000000-0000-4000-8000-000000000002/reports/00000000-0000-4000-8000-000000000003" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getReportCollections>" }
```

### GET /api/v1/trace/{slug}/branches/{branchId}/reports/{reportId}/collections/{collectionId}

- Access: session, action `trace.read`.
- Roles (scope): super_admin (all), finance_reviewer (all).
- Path parameters: `slug`, `branchId`, `reportId`, `collectionId`.
- Request body: none.
- Calls: `figureFromSlug` (`@/modules/reporting`), `getCollectionEvidence` (`@/modules/reporting`), `parseReportingFilters` (`@/modules/reporting`).
- Success status: 200. Error statuses: 401, 403, 404.
- Access matrix: registry id `trace.collection`.
- Source: `src/app/api/v1/trace/[slug]/branches/[branchId]/reports/[reportId]/collections/[collectionId]/route.ts`.

```sh
curl -X GET "http://localhost:3000/api/v1/trace/example-slug/branches/00000000-0000-4000-8000-000000000002/reports/00000000-0000-4000-8000-000000000003/collections/00000000-0000-4000-8000-000000000004" \
  -b "shiplens_session=<session token>"
```

```http
HTTP/1.1 200
Content-Type: application/json

{ "data": "<from getCollectionEvidence>" }
```
<!-- api-endpoints:end -->
