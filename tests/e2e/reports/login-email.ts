import { expect, type Page } from '@playwright/test';
import { demoPassword } from '../support/roles';

/** Demo-dataset users (02-24 seed) that the role fixture does not cover. */
export const LAHORE_LEAD = 'lead.lahore@shiplens.test';
export const LAHORE_BRANCH = 'Lahore Central (Demo)';

/** Logs in through the API by email; the session cookie stays in the page's context. */
export async function loginAsEmail(
  page: Page,
  baseURL: string | undefined,
  email: string,
): Promise<void> {
  if (!baseURL) throw new Error('baseURL is not configured');
  const response = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: new URL(baseURL).origin },
    data: { email, password: demoPassword() },
    failOnStatusCode: false,
  });
  expect(response.status(), `login as ${email}`).toBe(200);
}

/** Today's business date in Pakistan time, YYYY-MM-DD. */
export function pktToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
