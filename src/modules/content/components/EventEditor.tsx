'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  EVENT_LOCATION_MAX,
  EVENT_SUMMARY_MAX,
  EVENT_TITLE_MAX,
} from '@/modules/content/event-schema';
import { pktLocalToUtcIso, utcIsoToPktLocal } from '@/modules/content/event-time';
import type { BranchOption, EventView } from '@/modules/content/event-types';
import { formatDateTime } from '@/platform/i18n/format';
import { EVENTS_HREF, EventStateBadges, eventHref } from './EventsTable';

const TEXT_FIELDS = ['titleEn', 'titleUr', 'summaryEn', 'summaryUr', 'location'] as const;
const TIME_FIELDS = ['startsAt', 'endsAt'] as const;
const FIELDS = [...TEXT_FIELDS, ...TIME_FIELDS, 'branchId'] as const;

type Field = (typeof FIELDS)[number];
type Values = Record<Field, string>;
type Payload = Partial<Record<Field, string | null>>;

type Pending = 'create' | 'save' | 'publish' | 'unpublish';
type Notice = 'saved' | 'published' | 'unpublished';
type Failure = 'errorGeneric' | 'errorFields';
type FieldError = 'errorTitleRequired' | 'errorEndsBeforeStart' | 'errorRequiredToPublish';
type Feedback = { kind: 'ok'; key: Notice } | { kind: 'error'; key: Failure };
type Reply = { ok: boolean; status: number; json: unknown };

const ENDPOINT = '/api/v1/content/events';
const PUBLIC_EVENTS_HREF = '/events';

/** Form values: free text as stored, instants as Pakistan wall-clock `datetime-local` values. */
function valuesFrom(event: EventView | null): Values {
  return {
    titleEn: event?.titleEn ?? '',
    titleUr: event?.titleUr ?? '',
    summaryEn: event?.summaryEn ?? '',
    summaryUr: event?.summaryUr ?? '',
    location: event?.location ?? '',
    startsAt: utcIsoToPktLocal(event?.startsAt ?? null),
    endsAt: utcIsoToPktLocal(event?.endsAt ?? null),
    branchId: event?.branchId ?? '',
  };
}

const isTime = (field: Field): field is (typeof TIME_FIELDS)[number] =>
  (TIME_FIELDS as readonly string[]).includes(field);

/** What the API receives for one field: trimmed text, UTC instants, and null for "none". */
function wireValue(field: Field, value: string): string | null {
  if (isTime(field)) return pktLocalToUtcIso(value);
  if (field === 'branchId') return value === '' ? null : value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Compared the way the server stores them, so surrounding spaces alone are not a change. */
const comparable = (field: Field, value: string) =>
  isTime(field) || field === 'branchId' ? value : value.trim();

function changedFields(values: Values, saved: Values): Field[] {
  return FIELDS.filter(
    (field) => comparable(field, values[field]) !== comparable(field, saved[field]),
  );
}

async function send(method: 'POST' | 'PATCH', url: string, payload?: unknown): Promise<Reply> {
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

function eventFrom(json: unknown): EventView | null {
  const data = (json as { data?: unknown } | null)?.data;
  return data && typeof data === 'object' && 'id' in data && 'status' in data
    ? (data as EventView)
    : null;
}

/** 422 field issues the editor can explain next to a field; null when there are none. */
function fieldErrorsFrom(reply: Reply): Partial<Record<Field, FieldError>> | null {
  if (reply.status !== 422) return null;
  const fields = (reply.json as { error?: { details?: { fields?: unknown } } } | null)?.error
    ?.details?.fields;
  if (!Array.isArray(fields)) return null;
  const errors: Partial<Record<Field, FieldError>> = {};
  for (const issue of fields as { path?: unknown; code?: unknown; message?: unknown }[]) {
    const path = issue?.path;
    if (typeof path !== 'string' || !(FIELDS as readonly string[]).includes(path)) continue;
    const codes = [issue.code, issue.message];
    let key: FieldError | null = null;
    if (codes.includes('ends_before_start')) key = 'errorEndsBeforeStart';
    else if (codes.includes('required_to_publish')) key = 'errorRequiredToPublish';
    else if (path === 'titleEn' && codes.includes('required')) key = 'errorTitleRequired';
    if (key && !errors[path as Field]) errors[path as Field] = key;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

const fieldClass =
  'block w-full rounded-xl border border-border-strong bg-surface-raised px-4 text-base text-text shadow-xs transition-colors hover:border-text-muted focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-75 aria-invalid:border-danger';

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

function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 rounded-xl border border-tone-info-fg/25 bg-tone-info-bg px-4 py-3 text-sm text-tone-info-fg">
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

function Legend({ children }: { children: ReactNode }) {
  return (
    <legend className="mb-4 text-xs font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </legend>
  );
}

export function EventEditor({
  event,
  branches,
}: {
  event: EventView | null;
  branches: BranchOption[];
}) {
  const t = useTranslations('content');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const id = useId();

  // `view` is the latest server state: the prop after a refresh, or the reply of a write.
  const [view, setView] = useState(event);
  const [previous, setPrevious] = useState(event);
  if (event !== previous) {
    setPrevious(event);
    setView(event);
  }

  const [values, setValues] = useState<Values>(() => valuesFrom(event));
  const [errors, setErrors] = useState<Partial<Record<Field, FieldError>>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [dialog, setDialog] = useState<'publish' | 'unpublish' | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inFlight = useRef(false);

  const isNew = view === null;
  const saved = valuesFrom(view);
  const changed = changedFields(values, saved);
  const dirty = changed.length > 0;
  const busy = pending !== null;
  const endpoint = view ? `${ENDPOINT}/${view.id}` : ENDPOINT;
  const nothingToPublish =
    view !== null && view.status === 'published' && !view.hasUnpublishedChanges && !dirty;

  // The saved branch stays selectable even when it is no longer Active, so an untouched
  // select never clears it.
  const savedBranchMissing =
    view?.branchId != null && !branches.some((branch) => branch.id === view.branchId);

  const fieldId = (field: Field) => `${id}-${field}`;
  const errorId = (field: Field) => `${id}-${field}-error`;
  const pktNoteId = `${id}-pkt`;

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const related: Field[] = isTime(field) ? [...TIME_FIELDS] : [field];
      if (!related.some((key) => current[key])) return current;
      const next = { ...current };
      for (const key of related) delete next[key];
      return next;
    });
  }

  function failureFrom(reply: Reply): Feedback {
    const fieldErrors = fieldErrorsFrom(reply);
    if (fieldErrors) {
      setErrors(fieldErrors);
      return { kind: 'error', key: 'errorFields' };
    }
    return { kind: 'error', key: 'errorGeneric' };
  }

  async function run(kind: Pending, work: () => Promise<Feedback | 'leaving'>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(kind);
    setFeedback(null);
    setErrors({});
    const result = await work();
    // Creating navigates away: stay busy so the form cannot be sent twice.
    if (result === 'leaving') return;
    setFeedback(result);
    setPending(null);
    inFlight.current = false;
  }

  /** PATCH the changed fields; null on success, otherwise the failure to show. */
  async function saveChanges(): Promise<Feedback | null> {
    const payload: Payload = Object.fromEntries(
      changed.map((field) => [field, wireValue(field, values[field])]),
    );
    const reply = await send('PATCH', endpoint, payload);
    if (!reply.ok) return failureFrom(reply);
    const next = eventFrom(reply.json);
    if (next) setView(next);
    return null;
  }

  function onSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (isNew) {
      if (values.titleEn.trim() === '') return;
      void run('create', async () => {
        const payload: Payload = Object.fromEntries(
          FIELDS.map((field) => [field, wireValue(field, values[field])]),
        );
        const reply = await send('POST', ENDPOINT, payload);
        const created = reply.ok ? eventFrom(reply.json) : null;
        if (!created) return failureFrom(reply);
        router.push(eventHref(created.id));
        return 'leaving';
      });
      return;
    }
    if (!dirty) return;
    void run('save', async () => {
      const failure = await saveChanges();
      if (failure) return failure;
      router.refresh();
      return { kind: 'ok', key: 'saved' };
    });
  }

  function onPublish() {
    setDialog(null);
    void run('publish', async () => {
      let wrote = false;
      if (dirty) {
        const failure = await saveChanges();
        if (failure) return failure;
        wrote = true;
      }
      const reply = await send('POST', `${endpoint}/publish`);
      if (!reply.ok) {
        if (wrote) router.refresh();
        return failureFrom(reply);
      }
      const next = eventFrom(reply.json);
      if (next) setView(next);
      router.refresh();
      return { kind: 'ok', key: 'published' };
    });
  }

  function onUnpublish() {
    setDialog(null);
    void run('unpublish', async () => {
      const reply = await send('POST', `${endpoint}/unpublish`);
      if (!reply.ok) return { kind: 'error', key: 'errorGeneric' };
      const next = eventFrom(reply.json);
      if (next) setView(next);
      router.refresh();
      return { kind: 'ok', key: 'unpublished' };
    });
  }

  const date = (iso: string) => formatDateTime(new Date(iso), locale);

  const describedBy = (field: Field, ...extra: string[]) =>
    [...extra, errors[field] ? errorId(field) : null].filter(Boolean).join(' ') || undefined;

  const errorText = (field: Field) =>
    errors[field] ? (
      <p id={errorId(field)} className="text-sm font-medium text-danger">
        {t(`events.editor.${errors[field]}`)}
      </p>
    ) : null;

  const label = (field: Field, key: string) => (
    <label htmlFor={fieldId(field)} className="text-sm font-semibold text-text">
      {t(`events.editor.${key}`)}
    </label>
  );

  const textInput = (
    field: 'titleEn' | 'titleUr' | 'location',
    lang: 'en' | 'ur' | null,
    max: number,
    extra = '',
  ) => (
    <input
      id={fieldId(field)}
      name={field}
      type="text"
      value={values[field]}
      maxLength={max}
      lang={lang ?? undefined}
      dir={lang === 'ur' ? 'rtl' : lang === 'en' ? 'ltr' : 'auto'}
      required={field === 'titleEn'}
      aria-invalid={errors[field] ? true : undefined}
      aria-describedby={describedBy(field)}
      onChange={(e) => update(field, e.target.value)}
      className={`${fieldClass} h-11 ${extra}`}
    />
  );

  const summaryInput = (field: 'summaryEn' | 'summaryUr', lang: 'en' | 'ur') => (
    <textarea
      id={fieldId(field)}
      name={field}
      value={values[field]}
      maxLength={EVENT_SUMMARY_MAX}
      rows={5}
      lang={lang}
      dir={lang === 'ur' ? 'rtl' : 'ltr'}
      onChange={(e) => update(field, e.target.value)}
      className={`${fieldClass} min-h-32 resize-y py-3 leading-relaxed`}
    />
  );

  const timeInput = (field: (typeof TIME_FIELDS)[number]) => (
    <div className="flex flex-col gap-2">
      {label(field, field)}
      <input
        id={fieldId(field)}
        name={field}
        type="datetime-local"
        value={values[field]}
        dir="ltr"
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={describedBy(field, pktNoteId)}
        onChange={(e) => update(field, e.target.value)}
        className={`${fieldClass} h-11 tabular`}
      />
      {errorText(field)}
    </div>
  );

  const submitKey = isNew
    ? pending === 'create'
      ? 'creating'
      : 'create'
    : pending === 'save'
      ? 'saving'
      : 'save';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Link
          href={EVENTS_HREF}
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
          {t('events.editor.back')}
        </Link>

        <header className="flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              {isNew ? t('events.editor.newTitle') : t('events.editor.editTitle')}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-muted">
              {view ? (
                <>
                  <EventStateBadges event={view} />
                  <span>
                    {view.status === 'published' && view.publishedAt
                      ? t('editor.publishedOn', { date: date(view.publishedAt) })
                      : t('editor.notPublished')}
                  </span>
                  <span>{t('editor.lastEdited', { date: date(view.updatedAt) })}</span>
                </>
              ) : (
                <span>{t('editor.notSavedYet')}</span>
              )}
            </div>
          </div>

          {view ? (
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={PUBLIC_EVENTS_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonBase} border border-border-strong bg-surface-raised text-text hover:bg-surface-sunken`}
              >
                {t('events.editor.publicLink')}
                <svg
                  viewBox="0 0 20 20"
                  className="size-4 text-text-muted rtl:-scale-x-100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 5H5.5A1.5 1.5 0 004 6.5v8A1.5 1.5 0 005.5 16h8a1.5 1.5 0 001.5-1.5V12M11 4h5v5M16 4l-7 7" />
                </svg>
              </Link>
              {view.status === 'published' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog('unpublish')}
                  className={`${buttonBase} border border-border-strong bg-surface-raised text-danger hover:bg-tone-danger-bg`}
                >
                  {pending === 'unpublish' ? <Spinner /> : null}
                  {t('events.editor.unpublish')}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || nothingToPublish}
                onClick={() => setDialog('publish')}
                className={`${buttonBase} bg-primary text-primary-contrast shadow-card hover:bg-primary-hover`}
              >
                {pending === 'publish' ? <Spinner /> : null}
                {pending === 'publish' ? t('events.editor.publishing') : t('events.editor.publish')}
              </button>
            </div>
          ) : null}
        </header>
      </div>

      {view?.hasUnpublishedChanges || feedback?.kind === 'error' ? (
        <div className="flex flex-col gap-3">
          {view?.hasUnpublishedChanges ? (
            <Callout>{t('events.editor.unpublishedChangesNotice')}</Callout>
          ) : null}
          {feedback?.kind === 'error' ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/40 bg-tone-danger-bg px-4 py-3 text-sm font-medium text-tone-danger-fg"
            >
              {t(`events.editor.${feedback.key}`)}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col rounded-card border border-border bg-surface-raised shadow-card"
      >
        <div className="grid gap-8 p-5 sm:p-6 lg:grid-cols-2">
          <fieldset className="flex min-w-0 flex-col gap-5">
            <Legend>{t('columns.english')}</Legend>
            <div className="flex flex-col gap-2">
              {label('titleEn', 'titleEn')}
              {textInput('titleEn', 'en', EVENT_TITLE_MAX, 'font-semibold')}
              {errorText('titleEn')}
            </div>
            <div className="flex flex-col gap-2">
              {label('summaryEn', 'summaryEn')}
              {summaryInput('summaryEn', 'en')}
            </div>
          </fieldset>

          <fieldset className="flex min-w-0 flex-col gap-5">
            <Legend>{t('columns.urdu')}</Legend>
            <div className="flex flex-col gap-2">
              {label('titleUr', 'titleUr')}
              {textInput('titleUr', 'ur', EVENT_TITLE_MAX, 'font-semibold')}
            </div>
            <div className="flex flex-col gap-2">
              {label('summaryUr', 'summaryUr')}
              {summaryInput('summaryUr', 'ur')}
            </div>
          </fieldset>
        </div>

        <fieldset className="flex min-w-0 flex-col gap-5 border-t border-border p-5 sm:p-6">
          <Legend>{t('events.editor.details')}</Legend>
          <div className="grid gap-5 sm:grid-cols-2">
            {timeInput('startsAt')}
            {timeInput('endsAt')}
          </div>
          <p
            id={pktNoteId}
            className="-mt-1 flex items-start gap-2 text-sm leading-relaxed text-text-muted"
          >
            <svg
              viewBox="0 0 20 20"
              className="mt-0.5 size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="7.25" />
              <path d="M10 6v4l2.5 2" />
            </svg>
            <span>{t('events.editor.pktNote')}</span>
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              {label('location', 'location')}
              {textInput('location', null, EVENT_LOCATION_MAX)}
            </div>
            <div className="flex flex-col gap-2">
              {label('branchId', 'branch')}
              <div className="relative">
                <select
                  id={fieldId('branchId')}
                  name="branchId"
                  value={values.branchId}
                  onChange={(e) => update('branchId', e.target.value)}
                  className={`${fieldClass} h-11 cursor-pointer appearance-none pe-11`}
                >
                  <option value="">{t('events.editor.noBranch')}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                  {savedBranchMissing && view?.branchId ? (
                    <option value={view.branchId}>
                      {t('events.editor.branchInactive', {
                        name: view.branchName ?? view.branchId,
                      })}
                    </option>
                  ) : null}
                </select>
                <svg
                  viewBox="0 0 20 20"
                  className="pointer-events-none absolute end-4 top-1/2 size-5 -translate-y-1/2 text-text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5.5 8l4.5 4.5L14.5 8" />
                </svg>
              </div>
            </div>
          </div>
        </fieldset>

        <div className="flex flex-col-reverse gap-3 border-t border-border bg-surface-sunken/50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p role="status" className="text-sm text-text-muted">
            {dirty && !isNew ? (
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
                {t(`events.editor.${feedback.key}`)}
              </span>
            ) : null}
          </p>
          <button
            type="submit"
            disabled={busy || (isNew ? values.titleEn.trim() === '' : !dirty)}
            className={`${buttonBase} bg-primary text-primary-contrast hover:bg-primary-hover`}
          >
            {pending === 'create' || pending === 'save' ? <Spinner /> : null}
            {t(`events.editor.${submitKey}`)}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={dialog === 'publish'}
        title={t('events.editor.publishTitle')}
        description={t('events.editor.publishBody')}
        confirmLabel={t('events.editor.publish')}
        onConfirm={onPublish}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'unpublish'}
        tone="destructive"
        title={t('events.editor.unpublishTitle')}
        description={t('events.editor.unpublishBody')}
        confirmLabel={t('events.editor.unpublish')}
        onConfirm={onUnpublish}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
