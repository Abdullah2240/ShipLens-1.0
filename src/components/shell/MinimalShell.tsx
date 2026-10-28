import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/ui';
import { Link } from '@/i18n/navigation';

// Shared by the three shells. Nothing request-bound here: error.tsx is a client component
// and renders MinimalShell too.

export function SkipLink() {
  const t = useTranslations('shell');
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-contrast"
    >
      {t('skipToContent')}
    </a>
  );
}

export function BrandLink({ large = false }: { large?: boolean }) {
  const t = useTranslations('common');
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 rounded-lg font-semibold tracking-tight text-text"
    >
      <svg
        viewBox="0 0 32 32"
        className={large ? 'size-9' : 'size-8'}
        fill="none"
        aria-hidden="true"
      >
        <rect width="32" height="32" rx="9" className="fill-primary" />
        <circle cx="16" cy="15" r="6.5" className="stroke-primary-contrast" strokeWidth="2" />
        <path
          d="M7 22.5c2.2 1.6 4.6 1.6 6.8 0s4.6-1.6 6.8 0 3.2 1.1 4.4.2"
          className="stroke-accent-soft"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <span className={large ? 'text-xl' : 'text-lg'}>{t('appName')}</span>
    </Link>
  );
}

export function MinimalShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b border-border bg-surface-raised">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 md:px-6">
          <BrandLink />
          <div className="ms-auto flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="grid flex-1 place-items-center px-4 py-12 md:px-6">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}
