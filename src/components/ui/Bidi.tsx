import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { formatDate, formatDateTime, formatId, formatMoney } from '@/platform/i18n/format';

// Mixed-direction values. Ltr isolates machine values (IDs, codes, emails, phones,
// request ids, amounts, dates) so they keep their order inside Urdu text. Bdi isolates
// user-entered names with automatic direction.

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cx('[unicode-bidi:isolate]', className)}>
      {children}
    </bdi>
  );
}

export function Bdi({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi className={className}>{children}</bdi>;
}

export function MoneyText({ amount, className }: { amount: string; className?: string }) {
  const locale = useLocale() as Locale;
  return (
    <Ltr className={cx('tabular whitespace-nowrap', className)}>{formatMoney(amount, locale)}</Ltr>
  );
}

export function IdText({
  id,
  mono,
  className,
}: {
  id: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <Ltr className={cx(mono && 'font-mono text-[0.92em] tracking-tight', className)}>
      {formatId(id)}
    </Ltr>
  );
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/;

export function DateText({
  value,
  withTime,
  className,
}: {
  value: string | Date;
  withTime?: boolean;
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const asInstant =
    value instanceof Date ? value : withTime || ISO_INSTANT.test(value) ? new Date(value) : null;
  const text = asInstant
    ? withTime
      ? formatDateTime(asInstant, locale)
      : formatDate(asInstant, locale)
    : formatDate(value as string, locale);
  const machine = asInstant ? asInstant.toISOString() : (value as string);

  return (
    <Ltr className={cx('tabular whitespace-nowrap', className)}>
      <time dateTime={machine}>{text}</time>
    </Ltr>
  );
}
