import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { EventList } from '@/components/public/EventList';
import { PublicHero } from '@/components/public/PublicHero';
import { publicMetadata } from '@/components/public/seo';
import { type ContentLocale, listUpcomingEvents } from '@/modules/public-site';
import { getPool } from '@/platform/db';

// Reads published events on every request; the build has no database.
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const [t, common] = await Promise.all([
    getTranslations({ locale, namespace: 'public.events' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return publicMetadata({
    locale,
    path: '/events',
    title: t('title'),
    description: t('lead'),
    appName: common('appName'),
  });
}

export default async function EventsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const pageLocale: ContentLocale = locale === 'ur' ? 'ur' : 'en';
  const [t, tNav, events] = await Promise.all([
    getTranslations('public.events'),
    getTranslations('shell.nav'),
    listUpcomingEvents(getPool(), pageLocale),
  ]);

  return (
    <>
      <PublicHero
        eyebrow={tNav('events')}
        title={t('title')}
        lead={t('lead')}
        motif="calendar"
        width="max-w-3xl"
      >
        {events.length > 0 ? (
          <p className="inline-flex w-fit items-center gap-2 text-sm text-text-muted">
            <svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3 2" />
            </svg>
            {t('timezone')}
          </p>
        ) : null}
      </PublicHero>
      <div className="mx-auto w-full max-w-3xl px-4 py-12 md:px-6 md:py-16">
        <EventList events={events} locale={pageLocale} />
      </div>
    </>
  );
}
