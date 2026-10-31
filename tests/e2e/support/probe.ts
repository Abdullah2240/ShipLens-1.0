import { test, type APIRequestContext, type APIResponse } from '@playwright/test';

/** A feature counts as absent only when its route answers 404 or 405, never on 401/403. */
export function isMissing(response: Pick<APIResponse, 'status'>): boolean {
  const status = response.status();
  return status === 404 || status === 405;
}

/** Probe a route without following redirects. Returns false only for 404/405. */
export async function routeExists(
  request: APIRequestContext,
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
): Promise<boolean> {
  const response = await request.fetch(path, { method, maxRedirects: 0, failOnStatusCode: false });
  return !isMissing(response);
}

/**
 * Skip the current test when a feature built by a later plan is absent.
 * Reasons look like `pending plan 01-11: /api/v1/auth/login not built`.
 */
export function requireFeature(exists: boolean, reason: string): void {
  test.skip(!exists, reason);
}

export const PENDING = {
  authApi: 'pending plan 01-11: /api/v1/auth/login not built',
  loginPage: (locale: string) => `pending plan 01-15: /${locale}/login not built`,
} as const;
