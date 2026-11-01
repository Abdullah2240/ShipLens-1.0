import { useLocale, useTranslations } from 'next-intl';
import { Bdi } from '@/components/ui';
import { fillSlots, slot } from '@/components/ui/Bidi';
import type { ReportEventItem, ReportEventType } from '../types';
import { Panel } from './Panel';
import { asLocale, safeDateTime } from './report-format';

// Full class strings so Tailwind can see them.
const EVENT_TONES: Record<ReportEventType, string> = {
  submitted: 'bg-tone-info-bg text-tone-info-fg',
  resubmitted: 'bg-tone-info-bg text-tone-info-fg',
  returned: 'bg-tone-warning-bg text-tone-warning-fg',
  approved: 'bg-tone-success-bg text-tone-success-fg',
};

function EventIcon({ type }: { type: ReportEventType }) {
  const path =
    type === 'approved'
      ? 'M3.5 8.5l3 3 6-7'
      : type === 'returned'
        ? 'M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 010 7H8'
        : 'M8 12.5V3.5M4 7.5l4-4 4 4';
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-3.5 ${type === 'returned' ? 'rtl:-scale-x-100' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export interface ReportHistoryProps {
  events: ReportEventItem[];
}

/** Lifecycle events in the order they happened, with the reason for each return. */
export function ReportHistory({ events }: ReportHistoryProps) {
  const t = useTranslations('reports');
  const locale = asLocale(useLocale());
  const ordered = [...events].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );

  return (
    <Panel title={t('detail.history')}>
      {ordered.length === 0 ? (
        <p className="text-sm text-text-muted">{t('detail.historyEmpty')}</p>
      ) : (
        <ol className="flex flex-col" data-testid="report-history">
          {ordered.map((event, i) => (
            <li
              key={event.id}
              data-event-type={event.type}
              className="relative flex gap-3 pb-5 last:pb-0"
            >
              {i < ordered.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute start-[13px] top-8 bottom-0 w-px bg-border"
                />
              ) : null}
              <span
                className={`relative inline-flex size-7 shrink-0 items-center justify-center rounded-full ${EVENT_TONES[event.type]}`}
              >
                <EventIcon type={event.type} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <p className="text-sm font-semibold text-text">{t(`events.${event.type}`)}</p>
                  <Bdi className="text-xs whitespace-nowrap text-text-muted tabular">
                    <time dateTime={event.occurredAt}>
                      {safeDateTime(event.occurredAt, locale)}
                    </time>
                  </Bdi>
                </div>
                {event.actorName ? (
                  <p className="text-xs text-text-muted">
                    {fillSlots(t('events.by', { name: slot() }), [
                      <Bdi key="name">{event.actorName}</Bdi>,
                    ])}
                  </p>
                ) : null}
                {event.reason ? (
                  <div className="mt-1 rounded-lg border border-border bg-surface-sunken/70 px-3 py-2">
                    <p className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                      {t('events.reason')}
                    </p>
                    <p dir="auto" className="text-sm whitespace-pre-line text-text">
                      {event.reason}
                    </p>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
