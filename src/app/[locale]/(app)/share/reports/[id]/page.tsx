import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { resolveSharedReport } from '@/modules/reporting';
import { getPool } from '@/platform/db';
import { getCurrentActor, orNotFound } from '@/platform/http/server';

// The link inside a WhatsApp share (WA-02). An ordinary scoped page: signed out it sends the
// visitor to the login page with this path as `next`; signed in it checks report.read in
// the actor's scope (the same 404 for missing and out-of-scope reports) and opens the report.
export const dynamic = 'force-dynamic';

type Params = Promise<{ locale: string; id: string }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'share' });
  const common = await getTranslations({ locale, namespace: 'common' });
  return { title: `${t('landing.title')} | ${common('appName')}`, robots: { index: false } };
}

export default async function SharedReportPage({ params }: { params: Params }) {
  const { locale: raw, id } = await params;
  const locale: Locale = routing.locales.find((l) => l === raw) ?? routing.defaultLocale;
  setRequestLocale(locale);
  // Only a report id can be shared; anything else is not found for everyone.
  if (!UUID.test(id)) notFound();
  const reportId = id.toLowerCase();

  const found = await getCurrentActor();
  if (!found) {
    // A locale-prefixed next path: the login page navigates to it without re-prefixing.
    const next = `/${locale}/share/reports/${reportId}`;
    redirect(`/${locale}/login?next=${encodeURIComponent(next)}`);
  }

  await orNotFound(resolveSharedReport(getPool(), found.actor, reportId));
  redirect(`/${locale}/reports/${reportId}`);
}
