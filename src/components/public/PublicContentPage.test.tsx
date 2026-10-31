// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { screen } from '@testing-library/react';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { renderWithIntl } from '../../../tests/support/render-intl';
import { PublicContentPage, resolvePublicContent } from './PublicContentPage';

const NAMESPACES = ['common', 'shell', 'public'];
const PHYSICAL = /(^|\s)(ml|mr|pl|pr|left|right|text-left|text-right)-?/;
const PAGES = ['about', 'programs', 'getInvolved', 'contact'] as const;

type PageMessages = Record<string, Record<string, string>> & { fallbackNotice: string };

function loadPublic(locale: 'en' | 'ur'): { pages: PageMessages } {
  const file = path.resolve(import.meta.dirname, `../../../messages/${locale}/public.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as { pages: PageMessages };
}

function expectNoPhysicalClasses(root: HTMLElement) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const className = el.getAttribute('class') ?? '';
    expect(className, `<${el.tagName.toLowerCase()} class="${className}">`).not.toMatch(PHYSICAL);
  }
}

describe('PublicContentPage', () => {
  it('renders one display heading, the lead and the body inside an article', () => {
    const { container } = renderWithIntl(
      <PublicContentPage
        eyebrow="About"
        title="Neighbours first"
        lead="A short lead."
        body={'First paragraph.\n\n# Inner heading\n\nSecond paragraph.'}
        pageLocale="en"
        contentLocale="en"
      />,
      { locale: 'en', namespaces: NAMESPACES },
    );
    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Neighbours first');
    expect(headings[0]).toHaveClass('font-display-ur');
    expect(screen.getByText('A short lead.').tagName).toBe('P');
    expect(screen.getByText('About')).toBeInTheDocument();
    const article = container.querySelector('article');
    expect(article).toHaveTextContent('First paragraph.');
    expect(article).toHaveTextContent('Second paragraph.');
    expect(article?.querySelector('h2')).toHaveTextContent('Inner heading');
  });

  it('omits the lead paragraph when no lead is given', () => {
    const { container } = renderWithIntl(
      <PublicContentPage title="Title" body="Body." pageLocale="en" contentLocale="en" />,
      { locale: 'en', namespaces: NAMESPACES },
    );
    const header = container.querySelector('h1')?.parentElement;
    expect(header?.querySelectorAll('p')).toHaveLength(0);
  });

  it('marks English fallback content on an Urdu page with lang, dir and a notice', () => {
    const { container } = renderWithIntl(
      <PublicContentPage
        title="About us"
        body="Published in English only."
        pageLocale="ur"
        contentLocale="en"
      />,
      { locale: 'ur', namespaces: NAMESPACES },
    );
    expect(container).toHaveAttribute('lang', 'ur');
    expect(container).toHaveAttribute('dir', 'rtl');
    const article = container.querySelector('article');
    expect(article).toHaveAttribute('lang', 'en');
    expect(article).toHaveAttribute('dir', 'ltr');
    const notice = loadPublic('ur').pages.fallbackNotice;
    expect(screen.getByRole('note')).toHaveTextContent(notice);
    expect(screen.getByRole('note')).not.toHaveAttribute('lang');
  });

  it('marks a fallback title separately from a default-copy body', () => {
    const { container } = renderWithIntl(
      <PublicContentPage
        title="About us"
        titleLocale="en"
        body="اردو متن"
        pageLocale="ur"
        contentLocale="ur"
      />,
      { locale: 'ur', namespaces: NAMESPACES },
    );
    expect(container.querySelector('h1')).toHaveAttribute('lang', 'en');
    expect(container.querySelector('h1')).toHaveAttribute('dir', 'ltr');
    expect(container.querySelector('article')).not.toHaveAttribute('lang');
  });

  it('renders Urdu content on an Urdu page without overrides or a notice', () => {
    const { container } = renderWithIntl(
      <PublicContentPage
        title="محلے کے لوگ، محلے کے لیے"
        lead="ایک مختصر تعارف۔"
        body={'پہلا پیراگراف۔\n\n- تعلیم\n- صحت'}
        pageLocale="ur"
        contentLocale="ur"
      />,
      { locale: 'ur', namespaces: NAMESPACES },
    );
    expect(container).toHaveAttribute('lang', 'ur');
    expect(container).toHaveAttribute('dir', 'rtl');
    expect(container.querySelector('h1')).toHaveTextContent('محلے کے لوگ، محلے کے لیے');
    expect(container.querySelector('h1')).toHaveClass('font-display-ur');
    expect(container.querySelector('h1')).not.toHaveAttribute('lang');
    const article = container.querySelector('article');
    expect(article).not.toHaveAttribute('lang');
    expect(article).not.toHaveAttribute('dir');
    expect(article?.querySelectorAll('li')).toHaveLength(2);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('neutralises script injection and javascript: links in the body', () => {
    const { container } = renderWithIntl(
      <PublicContentPage
        title="Title"
        body={
          'Hello <script>alert(1)</script>\n\n[x](javascript:alert(1)) and <img src=x onerror=alert(1)>'
        }
        pageLocale="en"
        contentLocale="en"
      />,
      { locale: 'en', namespaces: NAMESPACES },
    );
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
    }
    expect(container.innerHTML).not.toMatch(/javascript:|onerror\s*=/i);
  });

  it('renders children after the article', () => {
    const { container } = renderWithIntl(
      <PublicContentPage title="Title" body="Body." pageLocale="en" contentLocale="en">
        <button type="button">Apply</button>
      </PublicContentPage>,
      { locale: 'en', namespaces: NAMESPACES },
    );
    const article = container.querySelector('article');
    const link = screen.getByRole('button', { name: 'Apply' });
    expect(article?.contains(link)).toBe(false);
    expect(article!.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(['en', 'ur'] as const)('uses only logical direction utilities (%s)', (locale) => {
    const { container } = renderWithIntl(
      <PublicContentPage
        eyebrow="Eyebrow"
        title="Title"
        lead="Lead"
        body={'Para\n\n- a\n- b\n\n1. one\n\n> quote\n\n[link](https://example.org)'}
        pageLocale={locale}
        contentLocale="en"
      >
        <p>Extra</p>
      </PublicContentPage>,
      { locale, namespaces: NAMESPACES },
    );
    expect(container).toHaveAttribute('lang', locale);
    expect(container).toHaveAttribute('dir', locale === 'ur' ? 'rtl' : 'ltr');
    expectNoPhysicalClasses(container);
  });
});

describe('resolvePublicContent', () => {
  const defaults = { title: 'Default title', lead: 'Default lead', body: 'Default body' };

  it('uses default copy in the page language when nothing is published', () => {
    expect(resolvePublicContent(null, defaults, 'ur')).toEqual({
      title: 'Default title',
      titleLocale: 'ur',
      lead: 'Default lead',
      body: 'Default body',
      contentLocale: 'ur',
      pageLocale: 'ur',
    });
  });

  it('uses published copy and its language, without the default lead', () => {
    expect(
      resolvePublicContent({ title: 'About us', body: 'Body', locale: 'en' }, defaults, 'ur'),
    ).toEqual({
      title: 'About us',
      titleLocale: 'en',
      lead: undefined,
      body: 'Body',
      contentLocale: 'en',
      pageLocale: 'ur',
    });
  });

  it('falls back to the default title or body when a published field is empty', () => {
    expect(
      resolvePublicContent({ title: null, body: 'Body', locale: 'en' }, defaults, 'ur'),
    ).toMatchObject({
      title: 'Default title',
      titleLocale: 'ur',
      body: 'Body',
      contentLocale: 'en',
    });
    expect(
      resolvePublicContent({ title: 'About us', body: '  ', locale: 'en' }, defaults, 'ur'),
    ).toMatchObject({
      title: 'About us',
      titleLocale: 'en',
      body: 'Default body',
      contentLocale: 'ur',
    });
  });
});

describe('public page messages', () => {
  it.each(['en', 'ur'] as const)('format every default page string (%s)', (locale) => {
    // Loose key type: the global message type is not needed to check that every string parses.
    const t = createTranslator({ locale, messages: { public: loadPublic(locale) } }) as unknown as (
      key: string,
    ) => string;
    expect(t('public.pages.fallbackNotice')).not.toBe('');
    for (const page of PAGES) {
      for (const key of ['title', 'lead', 'body'] as const) {
        const value = t(`public.pages.${page}.${key}`);
        expect(value.length, `${page}.${key}`).toBeGreaterThan(0);
        expect(value).not.toContain('public.pages');
      }
    }
    for (const key of ['ctaTitle', 'ctaBody', 'applyCta', 'branchesCta'] as const) {
      expect(t(`public.pages.getInvolved.${key}`).length).toBeGreaterThan(0);
    }
  });

  it('keeps invented contact details out of the default contact copy', () => {
    for (const locale of ['en', 'ur'] as const) {
      const text = Object.values(loadPublic(locale).pages.contact ?? {}).join(' ');
      expect(text).not.toMatch(/@|\+?\d[\d\s-]{6,}|https?:/);
    }
  });
});
