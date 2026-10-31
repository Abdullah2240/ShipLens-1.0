// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { PERMISSIONS } from '@/platform/authz/permissions';
import { ROLES, type Role } from '@/platform/authz/roles';
import { AppShell } from './AppShell';
import { MinimalShell } from './MinimalShell';
import { appNav, navForRole, publicNav, type NavItem } from './nav';
import { PublicShell } from './PublicShell';

const nav = vi.hoisted(() => ({ pathname: '/dashboard' }));

// next-intl's createNavigation cannot be imported under Vitest (see LanguageSwitcher.test),
// so navigation is replaced by a stand-in: locale-less pathname, hrefs prefixed only
// when a `locale` prop is passed.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname,
  Link: ({
    href,
    locale,
    children,
    ...rest
  }: {
    href: string | { pathname: string };
    locale?: string;
    children: ReactNode;
  } & Record<string, unknown>) => {
    const pathname = typeof href === 'string' ? href : href.pathname;
    return (
      <a href={locale ? `/${locale}${pathname === '/' ? '' : pathname}` : pathname} {...rest}>
        {children}
      </a>
    );
  },
}));

const LOCALES = ['en', 'ur'] as const;
const NAMESPACES = ['common', 'shell'];
const allLive = (items: NavItem[]) => items.map((item) => ({ ...item, live: true }));

function messages(locale: string): Record<string, unknown> {
  const file = path.resolve(import.meta.dirname, `../../../messages/${locale}/shell.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

function text(locale: string, key: string): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
      messages(locale),
    );
  if (typeof value !== 'string') throw new Error(`missing shell message ${locale}:${key}`);
  return value;
}

beforeEach(() => {
  nav.pathname = '/dashboard';
  document.documentElement.removeAttribute('data-theme');
});

describe('nav data', () => {
  it('gives every appNav item a unique id, a rooted href, a translated label and a real action', () => {
    const ids = appNav.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of appNav) {
      expect(item.href.startsWith('/')).toBe(true);
      for (const locale of LOCALES) expect(text(locale, item.labelKey)).not.toBe('');
      if (item.requiredAction) expect(PERMISSIONS).toHaveProperty(item.requiredAction);
    }
  });

  it('keeps hrefs unique and clear of the public paths', () => {
    const hrefs = appNav.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const publicHrefs = new Set(publicNav.map((i) => i.href));
    for (const href of hrefs) expect(publicHrefs.has(href)).toBe(false);
  });

  it('declares the seven public pages with translated labels', () => {
    expect(publicNav.map((i) => i.href)).toEqual([
      '/',
      '/about',
      '/programs',
      '/branches',
      '/events',
      '/get-involved',
      '/contact',
    ]);
    for (const item of publicNav) {
      for (const locale of LOCALES) expect(text(locale, item.labelKey)).not.toBe('');
    }
  });
});

describe('navForRole', () => {
  const ids = (role: Role | null, items = allLive(appNav)) =>
    navForRole(items, role).map((i) => i.id);

  it('returns nothing without a role', () => {
    expect(ids(null)).toEqual([]);
  });

  it('drops items that are not live', () => {
    expect(navForRole(appNav, 'super_admin').map((i) => i.id)).toEqual(['account']);
  });

  it('keeps an item without a required action for any signed-in role', () => {
    for (const role of ROLES) expect(ids(role)).toContain('account');
  });

  it('shows each role exactly the entries its permissions allow', () => {
    expect(ids('super_admin')).toEqual([
      'account',
      'dashboard',
      'branches',
      'collections',
      'reports',
      'applications',
      'members',
      'teams',
      'content',
      'audit',
    ]);
    expect(ids('finance_reviewer')).toEqual([
      'account',
      'dashboard',
      'branches',
      'collections',
      'reports',
      'audit',
    ]);
    expect(ids('branch_lead')).toEqual([
      'account',
      'branches',
      'collections',
      'reports',
      'members',
      'teams',
    ]);
    expect(ids('hr_lead')).toEqual(['account', 'branches', 'applications', 'members', 'teams']);
    expect(ids('content_editor')).toEqual(['account', 'content']);
  });
});

describe.each(LOCALES)('shells in %s', (locale) => {
  const other = locale === 'en' ? 'ur' : 'en';

  function expectChrome() {
    const switcher = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('hreflang') === other);
    expect(switcher).toHaveLength(1);
    expect(switcher[0]).toHaveAttribute('href', expect.stringMatching(new RegExp(`^/${other}`)));
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    expect(document.getElementById('main')).not.toBeNull();
  }

  it('AppShell renders items, switcher, theme toggle, skip link and user slot', () => {
    const items = navForRole(allLive(appNav), 'finance_reviewer');
    renderWithIntl(
      <AppShell items={items} userSlot={<span data-testid="user">Amina</span>}>
        <p>content</p>
      </AppShell>,
      { locale, namespaces: NAMESPACES },
    );

    const primary = screen.getByRole('navigation', { name: text(locale, 'appNavLabel') });
    const links = within(primary).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(items.map((i) => i.href));
    expect(within(primary).getByRole('link', { current: 'page' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    expect(screen.getByTestId('user')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: text(locale, 'skipToContent') })).toHaveAttribute(
      'href',
      '#main',
    );
    expectChrome();
  });

  it('AppShell without items renders no primary nav but keeps the switcher', () => {
    renderWithIntl(<AppShell items={[]}>x</AppShell>, { locale, namespaces: NAMESPACES });
    expect(screen.queryByRole('navigation', { name: text(locale, 'appNavLabel') })).toBeNull();
    expectChrome();
  });

  it('PublicShell renders the seven public links, switcher, theme toggle and footer', () => {
    renderWithIntl(
      <PublicShell>
        <h1>page</h1>
      </PublicShell>,
      { locale, namespaces: NAMESPACES },
    );

    const main = screen.getByRole('navigation', { name: text(locale, 'publicNavLabel') });
    expect(
      within(main)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(publicNav.map((i) => i.href));
    expect(screen.getByRole('contentinfo')).toHaveTextContent(text(locale, 'footer.tagline'));
    expectChrome();
  });

  it('MinimalShell wraps children with the brand, switcher and theme toggle', () => {
    renderWithIntl(
      <MinimalShell>
        <p>sign in form</p>
      </MinimalShell>,
      { locale, namespaces: NAMESPACES },
    );

    expect(screen.getByRole('link', { name: 'ShipLens' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('main')).toHaveTextContent('sign in form');
    expectChrome();
  });
});

describe('shell sources', () => {
  it('use only logical direction classes', () => {
    for (const file of [
      'AppShell.tsx',
      'PublicShell.tsx',
      'MinimalShell.tsx',
      'shell-session.tsx',
    ]) {
      const source = readFileSync(path.resolve(import.meta.dirname, file), 'utf8');
      expect(findPhysicalDirection(source, file), file).toEqual([]);
    }
  });

  it('keep MinimalShell free of server-only APIs', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, 'MinimalShell.tsx'), 'utf8');
    expect(source).not.toMatch(/next\/headers|async function|server-only/);
  });
});
