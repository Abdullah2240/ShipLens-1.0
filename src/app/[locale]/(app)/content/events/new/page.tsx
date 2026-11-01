import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listBranchOptionsForContent } from '@/modules/content';
import { EventEditor } from '@/modules/content/components/EventEditor';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the Active branches on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'content' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return {
    title: `${t('events.editor.newTitle')} | ${common('appName')}`,
    robots: { index: false },
  };
}

export default async function NewContentEventPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await requireActor();
  // Also keeps roles without content.read out with the standard not-found page.
  const branches = await orNotFound(listBranchOptionsForContent(getPool(), actor));

  return <EventEditor event={null} branches={branches} />;
}
