import { PERMISSIONS, type Action } from '@/platform/authz/permissions';
import type { Role } from '@/platform/authz/roles';

// Pre-populated navigation data. Each item sits on its own line so later plans never
// conflict. The Phase 2 or 3 plan that builds a page flips `live` to `true` on its own
// line (or changes its href) and touches nothing else. There is no registry function
// and no other shared edit.

export interface NavItem {
  id: string;
  href: string;
  /** Relative to the `shell` message namespace, for example `appNav.dashboard`. */
  labelKey: string;
  requiredAction?: Action;
  live: boolean;
}

export const publicNav: NavItem[] = [
  { id: 'home', href: '/', labelKey: 'nav.home', live: true },
  { id: 'about', href: '/about', labelKey: 'nav.about', live: true },
  { id: 'programs', href: '/programs', labelKey: 'nav.programs', live: true },
  { id: 'branches', href: '/branches', labelKey: 'nav.branches', live: true },
  { id: 'events', href: '/events', labelKey: 'nav.events', live: true },
  { id: 'get-involved', href: '/get-involved', labelKey: 'nav.getInvolved', live: true },
  { id: 'contact', href: '/contact', labelKey: 'nav.contact', live: true },
];

// Route groups add no URL segment, so app pages avoid the public /branches path.
export const appNav: NavItem[] = [
  { id: 'account', href: '/account', labelKey: 'appNav.account', live: true },
  {
    id: 'dashboard',
    href: '/dashboard',
    labelKey: 'appNav.dashboard',
    requiredAction: 'dashboard.read',
    live: false,
  },
  {
    id: 'branches',
    href: '/admin/branches',
    labelKey: 'appNav.branches',
    requiredAction: 'branch.read',
    live: false,
  },
  {
    id: 'collections',
    href: '/collections',
    labelKey: 'appNav.collections',
    requiredAction: 'collection.read',
    live: false,
  },
  {
    id: 'reports',
    href: '/reports',
    labelKey: 'appNav.reports',
    requiredAction: 'report.read',
    live: false,
  },
  {
    id: 'applications',
    href: '/people/applications',
    labelKey: 'appNav.applications',
    requiredAction: 'application.read',
    live: false,
  },
  {
    id: 'members',
    href: '/people/members',
    labelKey: 'appNav.members',
    requiredAction: 'member.read',
    live: false,
  },
  {
    id: 'teams',
    href: '/people/teams',
    labelKey: 'appNav.teams',
    requiredAction: 'team.read',
    live: false,
  },
  {
    id: 'content',
    href: '/content',
    labelKey: 'appNav.content',
    requiredAction: 'content.read',
    live: false,
  },
  {
    id: 'audit',
    href: '/audit',
    labelKey: 'appNav.audit',
    requiredAction: 'audit.read_finance',
    live: false,
  },
];

type Grants = Partial<Record<Role, unknown>>;

/**
 * Items the given role may see: none when signed out, never items that are not live,
 * and an item with a required action only when the permission table grants it to the role.
 */
export function navForRole(items: readonly NavItem[], role: Role | null): NavItem[] {
  if (role === null) return [];
  return items.filter((item) => {
    if (!item.live) return false;
    if (!item.requiredAction) return true;
    const grants: Grants = PERMISSIONS[item.requiredAction];
    return grants[role] !== undefined;
  });
}
