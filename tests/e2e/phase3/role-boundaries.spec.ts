import type { Page } from '@playwright/test';
import { expect, test, type UiLocale } from '../support/fixtures';
import type { Role } from '../support/roles';

// Phase 3 role boundaries (DASH-06): Branch Lead, HR Lead and Content Editor get the
// not-found page on every head office screen and 403 on every head office API read; Finance
// sees only finance entities in the audit viewer; the share button is a Branch Lead tool
// on their own branch's reports only. Ids are resolved as Finance in the same browser
// context, then the session switches. Read-only.

// shell.notFound.title and share.button (messages/<locale>/*.json).
const TEXT = {
  en: { notFound: 'We could not find that page', share: 'Share to WhatsApp' },
  ur: { notFound: 'یہ صفحہ نہیں مل سکا', share: 'واٹس ایپ پر شیئر کریں' },
} as const satisfies Record<UiLocale, unknown>;

// src/modules/audit-log/policy.ts FINANCE_AUDIT_ENTITY_TYPES.
const FINANCE_ENTITIES = ['collection', 'report', 'export', 'share'];

const OUTSIDERS: readonly Role[] = ['branch_lead', 'hr_lead', 'content_editor'];

type Row = { href: string };
type ReportItem = { id: string; branchId: string };

async function data<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status(), `GET ${path}`).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

/** The approved chain's first branch, report and collection hrefs (locale-less). */
async function approvedChain(page: Page) {
  const hrefs: string[] = [];
  let apiPath = '/api/v1/trace/approved';
  for (let level = 0; level < 3; level += 1) {
    const { rows } = await data<{ rows: Row[] }>(page, apiPath);
    const href = rows[0]?.href;
    expect(href, `a row at level ${level + 1}`).toBeTruthy();
    hrefs.push(href!);
    apiPath = `/api/v1/trace${href!.slice('/dashboard/kpi'.length)}`;
  }
  const reportId = /\/reports\/([0-9a-f-]{36})/.exec(hrefs[1]!)?.[1];
  expect(reportId).toBeTruthy();
  return { hrefs, reportId: reportId! };
}

async function expectNotFound(page: Page, path: string, uiLocale: UiLocale) {
  const response = await page.goto(path);
  // 404, or 200 when the loading shell was already streamed before the refusal.
  expect([200, 404], path).toContain(response?.status());
  await expect(page.getByRole('heading', { name: TEXT[uiLocale].notFound })).toBeVisible();
  await expect(page.locator('main tfoot')).toHaveCount(0);
  await expect(page.locator('li[data-event-id]')).toHaveCount(0);
}

test.describe('Phase 3 role boundaries', () => {
  for (const role of OUTSIDERS) {
    test(`${role}: every head office screen is not found and every API read is 403`, async ({
      page,
      loginAs,
      localePath,
      uiLocale,
    }) => {
      test.setTimeout(120_000);
      await loginAs('finance_reviewer');
      const { hrefs, reportId } = await approvedChain(page);
      const [branchHref, reportHref, collectionHref] = hrefs as [string, string, string];

      await page.context().clearCookies();
      await loginAs(role);

      const pages = [
        '/dashboard',
        '/dashboard/unrouted',
        '/dashboard/kpi/approved',
        branchHref,
        reportHref,
        collectionHref,
        '/dashboard/print',
        `/dashboard/print/reports/${reportId}`,
        '/audit',
      ];
      for (const path of pages) await expectNotFound(page, localePath(path), uiLocale);

      const trace = (href: string) => `/api/v1/trace${href.slice('/dashboard/kpi'.length)}`;
      const reads = [
        '/api/v1/dashboard/summary',
        '/api/v1/dashboard/trend',
        '/api/v1/dashboard/unrouted',
        '/api/v1/dashboard/routed',
        '/api/v1/trace/approved',
        trace(branchHref),
        trace(reportHref),
        trace(collectionHref),
        '/api/v1/exports/summary',
        '/api/v1/exports/reports?figure=approved',
        `/api/v1/exports/collections?figure=approved&reportId=${reportId}`,
        '/api/v1/exports/unrouted',
        '/api/v1/audit',
        '/api/v1/audit/facets',
      ];
      for (const path of reads) {
        const response = await page.request.get(path, { failOnStatusCode: false });
        expect(response.status(), `GET ${path} as ${role}`).toBe(403);
        expect(response.headers()['content-type'] ?? '').not.toContain('text/csv');
      }
    });
  }

  test('finance sees only finance entities in the audit viewer', async ({
    page,
    loginAs,
    localePath,
  }) => {
    await loginAs('finance_reviewer');
    expect((await page.goto(localePath('/audit')))?.status()).toBe(200);
    await expect(page.getByRole('note')).toBeVisible();
    const shown = await page
      .locator('li[data-event-id]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-event-id') ?? ''));
    expect(shown.length, 'finance events on the first page').toBeGreaterThan(0);

    // The same page from the API (newer events from parallel specs are cut off by `before`).
    const before = String(Math.max(...shown.map(Number)) + 1);
    const list = await data<{ items: { id: string; entityType: string }[]; restricted: boolean }>(
      page,
      `/api/v1/audit?before=${before}&limit=${shown.length}`,
    );
    expect(list.restricted).toBe(true);
    for (const item of list.items) expect(FINANCE_ENTITIES).toContain(item.entityType);
    const api = new Set(list.items.map((item) => item.id));
    for (const id of shown) expect(api.has(id), `event ${id} is a finance event`).toBe(true);

    const facets = await data<{ entityTypes: string[]; restricted: boolean }>(
      page,
      '/api/v1/audit/facets',
    );
    expect(facets.restricted).toBe(true);
    for (const type of facets.entityTypes) expect(FINANCE_ENTITIES).toContain(type);

    for (const entity of ['member', 'application', 'branch', 'content', 'user']) {
      const other = await data<{ items: unknown[] }>(page, `/api/v1/audit?entity=${entity}`);
      expect(other.items, `no ${entity} events for finance`).toHaveLength(0);
    }
  });

  test('the share button appears only on the Branch Lead’s own reports', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    const share = () => page.getByRole('button', { name: TEXT[uiLocale].share });

    const lead = await loginAs('branch_lead');
    const own = await data<{ items: ReportItem[] }>(page, '/api/v1/reports');
    const mine = own.items[0];
    expect(mine, 'a report in the lead’s branch').toBeDefined();
    expect(mine!.branchId).toBe(lead.branchId);
    expect((await page.goto(localePath(`/reports/${mine!.id}`)))?.status()).toBe(200);
    await expect(share().filter({ visible: true }).first()).toBeVisible();

    await page.context().clearCookies();
    await loginAs('finance_reviewer');
    const all = await data<{ items: ReportItem[] }>(page, '/api/v1/reports');
    const foreign = all.items.find((item) => item.branchId !== lead.branchId);
    expect(foreign, 'a report of another branch').toBeDefined();
    // Finance reads every branch's report but holds no share action.
    expect((await page.goto(localePath(`/reports/${foreign!.id}`)))?.status()).toBe(200);
    await expect(page.getByTestId('report-status')).toBeVisible();
    await expect(share()).toHaveCount(0);

    await page.context().clearCookies();
    await loginAs('branch_lead');
    await expectNotFound(page, localePath(`/reports/${foreign!.id}`), uiLocale);
    await expect(share()).toHaveCount(0);
  });
});
