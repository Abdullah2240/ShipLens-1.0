import { useTranslations } from 'next-intl';
import { SafeMarkdown } from '@/components/content/SafeMarkdown';
import { Link } from '@/i18n/navigation';
import { dirFor } from '@/i18n/routing';
import type { ContentEntryView } from '@/modules/content/types';
import { LANGUAGE_KEY, entryHref } from './ContentEntriesTable';

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0112 5c5 0 8.5 4.5 9.5 7a13 13 0 01-2.9 4.1M6.2 6.3A13 13 0 002.5 12c1 2.5 4.5 7 9.5 7a9.4 9.4 0 004.6-1.2M9.9 9.9a3 3 0 004.2 4.2" />
    </svg>
  );
}

/** Private, read-only rendering of an entry's draft copy. */
export function ContentPreview({ entry }: { entry: ContentEntryView }) {
  const t = useTranslations('content');
  const title = entry.title?.trim() ?? '';
  const body = entry.body ?? '';
  const empty = !title && !body.trim();

  return (
    <div className="flex flex-col gap-6">
      <div
        role="note"
        className="flex flex-col gap-3 rounded-card border border-dashed border-tone-warning-fg/40 bg-tone-warning-bg px-4 py-3 text-tone-warning-fg sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          <EyeOffIcon />
          {t('preview.banner')}
        </p>
        <Link
          href={entryHref(entry.key, entry.locale)}
          className="inline-flex h-9 w-fit items-center rounded-lg border border-tone-warning-fg/30 bg-surface-raised px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('preview.back')}
        </Link>
      </div>

      <p className="text-sm text-text-muted">
        {t(`keys.${entry.key}`)} · {t(LANGUAGE_KEY[entry.locale])}
      </p>

      {entry.translationMissing ? (
        <div
          role="status"
          data-state="missing-translation"
          className="rounded-card border border-border bg-surface-raised px-6 py-10 text-center text-text-muted shadow-card"
        >
          {t('preview.missingNotice')}
        </div>
      ) : empty ? (
        <div
          role="status"
          className="rounded-card border border-dashed border-border-strong/60 bg-surface-raised px-6 py-10 text-center text-text-muted"
        >
          {t('preview.empty')}
        </div>
      ) : (
        <article
          lang={entry.locale}
          dir={dirFor(entry.locale)}
          className="rounded-card border border-border bg-surface-raised px-5 py-8 shadow-card sm:px-10 sm:py-12"
        >
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            {title ? (
              <h1 className="font-display-ur text-3xl font-bold tracking-tight text-text md:text-4xl md:leading-[1.2]">
                {title}
              </h1>
            ) : null}
            {body ? <SafeMarkdown source={body} className="text-lg leading-relaxed" /> : null}
          </div>
        </article>
      )}
    </div>
  );
}
