// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { findPhysicalDirection } from '../../../scripts/lib/logical-css.mjs';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { Pager } from './Pager';

// next-intl's createNavigation cannot be imported under Vitest (see LanguageSwitcher.test).
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const LOCALES = ['en', 'ur'] as const;
type Locale = (typeof LOCALES)[number];

function pagerMsg(locale: Locale, key: string, values: Record<string, string> = {}): string {
  const file = path.resolve(import.meta.dirname, `../../../messages/${locale}/common.json`);
  const pager = (JSON.parse(readFileSync(file, 'utf8')) as { pager: Record<string, string> }).pager;
  const value = pager[key];
  if (typeof value !== 'string') throw new Error(`missing common.pager.${key} (${locale})`);
  return value.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
}

const hrefFor = (page: number) => `/people/members?q=ali&page=${page}`;

describe.each(LOCALES)('Pager (%s)', (locale) => {
  const m = (key: string, values?: Record<string, string>) => pagerMsg(locale, key, values);

  it('renders page X of Y with previous and next links from hrefFor', () => {
    const { container } = renderWithIntl(
      <Pager page={2} pageSize={25} total={60} hrefFor={hrefFor} />,
      { locale },
    );
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    const nav = screen.getByRole('navigation', { name: m('label') });
    expect(within(nav).getByText(m('pageOf', { page: '2', pages: '3' }))).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: m('previous') })).toHaveAttribute(
      'href',
      '/people/members?q=ali&page=1',
    );
    expect(within(nav).getByRole('link', { name: m('next') })).toHaveAttribute(
      'href',
      '/people/members?q=ali&page=3',
    );
  });

  it('renders previous as disabled text on the first page', () => {
    renderWithIntl(<Pager page={1} pageSize={25} total={60} hrefFor={hrefFor} />, { locale });
    expect(screen.queryByRole('link', { name: m('previous') })).toBeNull();
    const previous = screen.getByText(m('previous')).closest('[aria-disabled]');
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(previous?.tagName).not.toBe('A');
    expect(screen.getByRole('link', { name: m('next') })).toHaveAttribute(
      'href',
      '/people/members?q=ali&page=2',
    );
  });

  it('renders next as disabled text on the last page', () => {
    renderWithIntl(<Pager page={3} pageSize={25} total={60} hrefFor={hrefFor} />, { locale });
    expect(screen.getByText(m('pageOf', { page: '3', pages: '3' }))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: m('next') })).toBeNull();
    expect(screen.getByText(m('next')).closest('[aria-disabled]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('link', { name: m('previous') })).toBeInTheDocument();
  });

  it('shows a single page with both controls disabled', () => {
    renderWithIntl(<Pager page={1} pageSize={25} total={4} hrefFor={hrefFor} />, { locale });
    expect(screen.getByText(m('pageOf', { page: '1', pages: '1' }))).toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('points previous at the last page when the page is past the end', () => {
    renderWithIntl(<Pager page={9} pageSize={25} total={60} hrefFor={hrefFor} />, { locale });
    expect(screen.getByRole('link', { name: m('previous') })).toHaveAttribute(
      'href',
      '/people/members?q=ali&page=3',
    );
    expect(screen.queryByRole('link', { name: m('next') })).toBeNull();
  });

  it('renders nothing when there are no rows', () => {
    const { container } = renderWithIntl(
      <Pager page={1} pageSize={25} total={0} hrefFor={hrefFor} />,
      { locale },
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('mirrors the arrow glyphs in right-to-left layouts', () => {
    const { container } = renderWithIntl(
      <Pager page={2} pageSize={25} total={60} hrefFor={hrefFor} />,
      { locale },
    );
    const arrows = container.querySelectorAll('svg');
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) {
      expect(arrow.getAttribute('class')).toContain('rtl:-scale-x-100');
      expect(arrow).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('Pager source', () => {
  it('uses logical direction utilities only', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, 'Pager.tsx'), 'utf8');
    expect(findPhysicalDirection(source, 'Pager.tsx')).toEqual([]);
  });
});
