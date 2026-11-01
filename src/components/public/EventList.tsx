import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui';
import { dirFor } from '@/i18n/routing';
import type { ContentLocale, PublicEvent } from '@/modules/public-site';
import { TIMEZONE } from '@/platform/config/constants';
import { formatDateTime } from '@/platform/i18n/format';
import { pktDate } from '@/platform/time';

export interface EventListProps {
  events: PublicEvent[];
  locale: ContentLocale;
}

// Same Intl locales as the shared formatters: Latin digits, Gregorian calendar.
const INTL_LOCALE: Record<ContentLocale, string> = {
  en: 'en-GB-u-nu-latn',
  ur: 'ur-PK-u-nu-latn',
};

/** 24-hour clock time in Pakistan time, for an end time on the same day as the start. */
function formatPktTime(instant: Date, locale: ContentLocale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: TIMEZONE,
    numberingSystem: 'latn',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/** Weekday, day and month of the start in Pakistan time, for the decorative date tile. */
function tileParts(instant: Date, locale: ContentLocale) {
  const parts = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    timeZone: TIMEZONE,
    calendar: 'gregory',
    numberingSystem: 'latn',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return { weekday: pick('weekday'), day: pick('day'), month: pick('month') };
}

const ICONS = {
  when: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3 2',
  where:
    'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  hostedBy: 'M4 20V10l8-6 8 6v10M9.5 20v-5.5h5V20M3 20h18',
} as const;

function Detail({
  icon,
  label,
  children,
}: {
  icon: keyof typeof ICONS;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <dt className="inline-flex shrink-0 items-center gap-1.5 text-text-muted">
        <svg
          viewBox="0 0 24 24"
          className="size-4 shrink-0 self-center text-accent"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={ICONS[icon]} />
        </svg>
        {label}
      </dt>
      <dd className="min-w-0 font-medium text-text">{children}</dd>
    </div>
  );
}

// Dates sit in <bdi> so digits never reorder around the surrounding text, while an Urdu
// month name still reads right to left inside its own isolate.
function EventItem({ event, locale }: { event: PublicEvent; locale: ContentLocale }) {
  const t = useTranslations('public.events');
  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : null;
  const sameDay = end !== null && pktDate(start) === pktDate(end);
  const tile = tileParts(start, locale);
  const fallback = event.locale !== locale;
  const contentLanguage = fallback ? { lang: event.locale, dir: dirFor(event.locale) } : {};

  return (
    <li className="relative flex gap-4 md:gap-6">
      <div
        aria-hidden="true"
        className="relative z-10 flex w-16 shrink-0 flex-col items-center self-start rounded-xl border border-accent/25 bg-surface-raised py-2 text-center shadow-card md:w-20 md:py-3"
      >
        <span className="text-xs font-semibold text-accent">{tile.weekday}</span>
        <span className="text-2xl leading-none font-bold text-text tabular-nums md:text-3xl">
          {tile.day}
        </span>
        <span className="mt-1 text-xs font-medium text-text-muted">{tile.month}</span>
      </div>

      <article className="flex min-w-0 flex-1 flex-col gap-4 rounded-card border border-border bg-surface-raised p-5 shadow-card md:p-6">
        <div className="flex flex-col gap-4">
          <h3
            {...contentLanguage}
            className="font-display-ur text-xl leading-snug font-bold tracking-tight text-text md:text-2xl"
          >
            {event.title}
          </h3>
          <dl className="flex flex-col gap-2 text-sm">
            <Detail icon="when" label={t('when')}>
              <span className="inline-flex flex-wrap items-baseline gap-x-2">
                <bdi>
                  <time dateTime={event.startsAt}>{formatDateTime(start, locale)}</time>
                </bdi>
                {end ? (
                  <span className="text-text-muted">
                    {t.rich('untilTime', {
                      time: sameDay ? formatPktTime(end, locale) : formatDateTime(end, locale),
                      ltr: (chunks) => (
                        <bdi>
                          <time
                            dateTime={event.endsAt ?? undefined}
                            className="font-medium text-text"
                          >
                            {chunks}
                          </time>
                        </bdi>
                      ),
                    })}
                  </span>
                ) : null}
              </span>
            </Detail>
            {event.location?.trim() ? (
              <Detail icon="where" label={t('where')}>
                <bdi>{event.location}</bdi>
              </Detail>
            ) : null}
            {event.branchName?.trim() ? (
              <Detail icon="hostedBy" label={t('hostedBy')}>
                <bdi>{event.branchName}</bdi>
              </Detail>
            ) : null}
          </dl>
          {event.summary?.trim() ? (
            <p {...contentLanguage} className="whitespace-pre-line text-text-muted">
              {event.summary}
            </p>
          ) : null}
        </div>
        {fallback ? (
          <p role="note" className="flex items-center gap-2 text-xs text-text-muted">
            <svg
              viewBox="0 0 24 24"
              className="size-3.5 shrink-0 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
            </svg>
            {t('fallbackNote')}
          </p>
        ) : null}
      </article>
    </li>
  );
}

export function EventList({ events, locale }: EventListProps) {
  const t = useTranslations('public.events');

  // The list heading is for screen readers and keeps the heading order h1, h2, h3 (the
  // empty state's title is an h3).
  const heading = (
    <h2 id="events-list-title" className="sr-only">
      {t('listTitle')}
    </h2>
  );

  if (events.length === 0) {
    return (
      <>
        {heading}
        <EmptyState title={t('empty.title')} body={t('empty.body')} />
      </>
    );
  }

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="absolute inset-y-4 start-8 w-px bg-linear-to-b from-accent/50 via-border to-transparent md:start-10"
      />
      {heading}
      <ol aria-labelledby="events-list-title" className="relative flex flex-col gap-6 md:gap-8">
        {events.map((event) => (
          <EventItem key={event.slug} event={event} locale={locale} />
        ))}
      </ol>
    </div>
  );
}
