import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Bdi } from '@/components/ui';
import type { ReportEventRow } from '@/modules/reporting/trace-types';
import { EvidenceDate } from './ReportSummaryCard';

type EventType = 'submitted' | 'resubmitted' | 'returned' | 'approved';
const KNOWN: readonly EventType[] = ['submitted', 'resubmitted', 'returned', 'approved'];

// Full class strings so Tailwind can see them.
const EVENT_TONES: Record<EventType, string> = {
  submitted: 'bg-tone-info-bg text-tone-info-fg',
  resubmitted: 'bg-tone-info-bg text-tone-info-fg',
  returned: 'bg-tone-warning-bg text-tone-warning-fg',
  approved: 'bg-tone-success-bg text-tone-success-fg',
};

function isKnown(type: string): type is EventType {
  return (KNOWN as readonly string[]).includes(type);
}

function EventIcon({ type }: { type: string }) {
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

export interface ReportEventsListProps {
  events: ReportEventRow[];
}

/** The report's lifecycle in the order it happened: who moved it, when, and why. */
export function ReportEventsList({ events }: ReportEventsListProps) {
  const t = useTranslations('evidence');
  const headingId = useId();
  const ordered = [...events].sort(
    (a, b) =>
      a.occurredAt.localeCompare(b.occurredAt) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col rounded-card border border-border bg-surface-raised shadow-card"
    >
      <header className="border-b border-border px-5 py-4">
        <h2 id={headingId} className="text-sm font-semibold text-text">
          {t('report.events')}
        </h2>
      </header>
      <div className="px-5 py-4">
        {ordered.length === 0 ? (
          <div role="status" className="flex flex-col gap-1">
            <p className="text-sm font-medium text-text">{t('events.empty')}</p>
            <p className="text-xs text-text-muted">{t('events.emptyBody')}</p>
          </div>
        ) : (
          <ol aria-labelledby={headingId} className="flex flex-col">
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
                  className={`relative inline-flex size-7 shrink-0 items-center justify-center rounded-full ${
                    isKnown(event.type)
                      ? EVENT_TONES[event.type]
                      : 'bg-tone-neutral-bg text-tone-neutral-fg'
                  }`}
                >
                  <EventIcon type={event.type} />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                    <p className="text-sm font-semibold text-text">
                      {isKnown(event.type) ? t(`events.${event.type}`) : event.type}
                    </p>
                    <span className="text-xs text-text-muted">
                      <EvidenceDate value={event.occurredAt} withTime />
                    </span>
                  </div>
                  <p className="text-xs text-text-muted">
                    {event.actorName
                      ? t.rich('events.by', {
                          name: () => (
                            <Bdi className="font-medium text-text">{event.actorName}</Bdi>
                          ),
                        })
                      : t('events.system')}
                  </p>
                  {event.reason ? (
                    <div className="mt-1.5 rounded-lg border border-border bg-surface-sunken/70 px-3 py-2">
                      <p className="text-[11px] font-semibold text-text-muted">
                        {t('events.reason')}
                      </p>
                      <p className="mt-0.5 text-sm text-text">
                        <Bdi className="break-words">{event.reason}</Bdi>
                      </p>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
