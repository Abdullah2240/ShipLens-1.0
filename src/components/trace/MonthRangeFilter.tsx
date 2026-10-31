'use client';

import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

export interface MonthRangeFilterProps {
  /** 'YYYY-MM' PKT months, ascending. */
  months: string[];
  from?: string;
  to?: string;
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const INTL_LOCALE: Record<string, string> = { en: 'en-GB-u-nu-latn', ur: 'ur-PK-u-nu-latn' };

function monthLabel(month: string, locale: string): string {
  const match = MONTH_RE.exec(month);
  if (!match) return month;
  // Mid-month at UTC noon: no host zone can move it into a neighbouring month.
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15, 12));
  return new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? INTL_LOCALE.en, {
    calendar: 'gregory',
    numberingSystem: 'latn',
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** Month range in the URL: sets or removes from/to, keeps other parameters, resets paging. */
export function MonthRangeFilter({ months, from, to }: MonthRangeFilterProps) {
  const t = useTranslations('trace.filter');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromId = useId();
  const toId = useId();
  const [start, setStart] = useState(from ?? '');
  const [end, setEnd] = useState(to ?? '');
  // Back and forward navigation hands in new props: follow them.
  const [shown, setShown] = useState({ from, to });
  if (shown.from !== from || shown.to !== to) {
    setShown({ from, to });
    setStart(from ?? '');
    setEnd(to ?? '');
  }

  function navigate(range: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    for (const [key, value] of searchParams?.entries() ?? []) {
      if (key === 'from' || key === 'to' || key === 'page') continue;
      params.append(key, value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let lo = start;
    let hi = end;
    if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
    setStart(lo);
    setEnd(hi);
    navigate({ from: lo || undefined, to: hi || undefined });
  }

  function clear() {
    setStart('');
    setEnd('');
    navigate({});
  }

  const options = months.map((month) => (
    <option key={month} value={month}>
      {monthLabel(month, locale)}
    </option>
  ));
  const select =
    'block w-full min-w-[10rem] rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text shadow-[0_1px_0_var(--color-border)] transition-colors hover:border-border-strong/60 focus-visible:border-primary';

  return (
    <form onSubmit={apply} className="w-full sm:w-auto">
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-2 text-xs font-semibold tracking-[0.08em] text-text-muted uppercase rtl:tracking-normal">
          {t('legend')}
        </legend>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
          <label htmlFor={fromId} className="text-xs text-text-muted">
            {t('from')}
          </label>
          <select
            id={fromId}
            name="from"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={select}
          >
            <option value="">{t('allTime')}</option>
            {options}
          </select>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
          <label htmlFor={toId} className="text-xs text-text-muted">
            {t('to')}
          </label>
          <select
            id={toId}
            name="to"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={select}
          >
            <option value="">{t('allTime')}</option>
            {options}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-hover"
          >
            {t('apply')}
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-text-muted transition-colors hover:bg-surface-sunken hover:text-text"
          >
            {t('clear')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
