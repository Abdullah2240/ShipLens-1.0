import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getEvent, listBranchOptionsForContent } from '@/modules/content';
import { EventEditor } from '@/modules/content/components/EventEditor';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the draft on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'content' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return {
    title: `${t('events.editor.editTitle')} | ${common('appName')}`,
    robots: { index: false },
  };
}

export default async function ContentEventPage({ params }: { params: Params }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { actor } = await requireActor();
  const pool = getPool();
  const [event, branches] = await orNotFound(
    Promise.all([getEvent(pool, actor, id), listBranchOptionsForContent(pool, actor)]),
  );

  return <EventEditor event={event} branches={branches} />;
}
