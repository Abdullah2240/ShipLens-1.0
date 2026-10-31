'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { addDays, type DateString } from '@/platform/time';
import { collectionInputSchema, collectionPatchSchema } from '../schema';
import type { CollectionItem } from '../types';
import { asErrorCode, readApiFailure, type ErrorCode, type FieldErrors } from './api-errors';

export const PURPOSE_KEYS = [
  'rationPacks',
  'schoolFees',
  'medicalCamp',
  'floodRelief',
  'generalDonations',
  'winterClothing',
] as const;

const FIELDS = ['amount', 'collectedOn', 'purpose', 'note'] as const;
type Field = (typeof FIELDS)[number];
type Values = Record<Field, string>;
type Feedback = 'logged' | 'saved' | null;

export type CollectionFormProps =
  | { mode: 'create'; today: DateString; minDate: DateString; collection?: undefined }
  | {
      mode: 'edit';
      today: DateString;
      minDate: DateString;
      collection: Pick<
        CollectionItem,
        'id' | 'amount' | 'collectedOn' | 'purpose' | 'note' | 'weekStart' | 'editability'
      >;
    };

const valuesOf = (collection: CollectionFormProps['collection'], today: DateString): Values => ({
  amount: collection?.amount ?? '',
  collectedOn: collection?.collectedOn ?? today,
  purpose: collection?.purpose ?? '',
  note: collection?.note ?? '',
});

/** Only the fields that differ from the stored collection. */
function changes(base: Values, next: Values): Record<string, string | null> {
  const patch: Record<string, string | null> = {};
  if (next.amount.trim() !== base.amount) patch.amount = next.amount.trim();
  if (next.collectedOn !== base.collectedOn) patch.collectedOn = next.collectedOn;
  if (next.purpose.trim() !== base.purpose) patch.purpose = next.purpose;
  if (next.note.trim() !== base.note) patch.note = next.note.trim() === '' ? null : next.note;
  return patch;
}

function issuesToFields(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  const fields: FieldErrors<Field> = {};
  let form: ErrorCode | null = null;
  for (const issue of issues) {
    const name = FIELDS.find((field) => field === issue.path[0]);
    const code = asErrorCode(issue.message) ?? 'generic';
    if (name) fields[name] ??= code;
    else form ??= code;
  }
  return { fields, form };
}

const fieldClass =
  'block h-11 w-full rounded-lg border border-border-strong/50 bg-surface-raised text-base text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 aria-invalid:border-danger sm:text-sm';

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

/** Log a new collection, or amend an editable one (only changed fields are sent). */
export function CollectionForm(props: CollectionFormProps) {
  const { mode, today, minDate, collection } = props;
  const t = useTranslations('collections');
  const router = useRouter();
  const id = useId();
  const editing = mode === 'edit';

  const [base, setBase] = useState(() => valuesOf(collection, today));
  const [previous, setPrevious] = useState(collection);
  const [values, setValues] = useState(base);
  if (collection !== previous) {
    // The server sent a fresh copy after a refresh: start from it.
    const fresh = valuesOf(collection, today);
    setPrevious(collection);
    setBase(fresh);
    setValues(fresh);
  }

  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [formError, setFormError] = useState<ErrorCode | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  // Amending keeps the date in its own PKT week; an exempt (returned) report may use any day
  // of that week up to today.
  let min = minDate;
  let max = today;
  if (editing && collection) {
    const weekEnd = addDays(collection.weekStart, 6);
    min =
      collection.editability === 'editable_exempt' || collection.weekStart > minDate
        ? collection.weekStart
        : minDate;
    if (weekEnd < max) max = weekEnd;
  }

  const patch = editing ? changes(base, values) : {};
  const dirty = editing ? Object.keys(patch).length > 0 : true;

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    setFeedback(null);
    setFormError(null);
  }

  function focusFirst(fields: FieldErrors<Field>) {
    const first = FIELDS.find((field) => fields[field]);
    if (first) document.getElementById(`${id}-${first}`)?.focus();
  }

  async function send(method: 'POST' | 'PATCH', url: string, body: unknown) {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: unknown = await response.json().catch(() => null);
    return { ok: response.ok, json };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setFeedback(null);
    setFormError(null);

    let body: unknown;
    if (editing) {
      const parsed = collectionPatchSchema.safeParse(patch);
      if (!parsed.success) {
        const found = issuesToFields(parsed.error.issues);
        setErrors(found.fields);
        setFormError(found.form);
        focusFirst(found.fields);
        return;
      }
      body = patch;
    } else {
      const input = {
        amount: values.amount.trim(),
        collectedOn: values.collectedOn,
        purpose: values.purpose,
        ...(values.note.trim() ? { note: values.note } : {}),
      };
      const parsed = collectionInputSchema.safeParse(input);
      if (!parsed.success) {
        const found = issuesToFields(parsed.error.issues);
        setErrors(found.fields);
        setFormError(found.form);
        focusFirst(found.fields);
        return;
      }
      body = input;
    }

    setErrors({});
    inFlight.current = true;
    setPending(true);
    try {
      const result = editing
        ? await send('PATCH', `/api/v1/collections/${collection?.id ?? ''}`, body)
        : await send('POST', '/api/v1/collections', body);
      if (result.ok) {
        if (editing) {
          setBase(values);
          setFeedback('saved');
        } else {
          const fresh = valuesOf(undefined, today);
          setValues({ ...fresh, collectedOn: values.collectedOn });
          setFeedback('logged');
          document.getElementById(`${id}-amount`)?.focus();
        }
        router.refresh();
      } else {
        const failure = readApiFailure(result.json, FIELDS);
        setErrors(failure.fields);
        setFormError(failure.form);
        focusFirst(failure.fields);
      }
    } catch {
      setFormError('generic');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const describedBy = (field: Field, hint: boolean) =>
    [hint ? `${id}-${field}-hint` : null, errors[field] ? `${id}-${field}-error` : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const fieldError = (field: Field): ReactNode =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} className="text-sm font-medium text-tone-danger-fg">
        {t(`errors.${errors[field]}`)}
      </p>
    ) : null;

  const labelClass = 'text-sm font-semibold text-text';
  const hintClass = 'text-xs text-text-muted';

  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-amount`} className={labelClass}>
            {t('form.amount')}
          </label>
          <div className="relative" dir="ltr">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 start-0 flex items-center ps-3 text-sm font-semibold text-text-muted"
            >
              {t('form.currency')}
            </span>
            <input
              id={`${id}-amount`}
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              value={values.amount}
              disabled={pending}
              placeholder="0.00"
              aria-invalid={errors.amount ? true : undefined}
              aria-describedby={describedBy('amount', true)}
              onChange={(event) => update('amount', event.target.value)}
              className={`${fieldClass} ps-13 pe-3 text-end font-semibold tabular placeholder:font-normal placeholder:text-text-muted/70`}
            />
          </div>
          <p id={`${id}-amount-hint`} className={hintClass}>
            {t('form.amountHint')}
          </p>
          {fieldError('amount')}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-collectedOn`} className={labelClass}>
            {t('form.date')}
          </label>
          <input
            id={`${id}-collectedOn`}
            name="collectedOn"
            type="date"
            required
            min={min}
            max={max}
            dir="ltr"
            value={values.collectedOn}
            disabled={pending}
            aria-invalid={errors.collectedOn ? true : undefined}
            aria-describedby={describedBy('collectedOn', true)}
            onChange={(event) => update('collectedOn', event.target.value)}
            className={`${fieldClass} px-3 tabular`}
          />
          <p id={`${id}-collectedOn-hint`} className={hintClass}>
            {t('form.dateHint')}
          </p>
          {fieldError('collectedOn')}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-purpose`} className={labelClass}>
          {t('form.purpose')}
        </label>
        <input
          id={`${id}-purpose`}
          name="purpose"
          type="text"
          list={`${id}-purposes`}
          dir="auto"
          maxLength={120}
          autoComplete="off"
          value={values.purpose}
          disabled={pending}
          aria-invalid={errors.purpose ? true : undefined}
          aria-describedby={describedBy('purpose', true)}
          onChange={(event) => update('purpose', event.target.value)}
          className={`${fieldClass} px-3`}
        />
        <datalist id={`${id}-purposes`}>
          {PURPOSE_KEYS.map((key) => (
            <option key={key} value={t(`purposes.${key}`)} />
          ))}
        </datalist>
        <p id={`${id}-purpose-hint`} className={hintClass}>
          {t('form.purposeHint')}
        </p>
        {fieldError('purpose')}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-note`} className={`${labelClass} flex items-baseline gap-2`}>
          {t('form.note')}
          <span className="text-xs font-normal text-text-muted">{t('form.optional')}</span>
        </label>
        <textarea
          id={`${id}-note`}
          name="note"
          rows={2}
          dir="auto"
          maxLength={500}
          value={values.note}
          disabled={pending}
          aria-invalid={errors.note ? true : undefined}
          aria-describedby={describedBy('note', true)}
          onChange={(event) => update('note', event.target.value)}
          className={`${fieldClass} h-auto resize-y px-3 py-2`}
        />
        <p id={`${id}-note-hint`} className={hintClass}>
          {t('form.noteHint')}
        </p>
        {fieldError('note')}
      </div>

      {formError ? (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-danger/40 bg-tone-danger-bg px-4 py-3 text-sm font-medium text-tone-danger-fg"
        >
          <svg
            viewBox="0 0 20 20"
            className="mt-0.5 size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="6.5" />
            <path d="M10 6.5v4.5M10 13.5v.01" />
          </svg>
          <span>{t(`errors.${formError}`)}</span>
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="min-h-5 text-sm">
          {feedback ? (
            <span className="inline-flex items-center gap-2 font-medium text-tone-success-fg">
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
              {t(`form.${feedback}`)}
            </span>
          ) : editing && dirty ? (
            <span className="text-text-muted">{t('form.editHint')}</span>
          ) : null}
        </p>
        <button
          type="submit"
          disabled={pending || !dirty}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-contrast shadow-xs transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 sm:h-10"
        >
          {pending ? <Spinner /> : null}
          {editing
            ? pending
              ? t('form.saving')
              : t('form.save')
            : pending
              ? t('form.submitting')
              : t('form.submit')}
        </button>
      </div>
    </form>
  );
}
