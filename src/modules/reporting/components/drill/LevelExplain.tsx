'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMonth } from '@/components/figures';
import { ExplainDrawer, type ExplainFilterChip, type ExplainIdentity } from '@/components/trace';
import { Bdi, IdText } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import type { Explanation } from '@/modules/reporting/types';
import { filterChipTexts } from '../dashboard/dashboard-view-model';

export interface LevelExplainProps {
  explain: Explanation;
  value: ReactNode;
  /** Shown on the branch chip; the short branch id is used without it. */
  branchName?: string;
  /** Shown on the report chip, for example "Week of 31 Aug 2026". */
  reportLabel?: ReactNode;
  identities?: ExplainIdentity[];
  triggerVariant?: 'icon' | 'text';
  triggerLabel?: string;
}

/** Maps a service Explanation onto the "How is this calculated" drawer. */
export function LevelExplain({
  explain,
  value,
  branchName,
  reportLabel,
  identities,
  triggerVariant,
  triggerLabel,
}: LevelExplainProps) {
  const t = useTranslations('dashboard.filters');
  const tf = useTranslations('trace.filter');
  const locale = useLocale() as Locale;

  const chips: ExplainFilterChip[] = filterChipTexts(explain.filters, {
    t: (key, values) => t(key, values),
    allTime: tf('allTime'),
    formatMonth: (month) => formatMonth(month, locale),
    branchName,
  }).map((chip) => {
    if (chip.kind === 'report' && reportLabel) return { label: chip.label, value: reportLabel };
    return {
      label: chip.label,
      value: chip.isId ? (
        <IdText id={chip.text} mono />
      ) : chip.kind === 'branch' ? (
        <Bdi>{chip.text}</Bdi>
      ) : (
        <bdi>{chip.text}</bdi>
      ),
    };
  });

  return (
    <ExplainDrawer
      figure={explain.figure}
      value={value}
      recordCount={explain.recordCount}
      asOf={explain.asOf}
      filters={chips}
      identities={identities}
      triggerVariant={triggerVariant}
      triggerLabel={triggerLabel}
    />
  );
}
