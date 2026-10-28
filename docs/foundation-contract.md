# Foundation contract

This file lists what is frozen after the scaffold. Changes to a frozen item go through a small PR that both builders approve.

## Frozen items

- **Roles** (`src/platform/authz/roles.ts`): `super_admin`, `finance_reviewer`, `content_editor`, `branch_lead`, `hr_lead`. Branch-scoped roles: `branch_lead`, `hr_lead`. The file has no imports.
- **Permissions**: the `Action` type and `PERMISSIONS` table arrive in one file from the authorization plan and list every action for all phases. `docs/permissions.md` is generated from it.
- **Locales** (`src/i18n/routing.ts`): `en` (default) and `ur`, `localePrefix: 'always'`. `ur` is right-to-left.
- **Message namespaces**: `common, errors, auth, shell, public, branches, collections, reports, dashboard, audit, applications, members, content, impact`. Namespace = file name = `useTranslations('<ns>')`. One file per module under `messages/<locale>/<ns>.json`. Both locales carry identical key sets. A new module adds its own file; the files already exist.
- **Formatters** (`src/platform/i18n/format.ts`): `formatMoney(amount: string, locale)`, `formatDate(value: string | Date, locale)`, `formatDateTime(instant: Date, locale)`, `formatInt(value: number | string, locale)`, `formatId(id: string)`. Latin digits in both locales, 3-digit grouping, money formatted from decimal strings only, never from `Number`.
- **Health endpoints**: `GET /api/health` is liveness only (no database). `GET /api/health/db` runs `SELECT 1` and returns 503 when the database is down.
- **API error shape**: `{ "error": { "code", "message", "details"?, "requestId" } }` with statuses 401, 403, 404, 409, 422, 429, 500.

## Folder ownership

Owner track:

- `src/platform/{db,authz,audit,http,errors,time,money,config,log}`
- `src/modules/{auth,branches,collections,reports,reporting}`
- `db/`
- `scripts/{migrate,seed,smoke}*`
- Docker, CI and Render files

Saniya track:

- `src/i18n`
- `src/app/[locale]/**` layouts
- `src/components`
- `src/platform/i18n`
- `src/modules/{applications,members,content,public-site}`
- `messages/` content
- `scripts/check-*.mjs`

## Layer rules

Route handler, then service, then repository, then Postgres. ESLint enforces this with `no-restricted-imports`:

- Services, repositories and kernel code (`src/platform/{authz,audit,db,time,money,errors,config,log}`) must not import `next`, `next/*`, `next-intl`, `next-intl/*`, `react` or `react-dom`.
- Pages, routes and components (`src/app`, `src/components`) must not import a repository.
- Repositories must not import another module (use relative imports inside your own module) and must not import `@/platform/audit`; `command()` writes audit rows.

## Test naming

A test that touches Postgres lives under `tests/` or `db/`, or is named `*.int.test.*`. Every other test is a unit test and must pass with no database running.

- `npm test` runs the unit project only and needs no database.
- `npm run test:integration` runs the integration project (needs Postgres).
- `npm run test:all` and `npm run test:coverage` run both.

## Intentional exceptions and runtime rules

- `src/platform/http/route.ts` imports `@/modules/auth` to resolve the session. It is the one platform folder allowed to import a module.
- `getEnv()` and `getPool()` are called only inside request handlers or script entry points, never at import time, because `next build` imports route modules with no environment.
