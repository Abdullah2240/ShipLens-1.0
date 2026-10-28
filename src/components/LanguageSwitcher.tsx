'use client';

import { Suspense } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';

type Query = Record<string, string | string[]>;

function toQuery(params: URLSearchParams | null): Query | undefined {
  if (!params) return undefined;
  const query: Query = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length === 1 ? (values[0] ?? '') : values;
  }
  return Object.keys(query).length > 0 ? query : undefined;
}

function SwitcherLink({ query }: { query?: Query }) {
  const t = useTranslations('shell.language');
  const locale = useLocale();
  const pathname = usePathname();
  const other: Locale | undefined = routing.locales.find((l) => l !== locale);
  if (!other) return null;

  // Passing `locale` makes next-intl update the NEXT_LOCALE cookie on click, so the
  // choice is remembered; pathname is locale-less so dynamic segments are kept as-is.
  return (
    <Link
      href={{ pathname, query }}
      locale={other}
      lang={other}
      hrefLang={other}
      className="inline-flex h-8 items-center rounded-full border border-border-strong px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-sunken"
    >
      {t(other)}
    </Link>
  );
}

function WithSearchParams() {
  return <SwitcherLink query={toQuery(useSearchParams())} />;
}

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const t = useTranslations('shell.language');

  return (
    <nav aria-label={t('label')} className={className}>
      {/* useSearchParams opts a statically rendered tree out of prerendering; the
          fallback is the same link without the query string. */}
      <Suspense fallback={<SwitcherLink />}>
        <WithSearchParams />
      </Suspense>
    </nav>
  );
}
