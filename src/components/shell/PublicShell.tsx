'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ui';
import { Link, usePathname } from '@/i18n/navigation';
import { BrandLink, SkipLink } from './MinimalShell';
import { publicNav } from './nav';

// Public pages: warmer and more spacious than the app shell. Page headings opt into the
// Nastaliq display face with `font-display-ur`; it applies under lang="ur" only and
// needs the nastaliq font variable from the public layout wrapper.

export function PublicShell({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6 md:py-4">
          <BrandLink large />
          <nav
            aria-label={t('publicNavLabel')}
            className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 pb-1 md:order-none md:mx-0 md:w-auto md:flex-1 md:px-0 md:pb-0"
          >
            <ul className="flex min-w-max items-center gap-1">
              {publicNav.map((item) => {
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={`inline-flex h-9 items-center rounded-full px-3.5 text-sm transition-colors ${
                        active
                          ? 'bg-accent-soft font-semibold text-text'
                          : 'text-text-muted hover:bg-surface-sunken hover:text-text'
                      }`}
                    >
                      {t(item.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <footer className="border-t border-border bg-surface-sunken">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-start md:justify-between md:px-6">
          <div className="flex max-w-sm flex-col gap-3">
            <BrandLink />
            <p className="text-sm text-text-muted">{t('footer.tagline')}</p>
          </div>
          <p className="max-w-xs text-sm text-text-muted">{t('footer.contactPlaceholder')}</p>
        </div>
      </footer>
    </div>
  );
}
