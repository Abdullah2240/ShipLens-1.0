import type { ReactNode } from 'react';
import { formatDate, formatDateTime } from '@/platform/i18n/format';

export type VerifyLocale = 'en' | 'ur';

/** Rich-text tag for machine values (numbers, codes, times) inside translated sentences. */
export function ltr(chunks: ReactNode) {
  return (
    <bdi dir="ltr" className="tabular [unicode-bidi:isolate]">
      {chunks}
    </bdi>
  );
}

const STORED_CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'ABCDE-FGHJK' for a stored code; anything else (already formatted) is shown as given. */
export function displayCode(code: string): string {
  return STORED_CODE.test(code) ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** Seal hex in groups of four: '0123 4567 89ab cdef'. */
export function groupSeal(seal: string): string {
  return (seal.match(/.{1,4}/g) ?? []).join(' ');
}

/** Instant in PKT; an unparseable value is shown as given rather than breaking the page. */
export function dateTimeText(value: string, locale: VerifyLocale): string {
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? value : formatDateTime(instant, locale);
}

/** Business date (YYYY-MM-DD) or an instant, shown as a PKT calendar date. */
export function dateText(value: string, locale: VerifyLocale): string {
  try {
    return BUSINESS_DATE.test(value)
      ? formatDate(value, locale)
      : formatDate(new Date(value), locale);
  } catch {
    return value;
  }
}

type IconName =
  'shieldCheck' | 'shieldX' | 'shieldAlert' | 'linkBroken' | 'circleDashed' | 'lock' | 'check';

const ICON_PATHS: Record<IconName, string> = {
  shieldCheck: 'M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3zM9 12l2.2 2.2L15.5 10',
  shieldX: 'M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3zM9.6 9.6l4.8 4.8M14.4 9.6l-4.8 4.8',
  shieldAlert: 'M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3zM12 8.5v4.5M12 16.2v.1',
  linkBroken:
    'M9.5 14.5L8 16a3 3 0 01-4.2-4.2L6.5 9M14.5 9.5L16 8a3 3 0 014.2 4.2L17.5 15M8.5 3.5v2.5M3.5 8.5H6M15.5 20.5V18M20.5 15.5H18',
  circleDashed:
    'M12 3.5a8.5 8.5 0 012.9.5M18.4 6.4a8.5 8.5 0 011.6 2.9M20.5 12a8.5 8.5 0 01-.5 2.9M17.6 18.4a8.5 8.5 0 01-2.7 1.6M12 20.5a8.5 8.5 0 01-2.9-.5M5.6 17.6A8.5 8.5 0 014 14.9M3.5 12a8.5 8.5 0 01.5-2.9M6.4 5.6a8.5 8.5 0 012.7-1.6',
  lock: 'M7 11V8a5 5 0 0110 0v3M5.5 11h13v9.5h-13zM12 14.5v2.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'size-5 shrink-0'}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
