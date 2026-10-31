'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

export interface LogoutButtonProps {
  /** `compact` fits the app header; `default` is the full-size button on the account page. */
  variant?: 'default' | 'compact';
}

const ENDPOINT = '/api/v1/auth/logout';

const VARIANTS = {
  default:
    'h-11 gap-2 rounded-xl border border-border-strong bg-surface-raised px-5 text-sm font-semibold text-text hover:border-danger hover:bg-tone-danger-bg hover:text-tone-danger-fg',
  compact:
    'h-8 gap-1.5 rounded-full border border-border-strong px-3 text-sm font-semibold text-text hover:bg-surface-sunken',
} as const;

export function LogoutButton({ variant = 'default' }: LogoutButtonProps) {
  const t = useTranslations('auth.account');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  async function onClick() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      // The server revokes the session row and clears the cookie (204). Any failure,
      // such as a session that had already expired, still ends at the login page.
      await fetch(ENDPOINT, { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Network failure: the login page will show whether the session is still live.
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-progress disabled:opacity-75 ${VARIANTS[variant]}`}
    >
      {pending ? (
        <svg
          viewBox="0 0 24 24"
          className="size-4 animate-spin motion-reduce:animate-none"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="2.5"
          />
          <path
            d="M21 12a9 9 0 00-9-9"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 20 20"
          className="size-4 rtl:-scale-x-100"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 3.5H5.5a2 2 0 00-2 2v9a2 2 0 002 2H8M13 6.5L16.5 10 13 13.5M16.5 10H8" />
        </svg>
      )}
      <span>{pending ? t('loggingOut') : t('logout')}</span>
    </button>
  );
}
