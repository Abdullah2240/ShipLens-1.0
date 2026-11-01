import { expect, test } from '../support/fixtures';

// Where people meet report verification in the screens they already use (SUB-03): the
// public verification panel on an approved report, the audit chain badge on the audit
// viewer and the "Verify a report" link in the public footer. Read-only, every project.
// Specs never import app code, so the visible strings are pinned here
// (messages/<locale>/verify.json).

// From db/seed/data/reports.json: an approved Sample Branch report readable by `branch_lead`.
const SAMPLE_BRANCH_REPORT = '72d847f7-686c-4106-b22b-f450dc726a8c';

const TEXT = {
  en: {
    footerLink: 'Verify a report',
    verifyTitle: 'Verify a weekly report',
    panel: 'Public verification',
    intact: 'Audit chain intact',
    recheck: 'Check again',
  },
  ur: {
    footerLink: 'رپورٹ کی تصدیق کریں',
    verifyTitle: 'ہفتہ وار رپورٹ کی تصدیق',
    panel: 'عوامی تصدیق',
    intact: 'آڈٹ سلسلہ صحیح سالم ہے',
    recheck: 'دوبارہ جانچیں',
  },
} as const;

const CODE = /^[0-9A-Z]{5}-[0-9A-Z]{5}$/;

test.describe('verification in existing screens', { tag: '@smoke' }, () => {
  test('the public footer links to the verify page', async ({ page, localePath, uiLocale }) => {
    await page.goto(localePath('/'));
    const link = page
      .getByRole('contentinfo')
      .getByRole('link', { name: TEXT[uiLocale].footerLink, exact: true });
    await expect(link).toHaveAttribute('href', `/${uiLocale}/verify`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${uiLocale}/verify$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(TEXT[uiLocale].verifyTitle);
  });

  test('an approved report shows its code, QR and public link', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('branch_lead');
    const api = await page.request.get(`/api/v1/reports/${SAMPLE_BRANCH_REPORT}/verification`);
    expect(api.status()).toBe(200);
    const { data } = (await api.json()) as { data: { code: string; path: string } };
    expect(data.code).toMatch(CODE);

    await page.goto(localePath(`/reports/${SAMPLE_BRANCH_REPORT}`));
    const panel = page.getByRole('region', { name: TEXT[uiLocale].panel });
    await expect(panel).toBeVisible();
    await expect(panel.locator('bdi[dir="ltr"]').first()).toHaveText(data.code);
    await expect(panel.locator('svg[role="img"]')).toHaveCount(1);
    const open = panel.locator('a[target="_blank"]');
    await expect(open).toHaveAttribute('href', new RegExp(`${escape(data.path)}$`));
    await expect(panel.locator('input[readonly]')).toHaveValue(new RegExp(`${escape(data.path)}$`));
  });

  test('a draft report shows no verification panel', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('branch_lead');
    const list = await page.request.get('/api/v1/reports?limit=100');
    expect(list.status()).toBe(200);
    const { items } = ((await list.json()) as { data: { items: { id: string; status: string }[] } })
      .data;
    const other = items.find((item) => item.status !== 'approved');
    test.skip(!other, 'the seed gives this lead no report that is not approved');
    await page.goto(localePath(`/reports/${other!.id}`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: TEXT[uiLocale].panel })).toHaveCount(0);
  });

  test('the audit viewer shows the chain status and re-checks it on request', async ({
    page,
    loginAs,
    localePath,
    uiLocale,
  }) => {
    await loginAs('super_admin');
    await page.goto(localePath('/audit?entity=report'));
    const slot = page.locator('[data-audit-header-badges]');
    const badge = slot.getByRole('status');
    await expect(badge).toHaveAttribute('data-status', 'intact');
    await expect(badge).toContainText(TEXT[uiLocale].intact);
    const recheck = badge.getByRole('link', { name: TEXT[uiLocale].recheck });
    await expect(recheck).toHaveAttribute('href', `/${uiLocale}/audit?entity=report&chain=fresh`);
    await recheck.click();
    await expect(page).toHaveURL(/[?&]chain=fresh/);
    await expect(page.locator('[data-audit-header-badges]').getByRole('status')).toHaveAttribute(
      'data-status',
      'intact',
    );
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
