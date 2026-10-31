import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { fontClassNames } from '@/app/fonts';
import { dirFor, routing } from '@/i18n/routing';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });
  return { title: t('appName'), description: t('tagline') };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.some((l) => l === locale)) notFound();
  setRequestLocale(locale);

  // The `theme` cookie is non-sensitive and is written client-side by ThemeToggle.
  // Only an explicit light or dark choice sets data-theme; anything else follows the
  // system through prefers-color-scheme. Rendering it here avoids a flash and needs no
  // inline script.
  const theme = (await cookies()).get('theme')?.value;
  const dataTheme = theme === 'light' || theme === 'dark' ? theme : undefined;

  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={dataTheme} className={fontClassNames}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
