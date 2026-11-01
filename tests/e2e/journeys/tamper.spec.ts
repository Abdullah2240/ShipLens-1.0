import type { Browser, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { DB_EXEC_ENABLED, dbExec, sqlLiteral } from './support/db-exec';
import { requireExpected } from './support/expected';

// Live tamper detection and exact restore (SUB-03), the twist segment of the demo video.
// Someone edits one past audit event straight in the database: the Super Admin's chain
// badge reports the broken event after "Check again", and the public certificate of the
// approved report stops vouching for it. Restoring the exact original value makes both
// intact again. Host runs only (E2E_DB_EXEC=1): the runner container has no database
// access. The original value is restored in `finally` and again after the test if needed.
// Strings are copied from messages/en/verify.json.

test.describe.configure({ mode: 'serial' });

const TEXT = {
  intact: 'Audit chain intact',
  recheck: 'Check again',
  broken: (seq: string) => `Audit chain broken at event #${seq}`,
  hashMismatch: 'This event was changed after it was recorded.',
  verified: 'This report is verified',
} as const;

const TRIGGER = 'audit_events_no_update_delete';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** One statement with the immutability trigger off for its own transaction only. */
function withTriggerOff(statement: string): string {
  return `BEGIN; ALTER TABLE audit_events DISABLE TRIGGER ${TRIGGER}; ${statement}; ALTER TABLE audit_events ENABLE TRIGGER ${TRIGGER}; COMMIT;`;
}

function latestEvent(reportId: string, action: string): { seq: string; after: string } {
  const out = dbExec(
    `SELECT chain_seq, after::text FROM audit_events WHERE entity_type = 'report' AND entity_id = ${sqlLiteral(reportId)} AND action = ${sqlLiteral(action)} ORDER BY chain_seq DESC LIMIT 1`,
  );
  const bar = out.indexOf('|');
  if (bar < 1) throw new Error(`no ${action} event for report ${reportId}`);
  return { seq: out.slice(0, bar), after: out.slice(bar + 1) };
}

/** Pending restore statement, so afterEach can repair the chain if the test is cut short. */
let pendingRestore: string | null = null;

function restore(): void {
  if (!pendingRestore) return;
  dbExec(pendingRestore);
  pendingRestore = null;
}

/** Opens the audit viewer, presses "Check again" and returns the fresh chain badge. */
async function recheck(page: Page) {
  await page.goto('/en/audit');
  await page
    .locator('[data-audit-header-badges]')
    .getByRole('link', { name: TEXT.recheck })
    .click();
  await expect(page).toHaveURL(/[?&]chain=fresh/);
  return page.locator('[data-audit-header-badges]').getByRole('status');
}

/** The public certificate as a visitor with no cookies sees it. */
async function publicCertificate(browser: Browser, baseURL: string | undefined, path: string) {
  const context = await browser.newContext({
    baseURL,
    locale: 'en-GB',
    extraHTTPHeaders: { 'X-Forwarded-For': '203.0.113.40' },
  });
  const visitor = await context.newPage();
  expect((await visitor.goto(`/en${path}`))?.status()).toBe(200);
  const certificate = visitor.locator('article[data-integrity]');
  await expect(certificate).toBeVisible();
  return {
    integrity: await certificate.getAttribute('data-integrity'),
    heading: (await visitor.getByRole('heading', { level: 1 }).innerText()).trim(),
    close: () => context.close(),
  };
}

test.describe('tamper detection and restore', () => {
  test.skip(
    !DB_EXEC_ENABLED,
    'tamper journey needs host docker access: run with E2E_DB_EXEC=1 from the host',
  );

  test.afterEach(async ({ page }) => {
    if (!pendingRestore) return;
    restore();
    await page.request.get('/api/v1/audit/chain?fresh=1');
  });

  test('an edited audit event breaks the chain and an exact restore heals it', async ({
    page,
    browser,
    baseURL,
    loginAs,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-en-light', 'mutates the stack: one project only');
    test.setTimeout(120_000);
    const report = requireExpected().approvedReports[0]!;
    expect(report.reportId).toMatch(UUID);
    const started = Date.now();
    const timings: Record<string, number> = {};
    const mark = (name: string) => (timings[name] = Date.now() - started);

    await loginAs('super_admin');
    const api = await page.request.get(`/api/v1/reports/${report.reportId}/verification`);
    expect(api.status(), 'verification link of the approved report').toBe(200);
    const { path } = ((await api.json()) as { data: { path: string } }).data;

    // Before: the chain is intact and the certificate verified.
    let badge = await recheck(page);
    await expect(badge).toHaveAttribute('data-status', 'intact');
    await expect(badge).toContainText(TEXT.intact);
    let cert = await publicCertificate(browser, baseURL, path);
    expect(cert.integrity).toBe('verified');
    await cert.close();
    mark('intact');

    const approve = latestEvent(report.reportId, 'report.approve');
    const submit = latestEvent(report.reportId, 'report.submit');
    expect(Number(submit.seq), 'submit precedes approval').toBeLessThan(Number(approve.seq));
    pendingRestore = withTriggerOff(
      `UPDATE audit_events SET after = ${sqlLiteral(submit.after)}::jsonb WHERE chain_seq = ${submit.seq}`,
    );

    try {
      // Tamper: the frozen total recorded by the report's submission.
      dbExec(
        withTriggerOff(
          `UPDATE audit_events SET after = jsonb_set(after, '{total_amount}', '"999999.00"') WHERE chain_seq = ${submit.seq}`,
        ),
      );
      expect(latestEvent(report.reportId, 'report.submit').after).not.toBe(submit.after);
      mark('tampered');

      badge = await recheck(page);
      await expect(badge).toHaveAttribute('data-status', 'broken');
      await expect(badge).toContainText(TEXT.broken(submit.seq));
      await expect(badge).toContainText(TEXT.hashMismatch);
      await page.screenshot({ path: testInfo.outputPath('tamper-badge-broken.png') });
      mark('badge broken');

      cert = await publicCertificate(browser, baseURL, path);
      expect(['chain_broken', 'mismatch']).toContain(cert.integrity);
      expect(cert.heading).not.toBe(TEXT.verified);
      await cert.close();
      mark('public broken');
    } finally {
      restore();
    }

    // The exact original text is back, so every hash matches again.
    expect(latestEvent(report.reportId, 'report.submit').after).toBe(submit.after);
    mark('restored');
    badge = await recheck(page);
    await expect(badge).toHaveAttribute('data-status', 'intact');
    await expect(badge).toContainText(TEXT.intact);
    mark('badge intact');
    cert = await publicCertificate(browser, baseURL, path);
    expect(cert.integrity).toBe('verified');
    expect(cert.heading).toBe(TEXT.verified);
    await cert.close();
    mark('public verified');

    await testInfo.attach('timings.json', {
      body: JSON.stringify({ submitSeq: submit.seq, approveSeq: approve.seq, ...timings }),
      contentType: 'application/json',
    });
    console.log(`tamper journey (ms since start): ${JSON.stringify(timings)}`);
  });
});
