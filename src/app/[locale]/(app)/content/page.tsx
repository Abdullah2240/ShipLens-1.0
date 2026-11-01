import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { listEntries } from '@/modules/content';
import { ContentEntriesTable } from '@/modules/content/components/ContentEntriesTable';
import { ContentTabs } from '@/modules/content/components/ContentTabs';
import { getPool } from '@/platform/db';
import { orNotFound, requireActor } from '@/platform/http/server';

// Reads the session and the database on every request.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'content' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('list.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function ContentListPage({ params }: { params: Params }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { actor } = await requireActor();
  const [t, entries] = await Promise.all([
    getTranslations('content'),
    orNotFound(listEntries(getPool(), actor)),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-text">{t('list.title')}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-text-muted">{t('list.intro')}</p>
      </header>
      <ContentTabs active="pages" />
      <ContentEntriesTable entries={entries} />
    </div>
  );
}
