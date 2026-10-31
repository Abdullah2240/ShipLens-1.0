import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getEntry, parseEntryParams } from '@/modules/content';
import { ContentEditor } from '@/modules/content/components/ContentEditor';
import { isContentKey } from '@/modules/public-site/keys';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';

// Reads the session and the draft on every request.
export const dynamic = 'force-dynamic';

// `locale` is the admin UI language (outer next-intl segment); `entryLocale` is the
// language of the entry being edited and never changes the page chrome.
type Params = Promise<{ locale: string; key: string; entryLocale: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, key } = await params;
  const t = await getTranslations({ locale, namespace: 'content' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const title = isContentKey(key)
    ? `${t('editor.title', { page: t(`keys.${key}`) })} | ${common('appName')}`
    : common('appName');
  return { title, robots: { index: false } };
}

export default async function ContentEntryPage({ params }: { params: Params }) {
  const { locale, key, entryLocale } = await params;
  setRequestLocale(locale);
  const { actor } = await requirePageActor();
  const entryParams = await orNotFound(
    Promise.resolve().then(() => parseEntryParams(key, entryLocale)),
  );
  const entry = await orNotFound(getEntry(getPool(), actor, entryParams.key, entryParams.locale));

  return <ContentEditor entry={entry} />;
}
