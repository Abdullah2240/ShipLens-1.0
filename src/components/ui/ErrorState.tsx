'use client';

import { useTranslations } from 'next-intl';

export type ErrorStateProps = {
  title?: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
};

export function ErrorState({ title, body, onRetry, retryLabel }: ErrorStateProps) {
  const t = useTranslations('common');

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card border border-tone-danger-fg/30 bg-tone-danger-bg px-6 py-10 text-center"
    >
      <svg
        viewBox="0 0 48 48"
        className="size-10 text-tone-danger-fg"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="24" cy="24" r="16" />
        <path d="M24 15v11M24 32v1" />
      </svg>
      <h3 className="text-base font-semibold text-tone-danger-fg">
        {title ?? t('states.errorTitle')}
      </h3>
      <p className="max-w-sm text-sm text-tone-danger-fg">{body ?? t('states.errorBody')}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-danger-contrast transition-colors hover:bg-danger-hover"
        >
          {retryLabel ?? t('actions.retry')}
        </button>
      ) : null}
    </div>
  );
}
