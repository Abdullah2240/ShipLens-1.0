'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ui';
import { Link, usePathname } from '@/i18n/navigation';
import { BrandLink, SkipLink } from './MinimalShell';
import type { NavItem } from './nav';

// Takes already role-filtered items and an optional user slot; it knows nothing about
// sessions. Naskh and Latin only: Nastaliq belongs to the public layout.

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  items,
  userSlot,
  children,
}: {
  items: NavItem[];
  userSlot?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('shell');
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-30 border-b border-border bg-surface-raised">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 md:px-6">
          <BrandLink />
          {items.length > 0 ? (
            <nav
              aria-label={t('appNavLabel')}
              className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 pb-1 md:order-none md:mx-0 md:w-auto md:flex-1 md:px-0 md:pb-0"
            >
              <ul className="flex min-w-max items-center gap-1">
                {items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`inline-flex h-9 items-center rounded-lg px-3 text-sm transition-colors ${
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
          ) : null}
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            {userSlot}
          </div>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-6 md:py-10"
      >
        {children}
      </main>
    </div>
  );
}
