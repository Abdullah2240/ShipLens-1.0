import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { SafeMarkdown } from '@/components/content/SafeMarkdown';
import { dirFor } from '@/i18n/routing';
import type { ContentLocale, PublishedContent } from '@/modules/public-site';

export interface PublicContentPageProps {
  title: string;
  /** Small pill above the heading, for example the page's navigation label. */
  eyebrow?: string;
  /** Only for default copy. */
  lead?: string;
  /** Markdown, published or default. */
  body: string;
  /** The visitor's locale. */
  pageLocale: ContentLocale;
  /** The language the body is actually in. */
  contentLocale: ContentLocale;
  /** The language the title is in; defaults to the body's language. */
  titleLocale?: ContentLocale;
  /** Extra blocks (calls to action) rendered below the body. */
  children?: ReactNode;
}

export interface PublicContentDefaults {
  title: string;
  lead: string;
  body: string;
}

export type ResolvedPublicContent = Required<
  Pick<PublicContentPageProps, 'title' | 'titleLocale' | 'body' | 'contentLocale' | 'pageLocale'>
> &
  Pick<PublicContentPageProps, 'lead'>;

const hasText = (value: string | null | undefined): value is string => Boolean(value?.trim());

/**
 * Published copy first (already resolved to the visitor's language or English by the
 * public-site service), then the default copy from the message files, field by field.
 */
export function resolvePublicContent(
  published: Pick<PublishedContent, 'title' | 'body' | 'locale'> | null,
  defaults: PublicContentDefaults,
  pageLocale: ContentLocale,
): ResolvedPublicContent {
  const title = hasText(published?.title) ? published.title : null;
  const body = hasText(published?.body) ? published.body : null;
  return {
    title: title ?? defaults.title,
    titleLocale: title !== null && published ? published.locale : pageLocale,
    lead: published ? undefined : defaults.lead,
    body: body ?? defaults.body,
    contentLocale: body !== null && published ? published.locale : pageLocale,
    pageLocale,
  };
}

function languageOverride(locale: ContentLocale, pageLocale: ContentLocale) {
  return locale === pageLocale ? {} : { lang: locale, dir: dirFor(locale) };
}

export function PublicContentPage({
  title,
  eyebrow,
  lead,
  body,
  pageLocale,
  contentLocale,
  titleLocale = contentLocale,
  children,
}: PublicContentPageProps) {
  const t = useTranslations('public.pages');
  const fallback = contentLocale !== pageLocale;

  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-linear-to-b from-accent-soft/70 to-surface">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 end-[-6rem] size-80 rounded-full bg-primary/10 blur-3xl"
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 400 400"
          fill="none"
          stroke="currentColor"
          className="pointer-events-none absolute -bottom-40 end-[-8rem] hidden size-[30rem] text-accent/20 md:block"
        >
          <circle cx="200" cy="200" r="40" strokeWidth="2" />
          <circle cx="200" cy="200" r="85" strokeWidth="1.6" />
          <circle cx="200" cy="200" r="130" strokeWidth="1.3" />
          <circle cx="200" cy="200" r="175" strokeWidth="1" />
          <circle cx="200" cy="200" r="8" fill="currentColor" stroke="none" />
        </svg>
        <div className="relative mx-auto w-full max-w-3xl px-4 py-14 md:px-6 md:py-20">
          <div className="flex flex-col gap-5">
            {eyebrow ? (
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-surface-raised px-3 py-1 text-sm font-semibold text-accent">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                {eyebrow}
              </span>
            ) : null}
            <h1
              {...languageOverride(titleLocale, pageLocale)}
              className="font-display-ur text-4xl font-bold tracking-tight text-balance text-text md:text-5xl md:leading-[1.15]"
            >
              {title}
            </h1>
            {lead ? (
              <p className="max-w-2xl text-lg text-pretty text-text-muted md:text-xl">{lead}</p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-3xl px-4 py-12 md:px-6 md:py-16">
        {fallback ? (
          <p
            role="note"
            className="mb-8 flex items-start gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm text-text-muted shadow-card"
          >
            <svg
              viewBox="0 0 24 24"
              className="mt-0.5 size-4 shrink-0 text-accent"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
            </svg>
            <span>{t('fallbackNotice')}</span>
          </p>
        ) : null}
        <article {...languageOverride(contentLocale, pageLocale)} className="relative md:ps-8">
          <span
            aria-hidden="true"
            className="absolute inset-y-1 start-0 hidden w-0.5 rounded-full bg-linear-to-b from-accent/70 via-border to-transparent md:block"
          />
          <SafeMarkdown
            source={body}
            className="text-base text-pretty md:text-lg [&_a]:font-medium [&_blockquote]:text-text-muted [&_h2]:pt-4 [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:pt-2 [&_li]:mt-2 [&_li]:marker:text-accent [&>p:first-child]:text-lg [&>p:first-child]:text-text md:[&>p:first-child]:text-xl"
          />
        </article>
        {children ? <div className="mt-12 md:mt-16">{children}</div> : null}
      </div>
    </>
  );
}
