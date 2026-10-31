'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter as usePlainRouter } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { safeNextPath } from '../next-path';

export interface LoginFormProps {
  /** Where to go after login: a same-origin, already locale-prefixed path, or null. */
  next?: string | null;
}

type Field = 'email' | 'password';
type FieldError = 'required' | 'invalidEmail' | 'invalidPassword';
type FieldErrors = Partial<Record<Field, FieldError>>;
type FormError =
  | { kind: 'invalidCredentials' | 'generic'; nonce: number }
  | { kind: 'tooManyAttempts'; minutes: number; nonce: number };

const ENDPOINT = '/api/v1/auth/login';
const FIELDS: readonly Field[] = ['email', 'password'];
// The throttle window, used only when a 429 carries no usable Retry-After.
const FALLBACK_RETRY_SECONDS = 15 * 60;

function retryMinutes(response: Response, body: unknown): number {
  const header = Number(response.headers.get('retry-after'));
  const fromBody = (body as { error?: { details?: { retryAfterSeconds?: unknown } } } | null)?.error
    ?.details?.retryAfterSeconds;
  const seconds =
    Number.isFinite(header) && header > 0
      ? header
      : typeof fromBody === 'number' && fromBody > 0
        ? fromBody
        : FALLBACK_RETRY_SECONDS;
  return Math.max(1, Math.ceil(seconds / 60));
}

function isField(value: unknown): value is Field {
  return value === 'email' || value === 'password';
}

function fieldErrorFor(name: Field, value: string): FieldError {
  if (value.trim() === '') return 'required';
  return name === 'email' ? 'invalidEmail' : 'invalidPassword';
}

function validate(values: Record<Field, string>): FieldErrors {
  const errors: FieldErrors = {};
  for (const name of FIELDS) if (values[name].trim() === '') errors[name] = 'required';
  return errors;
}

// 422 bodies carry { error: { details: { fields: [{ path, code, message }] } } }.
function serverFieldErrors(body: unknown, values: Record<Field, string>): FieldErrors {
  const fields = (body as { error?: { details?: { fields?: unknown } } } | null)?.error?.details
    ?.fields;
  const errors: FieldErrors = {};
  if (!Array.isArray(fields)) return errors;
  for (const item of fields as { path?: unknown }[]) {
    const name = typeof item?.path === 'string' ? item.path.split('.')[0] : undefined;
    if (isField(name) && !errors[name]) errors[name] = fieldErrorFor(name, values[name]);
  }
  return errors;
}

const inputClass =
  'block h-12 w-full rounded-xl border border-border-strong bg-surface-raised text-base text-text shadow-xs transition-[border-color,box-shadow] placeholder:text-text-muted/70 hover:border-text-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 aria-invalid:border-danger aria-invalid:focus-visible:ring-danger/20';

function AlertIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={`shrink-0 ${className}`}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm-.75 4.5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zM10 14.75a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
  );
}

export function LoginForm({ next = null }: LoginFormProps) {
  const t = useTranslations('auth');
  const router = useRouter();
  const plainRouter = usePlainRouter();
  const id = useId();
  const fieldId = (name: Field) => `${id}-${name}`;

  const [values, setValues] = useState<Record<Field, string>>({ email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inFlight = useRef(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (formError) alertRef.current?.focus();
  }, [formError]);

  const focusField = (name: Field) => document.getElementById(fieldId(name))?.focus();

  function showFieldErrors(next: FieldErrors) {
    setErrors(next);
    const first = FIELDS.find((name) => next[name]);
    if (first) focusField(first);
  }

  function onChange(name: Field) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setValues((current) => ({ ...current, [name]: value }));
      if (errors[name] && value.trim() !== '') {
        setErrors((current) => ({ ...current, [name]: undefined }));
      }
    };
  }

  function fail(error: FormError, clearPassword = false) {
    inFlight.current = false;
    setPending(false);
    if (clearPassword) setValues((current) => ({ ...current, password: '' }));
    setFormError(error);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setFormError(null);

    const clientErrors = validate(values);
    if (FIELDS.some((name) => clientErrors[name])) {
      showFieldErrors(clientErrors);
      return;
    }
    setErrors({});

    inFlight.current = true;
    setPending(true);
    const nonce = Date.now();

    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: values.email.trim(), password: values.password }),
      });
    } catch {
      fail({ kind: 'generic', nonce });
      return;
    }

    if (response.ok) {
      // Stay pending while the next page loads so the form cannot be sent twice. A next
      // path already carries its locale, so it goes through the plain router: the
      // locale-aware one would prefix it a second time ("/en/ur/...").
      const target = safeNextPath(next);
      if (target) plainRouter.replace(target);
      else router.replace('/account');
      return;
    }

    const body: unknown = await response.json().catch(() => null);
    if (response.status === 401) {
      fail({ kind: 'invalidCredentials', nonce }, true);
      return;
    }
    if (response.status === 429) {
      fail({ kind: 'tooManyAttempts', minutes: retryMinutes(response, body), nonce }, true);
      return;
    }
    if (response.status === 422) {
      const serverErrors = serverFieldErrors(body, values);
      if (FIELDS.some((name) => serverErrors[name])) {
        inFlight.current = false;
        setPending(false);
        showFieldErrors(serverErrors);
        return;
      }
    }
    fail({ kind: 'generic', nonce });
  }

  function describedBy(name: Field) {
    return errors[name] ? `${fieldId(name)}-error` : undefined;
  }

  function fieldError(name: Field) {
    const code = errors[name];
    if (!code) return null;
    return (
      <p
        id={`${fieldId(name)}-error`}
        data-error="true"
        className="flex items-start gap-1.5 text-sm font-medium text-danger"
      >
        <AlertIcon className="mt-0.5 size-4" />
        <span>{t(`errors.${code}`)}</span>
      </p>
    );
  }

  const alertText = !formError
    ? null
    : formError.kind === 'tooManyAttempts'
      ? t('errors.tooManyAttempts', { minutes: formError.minutes })
      : t(`errors.${formError.kind}`);

  return (
    <form noValidate onSubmit={onSubmit} aria-busy={pending} className="flex flex-col gap-5">
      {formError ? (
        <div
          key={formError.nonce}
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="flex items-start gap-3 rounded-xl border border-danger/35 bg-tone-danger-bg px-4 py-3 text-sm text-tone-danger-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
        >
          <AlertIcon className="mt-0.5 size-5" />
          <p className="font-medium leading-relaxed">{alertText}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId('email')} className="text-sm font-semibold text-text">
          {t('email')}
        </label>
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M4 7.5l8 5.5 8-5.5" />
          </svg>
          {/* Addresses always read in Latin order (dir=ltr); on an Urdu page the icon sits on the
              right, so the padding is swapped to keep the text clear of it. */}
          <input
            id={fieldId('email')}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            value={values.email}
            onChange={onChange('email')}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy('email')}
            className={`${inputClass} ps-11 pe-4 rtl:ps-4 rtl:pe-11 rtl:text-end`}
          />
        </div>
        {fieldError('email')}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={fieldId('password')} className="text-sm font-semibold text-text">
          {t('password')}
        </label>
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute start-4 top-1/2 size-5 -translate-y-1/2 text-text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
            <path d="M8 10.5V8a4 4 0 018 0v2.5M12 14.5v2" />
          </svg>
          <input
            id={fieldId('password')}
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            spellCheck={false}
            value={values.password}
            onChange={onChange('password')}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={describedBy('password')}
            className={`${inputClass} ps-11 pe-13`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t('hidePassword') : t('showPassword')}
            aria-controls={fieldId('password')}
            aria-pressed={showPassword}
            className="absolute end-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-sunken hover:text-text focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword ? null : <path d="M4 20L20 4" />}
            </svg>
          </button>
        </div>
        {fieldError('password')}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="group mt-1 inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-primary px-6 text-base font-semibold text-primary-contrast shadow-card transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-progress disabled:opacity-80"
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
              strokeWidth="2.5"
            />
            <path
              d="M21 12a9 9 0 00-9-9"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
        <span>{pending ? t('submitting') : t('submit')}</span>
        {pending ? null : (
          <svg
            viewBox="0 0 20 20"
            className="size-5 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 10h11M11 5.5L15.5 10 11 14.5" />
          </svg>
        )}
      </button>
    </form>
  );
}
