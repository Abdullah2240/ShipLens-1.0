import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TrailBreadcrumb, type TrailCrumb } from '@/components/trace';
import { Bdi, DateText, IdText, MoneyText } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import { formatInt } from '@/platform/i18n/format';

/** Structural copy of the trace service's TrailStep, so callers pass it unchanged. */
export interface TrailStepLike {
  kind: 'dashboard' | 'figure' | 'branch' | 'report' | 'collection';
  href: string;
  figure: string;
  measure: 'amount' | 'count';
  value: string;
  branchCode?: string;
  branchName?: string;
  weekStart?: string;
  collectedOn?: string;
}

export interface TraceTrailProps {
  steps: TrailStepLike[];
}

/**
 * The trail of numbers for a drill-down level: Dashboard > figure > branch > week >
 * collection, each crumb carrying the value it stood for. The last step is the page.
 * The dashboard crumb carries no value: it would repeat the figure crumb beside it.
 */
export function TraceTrail({ steps }: TraceTrailProps) {
  const t = useTranslations('trace');
  const td = useTranslations('dashboard.trail');
  const locale = useLocale() as Locale;

  const valueOf = (step: TrailStepLike): ReactNode =>
    step.measure === 'amount' ? (
      <MoneyText amount={step.value} />
    ) : (
      <span className="tabular">{formatInt(step.value, locale)}</span>
    );

  const crumbs: TrailCrumb[] = steps.map((step) => {
    switch (step.kind) {
      case 'dashboard':
        return { label: t('breadcrumb.dashboard'), href: step.href };
      case 'figure': {
        const key = `figures.${step.figure}.short`;
        return {
          label: t.has(key) ? t(key) : step.figure,
          value: valueOf(step),
          href: step.href,
        };
      }
      case 'branch':
        return {
          label: step.branchCode ? <IdText id={step.branchCode} /> : null,
          sublabel: step.branchName ? <Bdi>{step.branchName}</Bdi> : undefined,
          value: valueOf(step),
          href: step.href,
        };
      case 'report':
        return {
          label: step.weekStart
            ? td.rich('weekOf', { date: () => <DateText value={step.weekStart ?? ''} /> })
            : null,
          value: valueOf(step),
          href: step.href,
        };
      case 'collection':
        return {
          label: step.collectedOn ? <DateText value={step.collectedOn} /> : null,
          value: valueOf(step),
          href: step.href,
        };
    }
  });

  return <TrailBreadcrumb crumbs={crumbs} />;
}
