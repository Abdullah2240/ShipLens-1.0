import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { formatDate } from '@/platform/i18n/format';
import { addDays, type DateString } from '@/platform/time';
import type { CollectionEditability } from '../lock';

export interface LockBadgeProps {
  editability: CollectionEditability;
  daysLeft: number;
  lastEditableOn: DateString;
}

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
type Glyph = 'clock' | 'alarm' | 'lock' | 'unlock' | 'review' | 'check' | 'cross' | 'closed';

// Full class strings so Tailwind can see them.
const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-tone-neutral-bg text-tone-neutral-fg',
  info: 'bg-tone-info-bg text-tone-info-fg',
  success: 'bg-tone-success-bg text-tone-success-fg',
  warning: 'bg-tone-warning-bg text-tone-warning-fg',
  danger: 'bg-tone-danger-bg text-tone-danger-fg',
};

const GLYPHS: Record<Glyph, ReactNode> = {
  clock: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.25 1.5" />
    </>
  ),
  alarm: (
    <>
      <circle cx="10" cy="11" r="5.75" />
      <path d="M10 8.25V11l1.75 1.25M4 4.75l2-1.5M16 4.75l-2-1.5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
      <path d="M7 9V6.75a3 3 0 016 0V9" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
      <path d="M7 9V6.75a3 3 0 015.6-1.5" />
    </>
  ),
  review: (
    <>
      <circle cx="9" cy="9" r="4.75" />
      <path d="M12.5 12.5L16 16" />
    </>
  ),
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  cross: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M5.5 14.5l9-9" />
    </>
  ),
  closed: (
    <>
      <path d="M4 16.5V8l6-4 6 4v8.5" />
      <path d="M8 16.5v-4h4v4" />
    </>
  ),
};

interface View {
  tone: Tone;
  glyph: Glyph;
  label: string;
  detail?: string;
}

/**
 * Lock state of one collection as a badge: an icon plus text (never colour alone) and a
 * title with the last day it can be changed.
 */
export function LockBadge({ editability, daysLeft, lastEditableOn }: LockBadgeProps) {
  const t = useTranslations('collections.lock');
  const locale = useLocale() as Locale;
  const date = (value: DateString) => formatDate(value, locale);

  let view: View;
  switch (editability) {
    case 'editable':
      view =
        daysLeft <= 0
          ? { tone: 'warning', glyph: 'alarm', label: t('locksTonight') }
          : {
              tone: daysLeft <= 2 ? 'warning' : 'info',
              glyph: 'clock',
              label: t('locksIn', { days: daysLeft }),
            };
      break;
    case 'editable_exempt':
      view = { tone: 'warning', glyph: 'unlock', label: t('exempt') };
      break;
    case 'locked':
      view = {
        tone: 'neutral',
        glyph: 'lock',
        label: t('locked'),
        detail: t('lockedOn', { date: date(addDays(lastEditableOn, 1)) }),
      };
      break;
    case 'report_submitted':
      view = { tone: 'info', glyph: 'review', label: t('reportSubmitted') };
      break;
    case 'report_approved':
      view = { tone: 'success', glyph: 'check', label: t('reportApproved') };
      break;
    case 'voided':
      view = { tone: 'danger', glyph: 'cross', label: t('voided') };
      break;
    case 'branch_closed':
      view = { tone: 'neutral', glyph: 'closed', label: t('branchClosed') };
      break;
  }

  return (
    <span
      data-lock-state={editability}
      data-tone={view.tone}
      title={t('lastEditable', { date: date(lastEditableOn) })}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${TONE_CLASSES[view.tone]}`}
    >
      <svg
        viewBox="0 0 20 20"
        className="size-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {GLYPHS[view.glyph]}
      </svg>
      <span>{view.label}</span>
      {view.detail ? (
        <span className="font-normal opacity-85">
          <span aria-hidden="true">· </span>
          {view.detail}
        </span>
      ) : null}
    </span>
  );
}
