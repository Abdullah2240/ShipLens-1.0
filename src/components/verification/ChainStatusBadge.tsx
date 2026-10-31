import { useTranslations } from 'next-intl';
import { formatInt } from '@/platform/i18n/format';
import { dateTimeText, Icon, ltr, type VerifyLocale } from './parts';

export type ChainBreakReason = 'sequence_gap' | 'link_mismatch' | 'hash_mismatch';

export type ChainStatusBadgeProps = {
  status: 'empty' | 'intact' | 'broken';
  checkedEvents: number;
  /** ISO instant of the check. */
  checkedAt: string;
  brokenAtSeq?: number | null;
  reason?: ChainBreakReason;
  /** Link that re-runs the check (for example `?fresh=1`); no link when absent. */
  recheckHref?: string;
  locale: VerifyLocale;
};

// Full class strings so Tailwind can see them.
const TONE = {
  intact: {
    frame: 'border-tone-success-fg/25 bg-tone-success-bg/50',
    icon: 'bg-tone-success-bg text-tone-success-fg',
    name: 'shieldCheck',
  },
  broken: {
    frame: 'border-tone-danger-fg/35 bg-tone-danger-bg/60',
    icon: 'bg-tone-danger-bg text-tone-danger-fg',
    name: 'linkBroken',
  },
  empty: {
    frame: 'border-border bg-surface-raised',
    icon: 'bg-tone-neutral-bg text-tone-neutral-fg',
    name: 'circleDashed',
  },
} as const;

/** Result of the audit chain check, in words and an icon (never colour alone). */
export function ChainStatusBadge({
  status,
  checkedEvents,
  checkedAt,
  brokenAtSeq,
  reason,
  recheckHref,
  locale,
}: ChainStatusBadgeProps) {
  const t = useTranslations('verify.badge');
  const tone = TONE[status];
  const time = dateTimeText(checkedAt, locale);
  const count = formatInt(checkedEvents, locale);

  let headline;
  let detail;
  if (status === 'intact') {
    headline = t('intact');
    detail = t.rich('intactDetail', { count, time, ltr });
  } else if (status === 'broken') {
    headline = t.rich('broken', { seq: String(brokenAtSeq ?? '?'), ltr });
    detail = t.rich('brokenDetail', { count, time, ltr });
  } else {
    headline = t('empty');
    detail = t.rich('emptyDetail', { time, ltr });
  }

  return (
    <div
      role="status"
      data-status={status}
      className={`flex flex-wrap items-start gap-3 rounded-card border px-4 py-3 text-text ${tone.frame}`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-full ${tone.icon}`}
        aria-hidden="true"
      >
        <Icon name={tone.name} className="size-5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm leading-6 font-semibold">{headline}</p>
        {status === 'broken' && reason ? (
          <p className="text-sm text-tone-danger-fg">{t(`reason.${reason}`)}</p>
        ) : null}
        <p className="text-xs leading-5 text-text-muted">{detail}</p>
      </div>
      {recheckHref ? (
        <a
          href={recheckHref}
          className="ms-auto inline-flex shrink-0 items-center self-center rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary hover:bg-surface"
        >
          {t('recheck')}
        </a>
      ) : null}
    </div>
  );
}
