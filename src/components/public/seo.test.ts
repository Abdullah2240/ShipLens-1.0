import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { languageAlternates, localeUrl, publicMetadata, PUBLIC_PATHS, siteOrigin } from './seo';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('siteOrigin', () => {
  it('reads APP_ORIGIN, then RENDER_EXTERNAL_URL, and keeps only the origin', () => {
    expect(siteOrigin({ APP_ORIGIN: 'https://shiplens.example/some/path' })).toBe(
      'https://shiplens.example',
    );
    expect(siteOrigin({ RENDER_EXTERNAL_URL: 'https://x.onrender.com/' })).toBe(
      'https://x.onrender.com',
    );
  });

  it('is undefined when unset, blank or not a URL', () => {
    expect(siteOrigin({})).toBeUndefined();
    expect(siteOrigin({ APP_ORIGIN: '  ' })).toBeUndefined();
    expect(siteOrigin({ APP_ORIGIN: 'not a url' })).toBeUndefined();
  });
});

describe('public metadata', () => {
  it('builds absolute canonical and alternate URLs from the origin', () => {
    vi.stubEnv('APP_ORIGIN', 'https://shiplens.example');
    const meta = publicMetadata({
      locale: 'ur',
      path: '/impact',
      title: 'ہمارا اثر',
      description: 'desc',
      appName: 'ShipLens',
    });
    expect(meta.title).toBe('ہمارا اثر | ShipLens');
    expect(meta.description).toBe('desc');
    expect(meta.alternates).toEqual({
      canonical: 'https://shiplens.example/ur/impact',
      languages: {
        en: 'https://shiplens.example/en/impact',
        ur: 'https://shiplens.example/ur/impact',
        'x-default': 'https://shiplens.example/en/impact',
      },
    });
    expect(meta.robots).toBeUndefined();
  });

  it('falls back to root-relative URLs without an origin', () => {
    vi.stubEnv('APP_ORIGIN', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', '');
    expect(localeUrl('en', '')).toBe('/en');
    expect(languageAlternates('/about')).toEqual({
      en: '/en/about',
      ur: '/ur/about',
      'x-default': '/en/about',
    });
  });

  it('marks a page noindex on request', () => {
    const meta = publicMetadata({
      locale: 'en',
      path: '/get-involved/apply/thanks',
      title: 'Thanks',
      appName: 'ShipLens',
      index: false,
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.description).toBeUndefined();
  });
});

describe('robots and sitemap', () => {
  it('disallows the API and every signed-in area and points at the sitemap', () => {
    vi.stubEnv('APP_ORIGIN', 'https://shiplens.example');
    const result = robots();
    expect(result.sitemap).toBe('https://shiplens.example/sitemap.xml');
    expect(result.rules).toEqual({
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/*/dashboard',
        '/*/audit',
        '/*/admin',
        '/*/collections',
        '/*/reports',
        '/*/people',
        '/*/content',
        '/*/account',
        '/*/share',
      ],
    });
  });

  it('leaves the sitemap line out without an origin', () => {
    vi.stubEnv('APP_ORIGIN', '');
    vi.stubEnv('RENDER_EXTERNAL_URL', '');
    expect(robots().sitemap).toBeUndefined();
  });

  it('lists every public page in both locales with alternates', () => {
    vi.stubEnv('APP_ORIGIN', 'https://shiplens.example');
    const entries = sitemap();
    expect(entries).toHaveLength(PUBLIC_PATHS.length * 2);
    expect(entries.map((e) => e.url)).toContain('https://shiplens.example/ur/get-involved/apply');
    expect(entries.some((e) => e.url.includes('thanks'))).toBe(false);
    const home = entries.find((e) => e.url === 'https://shiplens.example/en');
    expect(home?.alternates?.languages).toMatchObject({
      en: 'https://shiplens.example/en',
      ur: 'https://shiplens.example/ur',
    });
  });
});
