import { useLocale, useTranslations } from 'next-intl';
import { DataTable, EmptyState, StatusBadge, type Column } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import type { EventView } from '@/modules/content/event-types';
import { formatDateTime } from '@/platform/i18n/format';

export const EVENTS_HREF = '/content/events';
export const NEW_EVENT_HREF = '/content/events/new';
export const eventHref = (id: string) => `${EVENTS_HREF}/${id}`;

/** Draft or published, plus a marker when the draft differs from the public copy. */
export function EventStateBadges({ event }: { event: EventView }) {
  const t = useTranslations('content.state');

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={event.status} label={t(event.status)} />
      {event.hasUnpublishedChanges ? (
        <span
          data-state="unpublished-changes"
          className="inline-flex items-center gap-1.5 rounded-full bg-tone-info-bg px-2.5 py-0.5 text-xs font-semibold text-tone-info-fg"
        >
          <span aria-hidden="true" className="size-1.5 rounded-full border border-current" />
          {t('unpublishedChanges')}
        </span>
      ) : null}
    </span>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

function NewEventLink() {
  const t = useTranslations('content.events');
  return (
    <Link
      href={NEW_EVENT_HREF}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast shadow-card transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <PlusIcon />
      {t('new')}
    </Link>
  );
}

function EventTitle({ event }: { event: EventView }) {
  const t = useTranslations('content.events');
  if (event.titleEn) return <>{event.titleEn}</>;
  if (event.titleUr) {
    return (
      <span lang="ur" dir="rtl">
        {event.titleUr}
      </span>
    );
  }
  return <>{t('untitled')}</>;
}

export function EventsTable({ events }: { events: EventView[] }) {
  const t = useTranslations('content');
  const locale = useLocale() as Locale;

  if (events.length === 0) {
    return (
      <EmptyState
        title={t('events.empty.title')}
        body={t('events.empty.body')}
        action={<NewEventLink />}
      />
    );
  }

  const columns: Column<EventView>[] = [
    {
      key: 'title',
      header: t('events.columns.title'),
      render: (event) => (
        <span className="flex flex-col gap-0.5">
          <Link
            href={eventHref(event.id)}
            className="font-semibold text-text underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <EventTitle event={event} />
          </Link>
          {event.branchName ? (
            <span className="text-xs text-text-muted">{event.branchName}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'starts',
      header: t('events.columns.starts'),
      render: (event) =>
        event.startsAt ? (
          <time dateTime={event.startsAt} className="whitespace-nowrap text-text tabular">
            <bdi>{formatDateTime(new Date(event.startsAt), locale)}</bdi>
          </time>
        ) : (
          <span className="text-text-muted">{t('events.noDate')}</span>
        ),
    },
    {
      key: 'venue',
      header: t('events.columns.venue'),
      render: (event) =>
        event.location ? (
          <span className="text-text">{event.location}</span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      key: 'status',
      header: t('events.columns.status'),
      render: (event) => <EventStateBadges event={event} />,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <NewEventLink />
      </div>
      <DataTable
        columns={columns}
        rows={events}
        getRowKey={(event) => event.id}
        caption={t('events.caption')}
        captionHidden
      />
    </div>
  );
}
