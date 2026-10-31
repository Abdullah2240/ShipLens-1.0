import { useTranslations } from 'next-intl';

export type VerifyFormProps = {
  locale: 'en' | 'ur';
  /** What the visitor typed, shown back as plain text when it was not a code. */
  defaultValue?: string;
  invalid?: boolean;
};

const FIELD_ID = 'verify-code';
const HINT_ID = `${FIELD_ID}-hint`;
const ERROR_ID = `${FIELD_ID}-error`;

/** Longest value the field accepts; the service rejects anything longer as well. */
export const CODE_FIELD_MAX = 32;

// A plain GET form: it submits to the entry page, which normalises the code and redirects
// to the result page, so the check works with JavaScript switched off.
export function VerifyForm({ locale, defaultValue = '', invalid = false }: VerifyFormProps) {
  const t = useTranslations('verify.page');
  const describedBy = invalid ? `${HINT_ID} ${ERROR_ID}` : HINT_ID;

  return (
    <form method="get" action={`/${locale}/verify`} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor={FIELD_ID} className="text-base font-semibold text-text">
          {t('codeLabel')}
        </label>
        <input
          id={FIELD_ID}
          name="code"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          maxLength={CODE_FIELD_MAX}
          required
          defaultValue={defaultValue.slice(0, CODE_FIELD_MAX)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className="block min-h-14 w-full rounded-xl border border-border-strong bg-surface px-4 py-3 text-center font-mono text-xl font-semibold tracking-[0.18em] text-text uppercase shadow-xs transition-colors hover:border-text-muted focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-invalid:border-danger aria-invalid:bg-tone-danger-bg/30"
        />
        <p id={HINT_ID} className="text-sm text-text-muted">
          {t('codeHint')}
        </p>
        {invalid ? (
          <p id={ERROR_ID} className="flex items-start gap-1.5 text-sm font-medium text-danger">
            <svg
              viewBox="0 0 20 20"
              className="mt-0.5 size-4 shrink-0"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm-.75 4.5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zM10 14.75a1 1 0 110-2 1 1 0 010 2z" />
            </svg>
            <span>{t('invalid')}</span>
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-contrast shadow-card transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l7 3v5c0 4.5-3 8.4-7 10-4-1.6-7-5.5-7-10V6l7-3zM9 12l2.2 2.2L15.5 10" />
        </svg>
        {t('submit')}
      </button>
    </form>
  );
}
