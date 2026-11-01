import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/components/public/seo';

// Read per request: APP_ORIGIN is not available when the image is built.
export const dynamic = 'force-dynamic';

/** Signed-in areas, under every locale prefix. */
const PRIVATE_AREAS = [
  'dashboard',
  'audit',
  'admin',
  'collections',
  'reports',
  'people',
  'content',
  'account',
  'share',
] as const;

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', ...PRIVATE_AREAS.map((area) => `/*/${area}`)],
    },
    // A sitemap line must be an absolute URL, so it is left out when no origin is set.
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
