import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { expect } from '../support/fixtures';

// Helpers shared by the people specs (applications and members). They only call the
// public HTTP API, so the specs stay independent of app code.

/** A short id that makes this run's names and emails unique. */
export function runId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function originOf(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('baseURL is not configured');
  return new URL(baseURL).origin;
}

// Each submission comes from its own documentation-range address, so the per-address
// application limit is not spent by test data.
let addressCounter = 0;
function nextAddress(): string {
  addressCounter += 1;
  return `198.51.100.${((Date.now() + addressCounter) % 250) + 1}`;
}

export type Applicant = { fullName: string; email: string; phone: string; message: string };

export function applicant(label: string, id: string): Applicant {
  return {
    fullName: `${label} Testwala ${id}`,
    email: `e2e+${label.toLowerCase()}-${id}@example.test`,
    phone: '03001234567',
    message: `Weekend volunteer (${label}).\nCan start next week.`,
  };
}

/** Submits a public application to a branch through the public form endpoint. */
export async function submitApplication(
  request: APIRequestContext,
  baseURL: string | undefined,
  branchId: string,
  person: Applicant,
): Promise<void> {
  const response = await request.post('/api/v1/public/applications', {
    headers: { Origin: originOf(baseURL), 'X-Forwarded-For': nextAddress() },
    data: { ...person, branchId, website: '' },
    failOnStatusCode: false,
  });
  expect(response.status(), 'public application submit').toBe(201);
}

/** Finds an application by email through the HR list API (session of the current page). */
export async function findApplicationId(page: Page, email: string): Promise<string> {
  const response = await page.request.get('/api/v1/applications?status=pending&pageSize=100');
  expect(response.status(), 'GET /api/v1/applications').toBe(200);
  const body = (await response.json()) as { data: { items: { id: string; email: string }[] } };
  const match = body.data.items.find((item) => item.email === email);
  expect(match, `pending application for ${email}`).toBeTruthy();
  return match!.id;
}

/** Accepts an application through the API and returns the new member id. */
export async function acceptThroughApi(
  page: Page,
  baseURL: string | undefined,
  applicationId: string,
): Promise<{ memberId: string; memberCode: string; status: number }> {
  const response = await page.request.post(`/api/v1/applications/${applicationId}/accept`, {
    headers: { Origin: originOf(baseURL) },
    failOnStatusCode: false,
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: { memberId: string; memberCode: string };
  };
  return {
    memberId: body.data?.memberId ?? '',
    memberCode: body.data?.memberCode ?? '',
    status: response.status(),
  };
}

/** True when the element is laid out left-to-right (its computed direction). */
export async function laidOutLtr(locator: Locator): Promise<boolean> {
  return locator.first().evaluate((node) => getComputedStyle(node).direction === 'ltr');
}
