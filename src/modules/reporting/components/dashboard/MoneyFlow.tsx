import { Fragment, useId, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { IdentityBar, type IdentitySegment, type IdentityTone } from '@/components/figures';
import { FigureLink, type ExplainIdentity } from '@/components/trace';
import { MoneyText } from '@/components/ui';
import type { Locale } from '@/i18n/routing';
import type { MoneyFigureId } from '@/modules/reporting/types';
import { formatInt, formatMoney } from '@/platform/i18n/format';
import { LevelExplain } from '../drill/LevelExplain';
import type { DashboardModel, FigureCardModel, SegmentModel } from './dashboard-view-model';

// Status tones, one meaning each across the dashboard.
export const SEGMENT_TONE: Record<MoneyFigureId, IdentityTone> = {
  collected: 'neutral',
  approved: 'success',
  pending_approval: 'pending',
  in_progress: 'neutral',
  routed: 'info',
  not_yet_routed: 'warning',
};

function IdentityTerm({ label, amount }: { label: string; amount: string }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className="text-text-muted">{label}</span>
      <MoneyText amount={amount} className="font-semibold text-text" />
    </span>
  );
}

function identityOf(
  parent: { label: string; amount: string },
  parts: { label: string; amount: string }[],
  holds: boolean,
): ExplainIdentity {
  // The identity's two operands: the whole, and its parts joined by "+".
  const whole = <IdentityTerm label={parent.label} amount={parent.amount} />;
  const sum = (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {parts.map((part, index) => (
        <Fragment key={part.label}>
          {index > 0 ? <span className="text-text-muted">+</span> : null}
          <IdentityTerm label={part.label} amount={part.amount} />
        </Fragment>
      ))}
    </span>
  );
  return { left: whole, right: sum, holds }; // logical-css-ignore: identity operands
}

function CheckMark({ holds }: { holds: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {holds ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="M8 4v5M8 11.75v.01" />}
    </svg>
  );
}

function Panel({
  eyebrow,
  headingId,
  figure,
  size,
  records,
  linkLabel,
  bar,
  explain,
  tint,
}: {
  eyebrow: ReactNode;
  headingId: string;
  figure: FigureCardModel;
  size: 'xl' | 'lg';
  records: string;
  linkLabel: string;
  bar: ReactNode;
  explain: ReactNode;
  tint?: boolean;
}) {
  const locale = useLocale() as Locale;
  return (
    <div
      data-flow-panel={figure.figure}
      className={`flex min-w-0 flex-col gap-6 px-6 py-7 sm:px-8 ${tint ? 'bg-surface-sunken/45' : ''}`}
    >
      <div className="flex flex-col gap-2">
        <h3 id={headingId} className="flex items-center gap-2 text-sm font-medium text-text-muted">
          {eyebrow}
        </h3>
        <FigureLink href={figure.href} label={linkLabel} size={size}>
          {formatMoney(figure.value, locale)}
        </FigureLink>
        <p className="text-sm text-text-muted tabular">{records}</p>
      </div>
      {bar}
      <div className="mt-auto">{explain}</div>
    </div>
  );
}

/**
 * The money-flow hero: Collected split by report status, then Approved split by where the
 * money is. Every value is a link into the drill-down; each part carries its drawer.
 */
export function MoneyFlow({ model }: { model: DashboardModel }) {
  const t = useTranslations('dashboard.flow');
  const tf = useTranslations('trace.figures');
  const locale = useLocale() as Locale;
  const titleId = useId();
  const collectedId = useId();
  const approvedId = useId();

  const label = (figure: string) => tf(`${figure}.label`);
  const linkLabel = (card: FigureCardModel) =>
    t('figureLink', { figure: label(card.figure), value: formatMoney(card.value, locale) });
  const records = (count: number) => t('records', { n: count, count: formatInt(count, locale) });
  const segments = (list: SegmentModel[]): IdentitySegment[] =>
    list.map((s) => ({
      key: s.figure,
      label: label(s.figure),
      amount: s.amount,
      href: s.href,
      tone: SEGMENT_TONE[s.figure],
    }));
  const terms = (list: SegmentModel[]) =>
    list.map((s) => ({ label: label(s.figure), amount: s.amount }));

  const collectedIdentity = identityOf(
    { label: label('collected'), amount: model.collected.value },
    terms(model.collectedSegments),
    model.identities.collected,
  );
  const approvedIdentity = identityOf(
    { label: label('approved'), amount: model.approved.value },
    terms(model.approvedSegments),
    model.identities.approved,
  );
  const holds = model.identities.collected && model.identities.approved;

  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-card border border-border bg-surface-raised shadow-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-6 py-4 sm:px-8">
        <h2
          id={titleId}
          className="text-xs font-semibold tracking-[0.14em] text-accent uppercase rtl:tracking-normal"
        >
          {t('title')}
        </h2>
        <p
          data-identities={holds ? 'hold' : 'broken'}
          title={t('identityNote')}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            holds
              ? 'bg-tone-success-bg text-tone-success-fg'
              : 'bg-tone-danger-bg text-tone-danger-fg'
          }`}
        >
          <CheckMark holds={holds} />
          {holds ? t('identityHolds') : t('identityBroken')}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_auto_minmax(0,1fr)]">
        <Panel
          headingId={collectedId}
          eyebrow={
            <>
              <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
              {label('collected')}
            </>
          }
          figure={model.collected}
          size="xl"
          records={records(model.collected.recordCount)}
          linkLabel={linkLabel(model.collected)}
          bar={
            <IdentityBar
              total={model.collected.value}
              segments={segments(model.collectedSegments)}
              caption={t('collectedOf')}
            />
          }
          explain={
            <LevelExplain
              explain={model.explain.collected}
              value={<MoneyText amount={model.collected.value} />}
              identities={[collectedIdentity]}
            />
          }
        />

        {/* The hand-off from Collected to its Approved part: down on phones, across on wide screens. */}
        <div
          aria-hidden="true"
          className="flex items-center gap-3 px-6 sm:px-8 lg:flex-col lg:px-0 lg:py-10"
        >
          <span className="h-px flex-1 bg-border lg:h-auto lg:w-px" />
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-tone-success-fg shadow-[0_1px_0_var(--color-border)]">
            <svg
              viewBox="0 0 16 16"
              className="size-4 rotate-90 lg:rotate-0 lg:rtl:-scale-x-100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3.5 8h9M8.5 4l4 4-4 4" />
            </svg>
          </span>
          <span className="h-px flex-1 bg-border lg:h-auto lg:w-px" />
        </div>

        <Panel
          tint
          headingId={approvedId}
          eyebrow={
            <>
              <span aria-hidden="true" className="size-2 rounded-full bg-tone-success-fg" />
              {label('approved')}
            </>
          }
          figure={model.approved}
          size="lg"
          records={records(model.approved.recordCount)}
          linkLabel={linkLabel(model.approved)}
          bar={
            <IdentityBar
              total={model.approved.value}
              segments={segments(model.approvedSegments)}
              caption={t('approvedOf')}
            />
          }
          explain={
            <LevelExplain
              explain={model.explain.approved}
              value={<MoneyText amount={model.approved.value} />}
              identities={[approvedIdentity]}
            />
          }
        />
      </div>

      <footer className="flex flex-col gap-3 border-t border-border px-6 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
        <p className="text-xs leading-relaxed text-text-muted">{t('identityNote')}</p>
        <div
          role="group"
          aria-label={t('partsExplain')}
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <span aria-hidden="true" className="text-xs text-text-muted">
            {t('partsExplain')}
          </span>
          {model.collectedSegments
            .concat(model.approvedSegments)
            .filter((s) => s.figure !== 'approved')
            .map((s) => (
              <LevelExplain
                key={s.figure}
                triggerLabel={label(s.figure)}
                explain={model.explain[s.figure]}
                value={<MoneyText amount={s.amount} />}
              />
            ))}
        </div>
      </footer>
    </section>
  );
}
