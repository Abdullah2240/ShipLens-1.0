'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { dirFor, type Locale } from '@/i18n/routing';
import { BODY_MAX, TITLE_MAX } from '@/modules/content/schema';
import type { ContentEntryView } from '@/modules/content/types';
import { formatDateTime, formatInt } from '@/platform/i18n/format';
import { EntryStateBadges, LANGUAGE_KEY, entryHref } from './ContentEntriesTable';

type Pending = 'save' | 'publish' | 'unpublish';
type Notice = 'saved' | 'published' | 'unpublished';
type Failure = 'errorSave' | 'errorPublishEmpty' | 'errorGeneric';
type Feedback = { kind: 'ok'; key: Notice } | { kind: 'error'; key: Failure };
type Reply = { ok: boolean; status: number; json: unknown };

const SYNTAX = ['heading', 'bold', 'italic', 'list', 'numbered', 'quote', 'link'] as const;

const normaliseBody = (value: string) => value.replace(/\r\n?/g, '\n');

async function send(method: 'PUT' | 'POST', url: string, payload?: unknown): Promise<Reply> {
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return {
      ok: response.ok,
      status: response.status,
      json: await response.json().catch(() => null),
    };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

function entryFrom(json: unknown): ContentEntryView | null {
  const data = (json as { data?: unknown } | null)?.data;
  return data && typeof data === 'object' && 'status' in data ? (data as ContentEntryView) : null;
}

function isEmptyContent(reply: Reply): boolean {
  if (reply.status !== 422) return false;
  const fields = (reply.json as { error?: { details?: { fields?: unknown } } } | null)?.error
    ?.details?.fields;
  return (
    Array.isArray(fields) &&
    fields.some(
      (f: { code?: unknown; message?: unknown }) =>
        f?.code === 'empty_content' || f?.message === 'empty_content',
    )
  );
}

const code = (chunks: ReactNode) => (
  <code
    dir="ltr"
    className="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.8125rem] text-text"
  >
    {chunks}
  </code>
);

const fieldClass =
  'block w-full rounded-xl border border-border-strong bg-surface-raised px-4 text-base text-text shadow-xs transition-colors hover:border-text-muted focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-75';

const buttonBase =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';

function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 animate-spin motion-reduce:animate-none"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Callout({ tone, children }: { tone: 'info' | 'warning'; children: ReactNode }) {
  const classes =
    tone === 'info'
      ? 'border-tone-info-fg/25 bg-tone-info-bg text-tone-info-fg'
      : 'border-tone-warning-fg/30 bg-tone-warning-bg text-tone-warning-fg';
  return (
    <p className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${classes}`}>
      <svg
        viewBox="0 0 20 20"
        className="mt-0.5 size-4 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.25" />
        <path d="M10 9v4.5M10 6.5v.25" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

export function ContentEditor({ entry }: { entry: ContentEntryView }) {
  const t = useTranslations('content');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const id = useId();

  // `view` is the latest server state: the prop after a refresh, or the reply of a write.
  const [view, setView] = useState(entry);
  const [previous, setPrevious] = useState(entry);
  if (entry !== previous) {
    setPrevious(entry);
    setView(entry);
  }

  const [title, setTitle] = useState(entry.title ?? '');
  const [body, setBody] = useState(entry.body ?? '');
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialog, setDialog] = useState<'publish' | 'unpublish' | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inFlight = useRef(false);

  const endpoint = `/api/v1/content/entries/${entry.key}/${entry.locale}`;
  const entryDir = dirFor(entry.locale);
  const page = t(`keys.${entry.key}`);
  const language = t(LANGUAGE_KEY[entry.locale]);

  const dirty = title.trim() !== (view.title ?? '') || normaliseBody(body) !== (view.body ?? '');
  const busy = pending !== null;
  const nothingToPublish =
    (!view.exists && !dirty) ||
    (view.status === 'published' && !view.hasUnpublishedChanges && !dirty);

  async function run(kind: Pending, work: () => Promise<Feedback>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(kind);
    setFeedback(null);
    const result = await work();
    setFeedback(result);
    setPending(null);
    inFlight.current = false;
  }

  async function saveDraft(): Promise<boolean> {
    const reply = await send('PUT', endpoint, { title, body });
    if (!reply.ok) return false;
    const next = entryFrom(reply.json);
    if (next) setView(next);
    return true;
  }

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) return;
    void run('save', async () => {
      if (!(await saveDraft())) return { kind: 'error', key: 'errorSave' };
      router.refresh();
      return { kind: 'ok', key: 'saved' };
    });
  }

  function onPublish() {
    setDialog(null);
    void run('publish', async () => {
      if (dirty && !(await saveDraft())) return { kind: 'error', key: 'errorSave' };
      const reply = await send('POST', `${endpoint}/publish`);
      router.refresh();
      if (!reply.ok) {
        return { kind: 'error', key: isEmptyContent(reply) ? 'errorPublishEmpty' : 'errorGeneric' };
      }
      const next = entryFrom(reply.json);
      if (next) setView(next);
      return { kind: 'ok', key: 'published' };
    });
  }

  function onUnpublish() {
    setDialog(null);
    void run('unpublish', async () => {
      const reply = await send('POST', `${endpoint}/unpublish`);
      if (!reply.ok) return { kind: 'error', key: 'errorGeneric' };
      const next = entryFrom(reply.json);
      if (next) setView(next);
      router.refresh();
      return { kind: 'ok', key: 'unpublished' };
    });
  }

  const date = (iso: string) => formatDateTime(new Date(iso), locale);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href="/content"
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-text-muted transition-colors hover:text-text focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <svg
            viewBox="0 0 20 20"
            className="size-4 rtl:-scale-x-100"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5l-5 5 5 5" />
          </svg>
          {t('editor.back')}
        </Link>

        <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-text">
                {t('editor.title', { page })}
              </h1>
              <span className="inline-flex items-center rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-xs font-semibold text-text-muted">
                {t('editor.language', { language })}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
              <EntryStateBadges entry={view} />
              <span>
                {view.status === 'published' && view.publishedAt
                  ? t('editor.publishedOn', { date: date(view.publishedAt) })
                  : t('editor.notPublished')}
              </span>
              <span>
                {view.updatedAt
                  ? t('editor.lastEdited', { date: date(view.updatedAt) })
                  : t('editor.notSavedYet')}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`${entryHref(entry.key, entry.locale)}/preview`}
              className={`${buttonBase} border border-border-strong bg-surface-raised text-text hover:bg-surface-sunken`}
            >
              {t('editor.previewLink')}
            </Link>
            {view.status === 'published' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setDialog('unpublish')}
                className={`${buttonBase} border border-border-strong bg-surface-raised text-danger hover:bg-tone-danger-bg`}
              >
                {pending === 'unpublish' ? <Spinner /> : null}
                {t('editor.unpublish')}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || nothingToPublish}
              onClick={() => setDialog('publish')}
              className={`${buttonBase} bg-primary text-primary-contrast shadow-card hover:bg-primary-hover`}
            >
              {pending === 'publish' ? <Spinner /> : null}
              {pending === 'publish' ? t('editor.publishing') : t('editor.publish')}
            </button>
          </div>
        </header>
      </div>

      {view.hasUnpublishedChanges || view.translationMissing || feedback ? (
        <div className="flex flex-col gap-3">
          {view.hasUnpublishedChanges ? (
            <Callout tone="info">{t('editor.unpublishedChangesNotice')}</Callout>
          ) : null}
          {view.translationMissing ? (
            <Callout tone="warning">{t('editor.missingTranslationNotice')}</Callout>
          ) : null}
          {feedback?.kind === 'error' ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/40 bg-tone-danger-bg px-4 py-3 text-sm font-medium text-tone-danger-fg"
            >
              {t(`editor.${feedback.key}`)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <form
          noValidate
          onSubmit={onSave}
          className="flex flex-col gap-6 rounded-card border border-border bg-surface-raised p-5 shadow-card sm:p-6"
        >
          <div className="flex flex-col gap-2">
            <label htmlFor={`${id}-title`} className="text-sm font-semibold text-text">
              {t('editor.titleLabel')}
            </label>
            <input
              id={`${id}-title`}
              name="title"
              type="text"
              value={title}
              maxLength={TITLE_MAX}
              lang={entry.locale}
              dir={entryDir}
              onChange={(e) => setTitle(e.target.value)}
              className={`${fieldClass} h-12 font-semibold`}
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor={`${id}-body`} className="text-sm font-semibold text-text">
                {t('editor.bodyLabel')}
              </label>
              <span id={`${id}-count`} className="text-xs text-text-muted tabular">
                {t('editor.count', {
                  count: formatInt(normaliseBody(body).length, locale),
                  max: formatInt(BODY_MAX, locale),
                })}
              </span>
            </div>
            <textarea
              id={`${id}-body`}
              name="body"
              value={body}
              maxLength={BODY_MAX}
              rows={18}
              lang={entry.locale}
              dir={entryDir}
              aria-describedby={`${id}-help ${id}-count`}
              onChange={(e) => setBody(e.target.value)}
              className={`${fieldClass} min-h-80 resize-y py-3 text-base leading-relaxed`}
            />
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className="text-sm text-text-muted">
              {dirty ? (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden="true" className="size-2 rounded-full bg-tone-warning-fg" />
                  {t('editor.unsaved')}
                </span>
              ) : feedback?.kind === 'ok' ? (
                <span className="inline-flex items-center gap-2 text-tone-success-fg">
                  <svg
                    viewBox="0 0 20 20"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                  </svg>
                  {t(`editor.${feedback.key}`)}
                </span>
              ) : null}
            </p>
            <button
              type="submit"
              disabled={!dirty || busy}
              className={`${buttonBase} bg-primary text-primary-contrast hover:bg-primary-hover`}
            >
              {pending === 'save' ? <Spinner /> : null}
              {pending === 'save' ? t('editor.saving') : t('editor.save')}
            </button>
          </div>
        </form>

        <aside className="lg:sticky lg:top-32">
          <details
            open
            className="group rounded-card border border-border bg-surface-sunken p-5 text-sm text-text-muted"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold text-text focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
              {t('editor.bodyHelpTitle')}
              <svg
                viewBox="0 0 20 20"
                className="size-4 text-text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5.5 8l4.5 4.5L14.5 8" />
              </svg>
            </summary>
            <div id={`${id}-help`} className="mt-4 flex flex-col gap-4">
              <p className="leading-relaxed">{t('editor.bodyHelp')}</p>
              <ul className="flex flex-col gap-2.5">
                {SYNTAX.map((item) => (
                  <li key={item} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {t.rich(`editor.syntax.${item}`, { code })}
                  </li>
                ))}
              </ul>
              <p className="leading-relaxed">{t('editor.syntax.paragraph')}</p>
            </div>
          </details>
        </aside>
      </div>

      <ConfirmDialog
        open={dialog === 'publish'}
        title={t('editor.publishTitle')}
        description={t('editor.publishBody', { language })}
        confirmLabel={t('editor.publish')}
        onConfirm={onPublish}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'unpublish'}
        tone="destructive"
        title={t('editor.unpublishTitle')}
        description={t('editor.unpublishBody', { language })}
        confirmLabel={t('editor.unpublish')}
        onConfirm={onUnpublish}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
