import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';

export interface ExplainFilterChip {
  label: string;
  value: ReactNode;
}

export interface TraceHeaderProps {
  eyebrow: ReactNode;
  title: ReactNode;
  value?: ReactNode;
  meta?: ReactNode;
  chips?: ExplainFilterChip[];
  actions?: ReactNode;
  trail?: ReactNode;
}

export function FilterChips({ chips, label }: { chips: ExplainFilterChip[]; label: string }) {
  return (
    <dl aria-label={label} className="flex flex-wrap gap-2">
      {chips.map((chip, index) => (
        <div
          key={index}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1 text-xs leading-5"
        >
          <dt className="text-text-muted">{chip.label}</dt>
          <dd className="font-semibold text-text">{chip.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Level header for drill-down pages: trail, eyebrow, title, headline figure, filters. */
export function TraceHeader({
  eyebrow,
  title,
  value,
  meta,
  chips,
  actions,
  trail,
}: TraceHeaderProps) {
  const t = useTranslations('trace.explain');

  return (
    <header className="flex flex-col gap-5 border-b border-border pb-6">
      {trail ? <div className="-ms-2.5">{trail}</div> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase rtl:tracking-normal">
            {eyebrow}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-text text-balance sm:text-3xl rtl:tracking-normal">
            {title}
          </h1>
          {value !== undefined && value !== null ? (
            <p className="mt-1 text-[2rem] leading-none font-semibold tabular-nums tracking-tight text-text sm:text-[2.5rem]">
              <bdi dir="ltr">{value}</bdi>
            </p>
          ) : null}
          {meta ? <div className="mt-1 text-sm text-text-muted">{meta}</div> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ms-auto sm:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
      {chips && chips.length > 0 ? <FilterChips chips={chips} label={t('filters')} /> : null}
    </header>
  );
}
