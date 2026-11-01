import type { Metadata } from 'next';
import { routing } from '@/i18n/routing';

/** Every indexable public page, as a locale-less path ('' is the home page). */
export const PUBLIC_PATHS = [
  '',
  '/about',
  '/programs',
  '/branches',
  '/events',
  '/impact',
  '/get-involved',
  '/get-involved/apply',
  '/contact',
] as const;

export type PublicPath = (typeof PUBLIC_PATHS)[number] | '/get-involved/apply/thanks';

/**
 * The configured public origin, read at request time (never at build time, where it is
 * absent). Undefined when it is not set or not a URL; callers then use relative URLs.
 */
export function siteOrigin(source: Record<string, string | undefined> = process.env) {
  const raw = source.APP_ORIGIN?.trim() || source.RENDER_EXTERNAL_URL?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

/** Absolute URL of a public page in one locale, or a root-relative one without an origin. */
export function localeUrl(locale: string, path: PublicPath, origin = siteOrigin()) {
  return `${origin ?? ''}/${locale}${path}`;
}

/** hreflang alternates for every locale, plus x-default pointing at the default locale. */
export function languageAlternates(path: PublicPath, origin = siteOrigin()) {
  const languages: Record<string, string> = {};
  for (const locale of routing.locales) languages[locale] = localeUrl(locale, path, origin);
  languages['x-default'] = localeUrl(routing.defaultLocale, path, origin);
  return languages;
}

export interface PublicMetadataInput {
  locale: string;
  path: PublicPath;
  /** Page title without the site name. */
  title: string;
  description?: string;
  appName: string;
  /** False for pages that must stay out of search results (the thanks page). */
  index?: boolean;
}

/** Title "Page | Site", description, canonical URL and en/ur alternates for a public page. */
export function publicMetadata({
  locale,
  path,
  title,
  description,
  appName,
  index = true,
}: PublicMetadataInput): Metadata {
  const origin = siteOrigin();
  const fullTitle = `${title} | ${appName}`;
  return {
    title: fullTitle,
    ...(description ? { description } : {}),
    alternates: {
      canonical: localeUrl(locale, path, origin),
      languages: languageAlternates(path, origin),
    },
    openGraph: {
      title: fullTitle,
      ...(description ? { description } : {}),
      siteName: appName,
      locale: locale === 'ur' ? 'ur_PK' : 'en_GB',
      type: 'website',
      url: localeUrl(locale, path, origin),
    },
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}
