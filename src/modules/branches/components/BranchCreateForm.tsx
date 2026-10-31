'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { branchCreateSchema } from '@/modules/branches/schema';
import type { BranchDetail } from '@/modules/branches/types';
import {
  CheckIcon,
  ErrorNote,
  Spinner,
  errorKey,
  fieldClass,
  primaryButton,
  sendJson,
  type ErrorKey,
} from './form-kit';

type Field = 'name' | 'city' | 'summary';
type Values = Record<Field, string>;
type FieldErrors = Partial<Record<Field, ErrorKey>>;

/** Wraps text in an LTR isolate (U+2066 ... U+2069) so codes stay intact in Urdu. */
const ltr = (text: string) => `${String.fromCharCode(0x2066)}${text}${String.fromCharCode(0x2069)}`;

const EMPTY: Values = { name: '', city: '', summary: '' };
const FIELDS: readonly Field[] = ['name', 'city', 'summary'];
const isField = (value: unknown): value is Field => FIELDS.includes(value as Field);

/** Client-side check with the same schema the API applies. */
function validate(values: Values): FieldErrors {
  const parsed = branchCreateSchema.safeParse(values);
  if (parsed.success) return {};
  const errors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (isField(field) && !errors[field]) errors[field] = errorKey(issue.message);
  }
  return errors;
}

function createdCode(data: unknown): string | null {
  const code = (data as Partial<BranchDetail> | null)?.code;
  return typeof code === 'string' ? code : null;
}

export function BranchCreateForm() {
  const t = useTranslations('branches');
  const router = useRouter();
  const id = useId();

  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ErrorKey | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    setCreated(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setFailure(null);
    setCreated(null);
    const found = validate(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      if (found.name) nameRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setErrors({});
    const reply = await sendJson('POST', '/api/v1/branches', {
      name: values.name.trim(),
      city: values.city.trim() || null,
      summary: values.summary.trim() || null,
    });
    if (reply.ok) {
      setValues(EMPTY);
      setCreated(createdCode(reply.data) ?? '');
      router.refresh();
    } else if (reply.code === 'duplicate_branch_name') {
      setErrors({ name: 'duplicate_branch_name' });
      nameRef.current?.focus();
    } else if (reply.status === 422 && reply.fields.some((f) => isField(f.path))) {
      const next: FieldErrors = {};
      for (const issue of reply.fields) {
        if (isField(issue.path) && !next[issue.path]) next[issue.path] = issue.reason;
      }
      setErrors(next);
    } else {
      setFailure('generic');
    }
    setPending(false);
    inFlight.current = false;
  }

  const describedBy = (field: Field, hint?: string) =>
    [hint, errors[field] ? `${id}-${field}-error` : null].filter(Boolean).join(' ') || undefined;

  const fieldError = (field: Field) =>
    errors[field] ? (
      <p id={`${id}-${field}-error`} className="text-xs font-medium text-tone-danger-fg">
        {t(`errors.${errors[field]}`)}
      </p>
    ) : null;

  const optional = (
    <span className="text-xs font-normal text-text-muted">{t('create.optional')}</span>
  );

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-semibold text-text">
            {t('create.name')}
          </label>
          <input
            ref={nameRef}
            id={`${id}-name`}
            name="name"
            type="text"
            required
            maxLength={80}
            autoComplete="off"
            dir="auto"
            value={values.name}
            disabled={pending}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy('name')}
            onChange={(e) => update('name', e.target.value)}
            className={`${fieldClass} h-10`}
          />
          {fieldError('name')}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${id}-city`}
            className="flex items-baseline justify-between gap-2 text-sm font-semibold text-text"
          >
            {t('create.city')}
            {optional}
          </label>
          <input
            id={`${id}-city`}
            name="city"
            type="text"
            maxLength={60}
            autoComplete="off"
            dir="auto"
            value={values.city}
            disabled={pending}
            aria-invalid={errors.city ? true : undefined}
            aria-describedby={describedBy('city')}
            onChange={(e) => update('city', e.target.value)}
            className={`${fieldClass} h-10`}
          />
          {fieldError('city')}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${id}-summary`}
          className="flex items-baseline justify-between gap-2 text-sm font-semibold text-text"
        >
          {t('create.summary')}
          {optional}
        </label>
        <textarea
          id={`${id}-summary`}
          name="summary"
          rows={3}
          maxLength={500}
          dir="auto"
          value={values.summary}
          disabled={pending}
          aria-invalid={errors.summary ? true : undefined}
          aria-describedby={describedBy('summary')}
          onChange={(e) => update('summary', e.target.value)}
          className={`${fieldClass} py-2 leading-relaxed`}
        />
        {fieldError('summary')}
      </div>

      {failure ? <ErrorNote>{t(`errors.${failure}`)}</ErrorNote> : null}

      <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p role="status" className="text-sm">
          {created !== null ? (
            <span className="inline-flex items-center gap-2 font-medium text-tone-success-fg">
              <CheckIcon />
              <span>{t('create.success', { code: ltr(created) })}</span>
            </span>
          ) : null}
        </p>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? <Spinner /> : null}
          {pending ? t('create.submitting') : t('create.submit')}
        </button>
      </div>
    </form>
  );
}
