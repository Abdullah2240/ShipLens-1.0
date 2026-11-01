import type { Page } from '@playwright/test';
import type { Role } from '../support/roles';

// Every private screen with the roles that can open it (docs/permissions.md). Dynamic ids
// are resolved through the API in the signed-in session, so each role opens a record it is
// allowed to see. A resolver returns null when the demo data has no such record for the role.

export type Resolve = (page: Page) => Promise<string | null>;

export type PrivateRoute = {
  /** File-name slug for the screenshot. */
  name: string;
  roles: readonly Role[];
  /** Locale-less path, or a resolver for a path with ids. */
  path: string | Resolve;
};

/** Brand and format tokens that stay in Latin script in Urdu (scripts/lib/i18n-allowlist.json). */
export const LATIN_TOKENS = ['ShipLens', 'PKR', 'WhatsApp', 'EchoLens', 'URL', 'CSV', 'PDF', 'ID'];

const ALL: readonly Role[] = [
  'super_admin',
  'finance_reviewer',
  'content_editor',
  'branch_lead',
  'hr_lead',
];
const HEAD_OFFICE: readonly Role[] = ['super_admin', 'finance_reviewer'];
const BRANCH_READERS: readonly Role[] = [
  'super_admin',
  'finance_reviewer',
  'branch_lead',
  'hr_lead',
];
const FINANCE_READERS: readonly Role[] = ['super_admin', 'finance_reviewer', 'branch_lead'];
const PEOPLE: readonly Role[] = ['super_admin', 'branch_lead', 'hr_lead'];
const APPLICATIONS: readonly Role[] = ['super_admin', 'hr_lead'];
const CONTENT: readonly Role[] = ['super_admin', 'content_editor'];

type Row = Record<string, unknown>;

async function getData(page: Page, path: string): Promise<unknown> {
  const response = await page.request.get(path, { failOnStatusCode: false });
  if (response.status() !== 200) return null;
  return ((await response.json()) as { data?: unknown }).data ?? null;
}

/** The first record of a list body: an array, or the first array property of an object. */
function firstRow(data: unknown): Row | null {
  if (Array.isArray(data)) return (data[0] as Row | undefined) ?? null;
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return (value[0] as Row | undefined) ?? null;
    }
  }
  return null;
}

function firstId(listPath: string, toPath: (id: string) => string): Resolve {
  return async (page) => {
    const row = firstRow(await getData(page, listPath));
    return typeof row?.id === 'string' ? toPath(row.id) : null;
  };
}

/** A trace level's first row link (rows carry locale-less hrefs under /dashboard/kpi). */
function traceLevel(depth: 1 | 2 | 3): Resolve {
  return async (page) => {
    let apiPath = '/api/v1/trace/approved';
    let href: string | null = null;
    for (let level = 0; level < depth; level += 1) {
      const row = firstRow(await getData(page, apiPath));
      if (typeof row?.href !== 'string') return null;
      href = row.href;
      apiPath = `/api/v1/trace${href.slice('/dashboard/kpi'.length)}`;
    }
    return href;
  };
}

/** The first approved report, for its print page. */
const printReport: Resolve = async (page) => {
  const report = await traceLevel(2)(page);
  const id = report?.match(/\/reports\/([0-9a-f-]{36})$/)?.[1];
  return id ? `/dashboard/print/reports/${id}` : null;
};

export const PRIVATE_ROUTES: readonly PrivateRoute[] = [
  { name: 'account', roles: ALL, path: '/account' },

  { name: 'dashboard', roles: HEAD_OFFICE, path: '/dashboard' },
  { name: 'dashboard-unrouted', roles: HEAD_OFFICE, path: '/dashboard/unrouted' },
  { name: 'dashboard-kpi-approved', roles: HEAD_OFFICE, path: '/dashboard/kpi/approved' },
  { name: 'dashboard-kpi-l2-branch', roles: HEAD_OFFICE, path: traceLevel(1) },
  { name: 'dashboard-kpi-l3-report', roles: HEAD_OFFICE, path: traceLevel(2) },
  { name: 'dashboard-kpi-l4-collection', roles: HEAD_OFFICE, path: traceLevel(3) },
  { name: 'dashboard-print', roles: HEAD_OFFICE, path: '/dashboard/print' },
  { name: 'dashboard-print-report', roles: HEAD_OFFICE, path: printReport },
  { name: 'audit', roles: HEAD_OFFICE, path: '/audit' },

  { name: 'branches', roles: BRANCH_READERS, path: '/admin/branches' },
  {
    name: 'branch-detail',
    roles: BRANCH_READERS,
    path: firstId('/api/v1/branches', (id) => `/admin/branches/${id}`),
  },

  { name: 'collections', roles: FINANCE_READERS, path: '/collections' },
  {
    name: 'collection-detail',
    roles: FINANCE_READERS,
    path: firstId('/api/v1/collections', (id) => `/collections/${id}`),
  },
  { name: 'reports', roles: FINANCE_READERS, path: '/reports' },
  { name: 'reports-review', roles: ['finance_reviewer'], path: '/reports/review' },
  {
    name: 'report-detail',
    roles: FINANCE_READERS,
    path: firstId('/api/v1/reports', (id) => `/reports/${id}`),
  },

  { name: 'applications', roles: APPLICATIONS, path: '/people/applications' },
  {
    name: 'application-detail',
    roles: APPLICATIONS,
    path: firstId('/api/v1/applications', (id) => `/people/applications/${id}`),
  },
  { name: 'members', roles: PEOPLE, path: '/people/members' },
  {
    name: 'member-detail',
    roles: PEOPLE,
    path: firstId('/api/v1/members', (id) => `/people/members/${id}`),
  },
  { name: 'teams', roles: PEOPLE, path: '/people/teams' },

  { name: 'content', roles: CONTENT, path: '/content' },
  { name: 'content-editor-ur', roles: CONTENT, path: '/content/about/ur' },
  { name: 'content-preview-ur', roles: CONTENT, path: '/content/about/ur/preview' },
  { name: 'content-events', roles: CONTENT, path: '/content/events' },
  { name: 'content-event-new', roles: CONTENT, path: '/content/events/new' },
  {
    name: 'content-event-detail',
    roles: CONTENT,
    path: firstId('/api/v1/content/events', (id) => `/content/events/${id}`),
  },
];

/** The signed-out screen, swept without a session. */
export const AUTH_ROUTES: readonly { name: string; path: string }[] = [
  { name: 'login', path: '/login' },
];

export function routesFor(role: Role): PrivateRoute[] {
  return PRIVATE_ROUTES.filter((route) => route.roles.includes(role));
}
