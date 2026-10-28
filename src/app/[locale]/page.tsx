import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('common');

  return (
    <main>
      <h1>{t('appName')}</h1>
      <p>{t('tagline')}</p>
    </main>
  );
}
