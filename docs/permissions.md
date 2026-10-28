# Permission table

Generated from src/platform/authz/permissions.ts by `npm run permissions:doc`. Do not edit by hand.

| Action | super_admin | finance_reviewer | content_editor | branch_lead | hr_lead |
| --- | --- | --- | --- | --- | --- |
| application.decide | all | - | - | - | own branch |
| application.read | all | - | - | - | own branch |
| audit.read | all | - | - | - | - |
| audit.read_finance | all | all | - | - | - |
| audit.read_timeline | all | all | - | own branch | - |
| branch.assign_leads | all | - | - | - | - |
| branch.create | all | - | - | - | - |
| branch.read | all | all | - | own branch | own branch |
| branch.transition | all | - | - | - | - |
| branch.update | all | - | - | - | - |
| collection.amend | - | - | - | own branch | - |
| collection.create | - | - | - | own branch | - |
| collection.mark_routed | all | all | - | - | - |
| collection.read | all | all | - | own branch | - |
| collection.unmark_routed | all | all | - | - | - |
| collection.void | - | - | - | own branch | - |
| content.edit | all | - | all | - | - |
| content.preview | all | - | all | - | - |
| content.publish | all | - | all | - | - |
| content.read | all | - | all | - | - |
| content.unpublish | all | - | all | - | - |
| dashboard.read | all | all | - | - | - |
| export.create | all | all | - | - | - |
| member.read | all | - | - | own branch | own branch |
| member.update | all | - | - | - | own branch |
| report.approve | - | all | - | - | - |
| report.read | all | all | - | own branch | - |
| report.return | - | all | - | - | - |
| report.share | - | - | - | own branch | - |
| report.submit | - | - | - | own branch | - |
| team.manage | all | - | - | - | own branch |
| team.read | all | - | - | own branch | own branch |
| trace.read | all | all | - | - | - |
| user.read | all | - | - | - | - |

## Rules

- 403 when the role lacks the action.
- Identical 404 when a permitted role asks for a missing or out-of-scope record.
- 409 for a wrong state.
- 422 for invalid input.
- 429 for login throttling.
- Role and branch always come from the server session.

## Public endpoints

These need no session and are deliberately not in the table.

- POST /api/v1/applications: public membership application submit
- GET /api/v1/public/content: published public content
- GET /api/v1/public/impact: public impact page figures
- GET /api/health: liveness, no database
- GET /api/health/db: database readiness
- POST /api/v1/auth/login: login, throttled and same response for unknown email and wrong password

## Defaults pending confirmation

Default, confirm with the brief:

- Lock anchor is `collected_on`, day 7 inclusive; a returned report reopens.
- Finance Reviewer sees all branches.
- HR Lead is branch scoped.
- Finance Reviewer audit access is limited to finance entities.
- Who marks collections routed: Finance Reviewer and Super Admin.
