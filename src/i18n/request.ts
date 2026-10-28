import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export const NAMESPACES = [
  'common',
  'errors',
  'auth',
  'shell',
  'public',
  'branches',
  'collections',
  'reports',
  'dashboard',
  'audit',
  'applications',
  'members',
  'content',
  'impact',
] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = routing.locales.find((l) => l === requested) ?? routing.defaultLocale;

  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const mod = await import(`../../messages/${locale}/${ns}.json`);
      return [ns, mod.default] as const;
    }),
  );

  return { locale, messages: Object.fromEntries(entries) };
});
