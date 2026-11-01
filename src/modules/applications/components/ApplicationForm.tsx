'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { APPLICATION_ERROR_CODES, applicationInputSchema } from '@/modules/applications/schema';

export interface ApplicationFormProps {
  branches: { id: string; name: string; city: string | null }[];
  defaultBranchId?: string;
}

type FieldName = 'fullName' | 'email' | 'phone' | 'message' | 'branchId';
type Values = Record<FieldName, string> & { website: string };
type FieldErrors = Partial<Record<FieldName, string>>;
type FormError = 'duplicate' | 'rateLimited' | 'generic';

// Visual order: the summary and first-error focus follow it.
const FIELDS: readonly FieldName[] = ['fullName', 'email', 'phone', 'branchId', 'message'];
const MESSAGE_KEY: Record<FieldName, string> = {
  fullName: 'fullName',
  email: 'email',
  phone: 'phone',
  message: 'message',
  branchId: 'branch',
};
const OPTIONAL: ReadonlySet<FieldName> = new Set(['phone', 'message']);
const ENDPOINT = '/api/v1/public/applications';
const THANKS_PATH = '/get-involved/apply/thanks';

const isField = (value: unknown): value is FieldName =>
  typeof value === 'string' && (FIELDS as readonly string[]).includes(value);
const isKnownCode = (value: unknown): value is string =>
  typeof value === 'string' && (APPLICATION_ERROR_CODES as readonly string[]).includes(value);

function payloadOf(values: Values) {
  return {
    fullName: values.fullName.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    message: values.message.trim(),
    branchId: values.branchId,
    website: values.website,
  };
}

// First schema issue per field; the issue message is the stable error code.
function validate(values: Values): FieldErrors {
  const result = applicationInputSchema.safeParse(payloadOf(values));
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const name = issue.path[0];
    if (isField(name) && !errors[name]) errors[name] = issue.message;
  }
  return errors;
}

function serverFieldErrors(body: unknown): FieldErrors {
  const fields = (body as { error?: { details?: { fields?: unknown } } } | null)?.error?.details
    ?.fields;
  const errors: FieldErrors = {};
  if (!Array.isArray(fields)) return errors;
  for (const item of fields as { path?: unknown; message?: unknown }[]) {
    const name = typeof item?.path === 'string' ? item.path.split('.')[0] : undefined;
    if (isField(name) && !errors[name]) {
      errors[name] = isKnownCode(item.message) ? item.message : 'generic';
    }
  }
  return errors;
}

const firstInvalid = (errors: FieldErrors) => FIELDS.find((name) => errors[name]);

const ltr = (chunks: ReactNode) => <bdi dir="ltr">{chunks}</bdi>;

const inputClass =
  'block min-h-12 w-full rounded-xl border border-border-strong bg-surface-raised px-4 py-3 text-base text-text shadow-xs transition-colors hover:border-text-muted focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-invalid:border-danger aria-invalid:bg-tone-danger-bg/30';

export function ApplicationForm({ branches, defaultBranchId }: ApplicationFormProps) {
  const t = useTranslations('applications.form');
  const router = useRouter();
  const id = useId();
  const fieldId = (name: FieldName | 'website') => `${id}-${name}`;

  const initialBranch = branches.some((b) => b.id === defaultBranchId) ? defaultBranchId! : '';
  const [values, setValues] = useState<Values>({
    fullName: '',
    email: '',
    phone: '',
    message: '',
    branchId: initialBranch,
    website: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<FieldName[]>([]);
  const [formError, setFormError] = useState<{ kind: FormError; nonce: number } | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (formError) bannerRef.current?.focus();
  }, [formError]);

  const errorText = (code: string) =>
    t.rich(`errors.${isKnownCode(code) ? code : 'generic'}`, { ltr });

  const focusField = (name: FieldName) => document.getElementById(fieldId(name))?.focus();

  function showFieldErrors(next: FieldErrors) {
    setErrors(next);
    setSummary(FIELDS.filter((name) => next[name]));
    const first = firstInvalid(next);
    if (first) focusField(first);
  }

  function onChange(name: FieldName | 'website') {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const next = { ...values, [name]: event.target.value };
      setValues(next);
      if (name !== 'website' && errors[name]) {
        const code = validate(next)[name];
        setErrors((current) => ({ ...current, [name]: code }));
      }
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setFormError(null);

    const clientErrors = validate(values);
    if (firstInvalid(clientErrors)) {
      showFieldErrors(clientErrors);
      return;
    }
    showFieldErrors({});

    inFlight.current = true;
    setPending(true);
    const fail = (kind: FormError) => {
      inFlight.current = false;
      setPending(false);
      setFormError({ kind, nonce: Date.now() });
    };

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payloadOf(values)),
      });
    } catch {
      fail('generic');
      return;
    }

    if (response.status === 201) {
      // Stay pending while the confirmation page loads so the form cannot be sent twice.
      router.push(THANKS_PATH);
      return;
    }
    if (response.status === 422) {
      const serverErrors = serverFieldErrors(await response.json().catch(() => null));
      if (firstInvalid(serverErrors)) {
        inFlight.current = false;
        setPending(false);
        showFieldErrors(serverErrors);
        return;
      }
    }
    fail(
      response.status === 409 ? 'duplicate' : response.status === 429 ? 'rateLimited' : 'generic',
    );
  }

  function onSummaryLink(name: FieldName) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      focusField(name);
    };
  }

  function describedBy(name: FieldName) {
    return [`${fieldId(name)}-hint`, errors[name] ? `${fieldId(name)}-error` : null]
      .filter(Boolean)
      .join(' ');
  }

  function label(name: FieldName) {
    return (
      <label
        htmlFor={fieldId(name)}
        className="flex items-baseline gap-2 text-base font-semibold text-text"
      >
        {t(`fields.${MESSAGE_KEY[name]}.label`)}
        {OPTIONAL.has(name) ? (
          <span className="text-sm font-normal text-text-muted">{t('optional')}</span>
        ) : null}
      </label>
    );
  }

  function hintAndError(name: FieldName) {
    const code = errors[name];
    return (
      <>
        <p id={`${fieldId(name)}-hint`} className="text-sm text-text-muted">
          {t.rich(`fields.${MESSAGE_KEY[name]}.hint`, { ltr })}
        </p>
        {code ? (
          <p
            id={`${fieldId(name)}-error`}
            data-error="true"
            className="flex items-start gap-1.5 text-sm font-medium text-danger"
          >
            <svg
              viewBox="0 0 20 20"
              className="mt-0.5 size-4 shrink-0"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm-.75 4.5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zM10 14.75a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
            <span>{errorText(code)}</span>
          </p>
        ) : null}
      </>
    );
  }

  const common = (name: FieldName) => ({
    id: fieldId(name),
    name,
    value: values[name],
    onChange: onChange(name),
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': describedBy(name),
  });

  return (
    <form noValidate onSubmit={onSubmit} className="relative flex w-full max-w-xl flex-col gap-7">
      {summary.length > 0 ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/40 bg-tone-danger-bg px-5 py-4 text-tone-danger-fg"
        >
          <p className="font-semibold">{t('errors.summary', { count: summary.length })}</p>
          <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-sm">
            {summary.map((name) => (
              <li key={name}>
                <a
                  href={`#${fieldId(name)}`}
                  onClick={onSummaryLink(name)}
                  className="font-medium underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tone-danger-fg"
                >
                  {t(`fields.${MESSAGE_KEY[name]}.label`)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {formError ? (
        <div
          key={formError.nonce}
          ref={bannerRef}
          role="alert"
          tabIndex={-1}
          className="flex items-start gap-3 rounded-xl border border-danger/40 bg-tone-danger-bg px-5 py-4 text-tone-danger-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          <svg
            viewBox="0 0 20 20"
            className="mt-0.5 size-5 shrink-0"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm-.75 4.5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zM10 14.75a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
          <p className="font-medium">{t(`errors.${formError.kind}`)}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {label('fullName')}
        {hintAndError('fullName')}
        <input {...common('fullName')} type="text" autoComplete="name" className={inputClass} />
      </div>

      <div className="flex flex-col gap-2">
        {label('email')}
        {hintAndError('email')}
        <input
          {...common('email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          dir="ltr"
          className={`${inputClass} rtl:text-end`}
        />
      </div>

      <div className="flex flex-col gap-2">
        {label('phone')}
        {hintAndError('phone')}
        <input
          {...common('phone')}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          className={`${inputClass} rtl:text-end`}
        />
      </div>

      <div className="flex flex-col gap-2">
        {label('branchId')}
        {hintAndError('branchId')}
        <div className="relative">
          <select
            {...common('branchId')}
            className={`${inputClass} cursor-pointer appearance-none pe-11`}
          >
            <option value="">{t('branchPlaceholder')}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.city
                  ? t('branchOption', { name: branch.name, city: branch.city })
                  : branch.name}
              </option>
            ))}
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

      <div className="flex flex-col gap-2">
        {label('message')}
        {hintAndError('message')}
        <textarea
          {...common('message')}
          rows={5}
          className={`${inputClass} resize-y leading-relaxed`}
        />
      </div>

      <div aria-hidden="true" className="absolute -start-[9999px] top-0 size-px overflow-hidden">
        <label htmlFor={fieldId('website')}>{t('honeypot')}</label>
        <input
          id={fieldId('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={onChange('website')}
        />
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-contrast shadow-card transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-progress disabled:opacity-75 sm:w-auto"
        >
          {pending ? (
            <svg
              viewBox="0 0 24 24"
              className="size-5 animate-spin motion-reduce:animate-none"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="3"
              />
              <path
                d="M21 12a9 9 0 00-9-9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          ) : null}
          {pending ? t('submitting') : t('submit')}
        </button>
      </div>
    </form>
  );
}
