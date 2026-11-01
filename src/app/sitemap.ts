import type { MetadataRoute } from 'next';
import { languageAlternates, localeUrl, PUBLIC_PATHS, siteOrigin } from '@/components/public/seo';
import { routing } from '@/i18n/routing';

// Read per request: APP_ORIGIN is not available when the image is built.
export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  return PUBLIC_PATHS.flatMap((path) =>
    routing.locales.map((locale) => ({
      url: localeUrl(locale, path, origin),
      changeFrequency: path === '/events' || path === '/impact' ? 'daily' : 'weekly',
      priority: path === '' ? 1 : 0.7,
      alternates: { languages: languageAlternates(path, origin) },
    })),
  );
}
