import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

export type EmptyStateProps = { title?: string; body?: string; action?: ReactNode };

export function EmptyState({ title, body, action }: EmptyStateProps) {
  const t = useTranslations('common.states');

  return (
    <div
      role="status"
      className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border-strong/60 bg-surface-raised px-6 py-12 text-center"
    >
      <svg
        viewBox="0 0 48 48"
        className="size-12 text-accent"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 18l16-8 16 8-16 8-16-8zM8 18v14l16 8 16-8V18M24 26v14" />
      </svg>
      <h3 className="text-base font-semibold text-text">{title ?? t('emptyTitle')}</h3>
      <p className="max-w-sm text-sm text-text-muted">{body ?? t('emptyBody')}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
