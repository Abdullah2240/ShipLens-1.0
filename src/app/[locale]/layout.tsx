import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { dirFor, routing } from '@/i18n/routing';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
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

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
