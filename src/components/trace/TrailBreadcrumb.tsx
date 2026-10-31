import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export interface TrailCrumb {
  label: ReactNode;
  sublabel?: ReactNode;
  value?: ReactNode;
  href?: string;
}

export interface TrailBreadcrumbProps {
  crumbs: TrailCrumb[];
}

function CrumbBody({ crumb, current }: { crumb: TrailCrumb; current: boolean }) {
  return (
    <>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={`truncate font-medium ${
            current ? 'text-text' : 'text-primary group-hover:underline'
          } underline-offset-4`}
        >
          {crumb.label}
        </span>
        {crumb.sublabel ? <span className="truncate text-text-muted">{crumb.sublabel}</span> : null}
      </span>
      {crumb.value !== undefined && crumb.value !== null ? (
        <span
          className={`block text-xs font-semibold tabular-nums tracking-tight ${
            current ? 'text-text' : 'text-text-muted'
          }`}
        >
          <bdi dir="ltr">{crumb.value}</bdi>
        </span>
      ) : null}
    </>
  );
}

/**
 * The trail of numbers: every level of a drill-down with the figure it carried,
 * so the chain reads like a ledger from the dashboard to the evidence.
 */
export function TrailBreadcrumb({ crumbs }: TrailBreadcrumbProps) {
  const t = useTranslations('trace.breadcrumb');

  return (
    <nav aria-label={t('label')} className="text-sm">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          const box =
            'flex max-w-[16rem] flex-col justify-center rounded-lg px-2.5 py-1 leading-snug';
          return (
            <li key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <svg
                  data-trail-separator=""
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  className="size-3.5 shrink-0 text-border-strong rtl:-scale-x-100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 3.5 10.5 8 6 12.5" />
                </svg>
              ) : null}
              {current || !crumb.href ? (
                <span
                  aria-current={current ? 'page' : undefined}
                  className={`${box} ${
                    current
                      ? 'border border-border bg-surface-raised shadow-[0_1px_0_var(--color-border)]'
                      : ''
                  }`}
                >
                  <CrumbBody crumb={crumb} current={current} />
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className={`group ${box} transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken`}
                >
                  <CrumbBody crumb={crumb} current={false} />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
