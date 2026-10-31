import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatInt } from '@/platform/i18n/format';

export interface PagerProps {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}

const control =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition-colors';
const enabled = `${control} border-border-strong/50 bg-surface-raised text-text shadow-xs hover:border-border-strong hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`;
const disabled = `${control} cursor-not-allowed border-border bg-transparent text-text-muted/70`;

function Arrow({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4 shrink-0 rtl:-scale-x-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === 'back' ? 'M12 5l-5 5 5 5' : 'M8 5l5 5-5 5'} />
    </svg>
  );
}

function Step({ href, children }: { href: string | null; children: ReactNode }) {
  return href ? (
    <Link href={href} className={enabled}>
      {children}
    </Link>
  ) : (
    <span aria-disabled="true" className={disabled}>
      {children}
    </span>
  );
}

/** Previous and next links for a server-paginated list. Works without client scripting. */
export function Pager({ page, pageSize, total, hrefFor }: PagerProps) {
  const t = useTranslations('common.pager');
  const locale = useLocale() as Locale;
  if (total <= 0) return null;

  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.max(1, Math.trunc(page));
  const previous = current > 1 ? hrefFor(Math.min(current - 1, pages)) : null;
  const next = current < pages ? hrefFor(current + 1) : null;

  return (
    <nav
      aria-label={t('label')}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
    >
      <p className="text-sm text-text-muted tabular">
        {t('pageOf', { page: formatInt(current, locale), pages: formatInt(pages, locale) })}
      </p>
      <div className="flex items-center gap-2">
        <Step href={previous}>
          <Arrow direction="back" />
          {t('previous')}
        </Step>
        <Step href={next}>
          {t('next')}
          <Arrow direction="forward" />
        </Step>
      </div>
    </nav>
  );
}
