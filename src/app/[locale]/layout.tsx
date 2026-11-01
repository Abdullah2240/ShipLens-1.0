import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { fontClassNames } from '@/app/fonts';
import { dirFor, routing } from '@/i18n/routing';
import '../globals.css';

// Only the shell's own strings travel to the browser from here (switcher, theme toggle,
// error boundary). The signed-in and sign-in layouts provide every namespace to their
// client components; public pages add what a client form needs next to that form. This
// keeps the full message catalogue out of every public page.
const ROOT_CLIENT_NAMESPACES = ['common', 'shell', 'errors'] as const;

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
  const messages = await getMessages();
  const clientMessages = Object.fromEntries(
    ROOT_CLIENT_NAMESPACES.map((ns) => [ns, messages[ns] ?? {}]),
  );

  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={dataTheme} className={fontClassNames}>
      <body>
        <NextIntlClientProvider messages={clientMessages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
