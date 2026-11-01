import { Fragment, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { formatDate, formatDateTime, formatId, formatMoney } from '@/platform/i18n/format';

// Mixed-direction values. Ltr isolates machine values (IDs, codes, emails, phones,
// request ids, amounts) so they keep their order inside Urdu text. Bdi isolates
// user-entered names with automatic direction; DateText isolates dates the same way.

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

  // Automatic direction: an Urdu date starts with digits then an Urdu month name and
  // must read right to left; an English date reads left to right. Digits stay Latin.
  return (
    <bdi dir="auto" className={cx('[unicode-bidi:isolate] tabular whitespace-nowrap', className)}>
      <time dateTime={machine}>{text}</time>
    </bdi>
  );
}

// Translated sentences with an isolated value: pass slot(n) as the message value, then
// fillSlots puts the nodes (for example <Bdi>{name}</Bdi>) where the markers landed. The
// visible text is unchanged; only the value gets its own isolate. Markers are private-use
// characters that never occur in messages.
const SLOT_BASE = 0xe000;
const SLOT_RE = /([\ue000-\ue00f])/;

export function slot(index = 0): string {
  return String.fromCharCode(SLOT_BASE + index);
}

export function fillSlots(text: string, nodes: ReactNode[]): ReactNode {
  const parts = text.split(SLOT_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? <Fragment key={i}>{nodes[part.charCodeAt(0) - SLOT_BASE]}</Fragment> : part,
  );
}
