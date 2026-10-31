import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Ltr, MoneyText } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import { formatInt } from '@/platform/i18n/format';

export interface ImpactFiguresProps {
  approvedTotal: string;
  approvedReportCount: number;
  monthsCovered: number;
  activeBranchCount: number;
  cities: number;
}

const CHECK = 'M5 12.5l4.2 4.2L19 7';

/** Concentric rings echoing a seal of approval; decorative only. */
function Seal() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 200"
      fill="none"
      className="pointer-events-none absolute -top-16 end-[-4rem] size-64 opacity-20 sm:size-72"
    >
      {[96, 76, 56].map((r) => (
        <circle key={r} cx="100" cy="100" r={r} stroke="currentColor" strokeWidth="1.5" />
      ))}
      <path
        d="M72 102l18 18 38-40"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Count({ value }: { value: number }) {
  const locale = useLocale() as Locale;
  return <Ltr className="tabular">{formatInt(value, locale)}</Ltr>;
}

function SupportingFigure({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <dl
      data-impact-figure={id}
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface-raised p-6 shadow-card"
    >
      <dt className="flex items-center gap-2 text-sm font-medium text-text-muted">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
        {label}
      </dt>
      <dd className="text-4xl leading-none font-semibold tracking-tight text-text sm:text-5xl">
        {children}
      </dd>
      <dd className="text-sm leading-snug text-text-muted">{hint}</dd>
    </dl>
  );
}

/** The approved figures: one large approved total, two supporting figures, two small ones. */
export function ImpactFigures({
  approvedTotal,
  approvedReportCount,
  monthsCovered,
  activeBranchCount,
  cities,
}: ImpactFiguresProps) {
  const t = useTranslations('impact.figures');

  return (
    <section
      aria-labelledby="impact-figures-title"
      className="relative mx-auto w-full max-w-6xl px-4 md:px-6"
    >
      <h2 id="impact-figures-title" className="sr-only">
        {t('title')}
      </h2>
      <div className="grid gap-5 lg:grid-cols-12">
        <div
          data-impact-figure="approvedTotal"
          className="relative min-w-0 overflow-hidden rounded-card bg-primary p-6 text-primary-contrast shadow-card sm:p-8 lg:col-span-7"
        >
          <Seal />
          <dl className="relative flex h-full flex-col gap-4 lg:justify-between">
            <dt className="relative flex items-center gap-2.5 text-base font-semibold">
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-contrast/15"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={CHECK} />
                </svg>
              </span>
              {t('approvedTotal')}
            </dt>
            <dd className="relative text-[clamp(1.75rem,7.5vw,4.25rem)] leading-none font-semibold tracking-tight">
              <MoneyText amount={approvedTotal} />
            </dd>
            <dd className="relative max-w-md text-sm leading-relaxed opacity-90 sm:text-base">
              {t('approvedTotalHint')}
            </dd>
          </dl>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
          <SupportingFigure id="reports" label={t('reports')} hint={t('reportsHint')}>
            <Count value={approvedReportCount} />
          </SupportingFigure>
          <SupportingFigure id="months" label={t('months')} hint={t('monthsHint')}>
            <Count value={monthsCovered} />
          </SupportingFigure>
        </div>

        <dl className="flex flex-wrap gap-x-10 gap-y-4 rounded-card border border-border bg-surface-sunken px-6 py-4 lg:col-span-12">
          {(
            [
              ['branches', t('branches'), activeBranchCount],
              ['cities', t('cities'), cities],
            ] as const
          ).map(([id, label, value]) => (
            <div key={id} data-impact-figure={id} className="flex items-baseline gap-3">
              <dt className="text-sm font-medium text-text-muted">{label}</dt>
              <dd className="order-first text-2xl font-semibold text-accent">
                <Count value={value} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
