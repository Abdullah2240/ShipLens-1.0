import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { parseEntryParams, previewEntry } from '@/modules/content';
import { ContentPreview } from '@/modules/content/components/ContentPreview';
import { getPool } from '@/platform/db';
import { orNotFound, requirePageActor } from '@/platform/http/interim-server';

// Drafts are private: read per request and never indexed.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { robots: { index: false } };

// `locale` is the admin UI language; `entryLocale` only sets the previewed article's
// language and direction.
type Params = Promise<{ locale: string; key: string; entryLocale: string }>;

export default async function ContentPreviewPage({ params }: { params: Params }) {
  const { locale, key, entryLocale } = await params;
  setRequestLocale(locale);
  const { actor } = await requirePageActor();
  const entryParams = await orNotFound(
    Promise.resolve().then(() => parseEntryParams(key, entryLocale)),
  );
  const entry = await orNotFound(
    previewEntry(getPool(), actor, entryParams.key, entryParams.locale),
  );

  return <ContentPreview entry={entry} />;
}
