import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { KpiCard, type KpiTone } from '@/components/figures';
import { Ltr } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import { formatInt } from '@/platform/i18n/format';
import { LevelExplain } from '../drill/LevelExplain';
import type { DashboardModel, FigureCardModel } from './dashboard-view-model';

/** Active branches and reports awaiting review: quieter cards beside the money flow. */
export function CountFigures({ model }: { model: DashboardModel }) {
  const t = useTranslations('dashboard');
  const tf = useTranslations('trace.figures');
  const locale = useLocale() as Locale;
  const titleId = useId();

  const cards: { card: FigureCardModel; tone: KpiTone; hint: string }[] = [
    { card: model.activeBranches, tone: 'primary', hint: t('counts.activeBranchesHint') },
    { card: model.awaitingReview, tone: 'pending', hint: t('counts.awaitingHint') },
  ];

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
      <h2 id={titleId} className="text-sm font-semibold text-text">
        {t('counts.title')}
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {cards.map(({ card, tone, hint }) => {
          const label = tf(`${card.figure}.label`);
          const value = formatInt(card.value, locale);
          return (
            <KpiCard
              key={card.figure}
              label={label}
              tone={tone}
              value={<Ltr>{value}</Ltr>}
              href={card.href}
              linkLabel={t('flow.figureLink', { figure: label, value })}
              hint={hint}
              explain={
                <LevelExplain
                  triggerVariant="icon"
                  explain={model.explain[card.figure]}
                  value={value}
                />
              }
            />
          );
        })}
      </div>
    </section>
  );
}
