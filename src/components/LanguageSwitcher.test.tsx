// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../tests/support/render-intl';
import { LanguageSwitcher } from './LanguageSwitcher';

const nav = vi.hoisted(() => ({ pathname: '/en', search: '' }));

// next-intl's createNavigation imports 'next/navigation' without an extension, which Node
// ESM cannot resolve under Vitest, so the navigation module is replaced by a stand-in
// that builds hrefs the way next-intl does for localePrefix 'always': /<locale><pathname>?<query>.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => nav.pathname.replace(/^\/(en|ur)(?=\/|$)/, '') || '/',
  Link: ({
    href,
    locale,
    children,
    ...rest
  }: {
    href: { pathname: string; query?: Record<string, string | string[]> } | string;
    locale: string;
    children: ReactNode;
  } & Record<string, unknown>) => {
    const { pathname, query } =
      typeof href === 'string' ? { pathname: href, query: undefined } : href;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
    }
    const search = params.size > 0 ? `?${params.toString()}` : '';
    const base = pathname === '/' ? '' : pathname;
    return (
      <a href={`/${locale}${base}${search}`} {...rest}>
        {children}
      </a>
    );
  },
}));

function setLocation(pathname: string, search = '') {
  nav.pathname = pathname;
  nav.search = search;
}

beforeEach(() => setLocation('/en'));

describe('LanguageSwitcher', () => {
  it('links to the other locale and keeps path, dynamic segment and query', () => {
    setLocation('/en/branches/abc', 'status=active');
    renderWithIntl(<LanguageSwitcher />, { namespaces: ['shell'] });

    const link = screen.getByRole('link', { name: 'اردو' });
    expect(link).toHaveAttribute('href', '/ur/branches/abc?status=active');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'English' })).toBeNull();
  });

  it('keeps repeated query keys', () => {
    setLocation('/en/reports', 'status=draft&status=returned&page=2');
    renderWithIntl(<LanguageSwitcher />, { namespaces: ['shell'] });

    const href = screen.getByRole('link', { name: 'اردو' }).getAttribute('href') ?? '';
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/ur/reports');
    expect(url.searchParams.getAll('status')).toEqual(['draft', 'returned']);
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('labels the language in its own script with lang and hreflang', () => {
    renderWithIntl(<LanguageSwitcher />, { namespaces: ['shell'] });

    const link = screen.getByRole('link', { name: 'اردو' });
    expect(link).toHaveAttribute('lang', 'ur');
    expect(link).toHaveAttribute('hreflang', 'ur');
    expect(screen.getByRole('navigation', { name: 'Language' })).toBeInTheDocument();
  });

  it('points from the Urdu root to the English root with a localised label', () => {
    setLocation('/ur');
    renderWithIntl(<LanguageSwitcher />, { locale: 'ur', namespaces: ['shell'] });

    const link = screen.getByRole('link', { name: 'English' });
    expect(link).toHaveAttribute('href', '/en');
    expect(link).toHaveAttribute('lang', 'en');
    expect(link).toHaveAttribute('hreflang', 'en');
    expect(screen.getByRole('navigation', { name: 'زبان' })).toBeInTheDocument();
  });

  it('preserves nested paths when switching from Urdu', () => {
    setLocation('/ur/people/members/42', 'q=ali');
    renderWithIntl(<LanguageSwitcher />, { locale: 'ur', namespaces: ['shell'] });

    expect(screen.getByRole('link', { name: 'English' })).toHaveAttribute(
      'href',
      '/en/people/members/42?q=ali',
    );
  });

  it('uses only logical direction classes', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, 'LanguageSwitcher.tsx'), 'utf8');
    expect(findPhysicalDirection(source, 'LanguageSwitcher.tsx')).toEqual([]);
  });
});
