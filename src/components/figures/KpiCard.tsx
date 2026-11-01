import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export type KpiTone = 'primary' | 'neutral' | 'pending' | 'success' | 'warning';

export type KpiCardProps = {
  label: ReactNode;
  value: ReactNode;
  href?: string;
  /** Accessible name for the value link; defaults to the value plus "View breakdown". */
  linkLabel?: string;
  hint?: ReactNode;
  tone?: KpiTone;
  /** Header slot at the inline end, for an explain trigger. */
  explain?: ReactNode;
  emphasis?: 'hero' | 'default';
};

// Full class strings so Tailwind can see them.
const DOT: Record<KpiTone, string> = {
  primary: 'bg-primary',
  neutral: 'bg-border-strong',
  pending: 'bg-tone-pending-fg',
  success: 'bg-tone-success-fg',
  warning: 'bg-tone-warning-fg',
};

const VALUE_SIZE = {
  hero: 'text-4xl sm:text-5xl font-semibold tracking-tight',
  default: 'text-2xl sm:text-[1.75rem] font-semibold tracking-tight',
} as const;

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="size-4 shrink-0 self-center text-text-muted transition-colors group-hover/value:text-primary rtl:-scale-x-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8h9M8.5 4l4 4-4 4" />
    </svg>
  );
}

export function KpiCard({
  label,
  value,
  href,
  linkLabel,
  hint,
  tone = 'neutral',
  explain,
  emphasis = 'default',
}: KpiCardProps) {
  const t = useTranslations('dashboard.card');
  const hero = emphasis === 'hero';

  return (
    <article
      data-tone={tone}
      data-emphasis={emphasis}
      className={`flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface-raised shadow-card ${hero ? 'p-6 sm:p-7' : 'p-5'}`}
    >
      <header className="flex items-start gap-3">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-text-muted">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${DOT[tone]}`} />
          <span className="min-w-0">{label}</span>
        </p>
        {explain ? <div className="ms-auto shrink-0">{explain}</div> : null}
      </header>

      <div data-kpi-value className={`tabular leading-none text-text ${VALUE_SIZE[emphasis]}`}>
        {href ? (
          <Link
            href={href}
            aria-label={linkLabel}
            className="group/value inline-flex max-w-full items-baseline gap-2 rounded-md decoration-primary/40 decoration-2 underline-offset-[0.2em] outline-offset-4 hover:text-primary hover:underline"
          >
            <span className="min-w-0">{value}</span>{' '}
            {linkLabel ? null : <span className="sr-only">{t('viewBreakdown')}</span>}
            <ArrowIcon />
          </Link>
        ) : (
          value
        )}
      </div>

      {hint ? <div className="text-sm leading-snug text-text-muted">{hint}</div> : null}
    </article>
  );
}
