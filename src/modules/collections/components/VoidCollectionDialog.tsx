'use client';

import { useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { formatMoney } from '@/platform/i18n/format';
import { voidInputSchema } from '../schema';
import { asErrorCode, readApiFailure, type ErrorCode } from './api-errors';

export interface VoidCollectionDialogProps {
  collectionId: string;
  amount: string;
  /** Small trigger for table rows; the detail page uses the full-size button. */
  compact?: boolean;
}

/** Void with a required reason, behind a destructive confirmation. */
export function VoidCollectionDialog({ collectionId, amount, compact }: VoidCollectionDialogProps) {
  const t = useTranslations('collections');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ErrorCode | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);

  function close() {
    if (inFlight.current) return;
    setOpen(false);
    setError(null);
  }

  async function confirm() {
    if (inFlight.current) return;
    const parsed = voidInputSchema.safeParse({ reason });
    if (!parsed.success) {
      setError(asErrorCode(parsed.error.issues[0]?.message) ?? 'too_short');
      document.getElementById(`${id}-reason`)?.focus();
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/collections/${collectionId}/void`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (response.ok) {
        inFlight.current = false;
        setOpen(false);
        setReason('');
        setDone(true);
        router.refresh();
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const failure = readApiFailure(body, ['reason'] as const);
      setError(failure.fields.reason ?? failure.form ?? 'generic');
    } catch {
      setError('generic');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const description = (
    <span className="flex flex-col gap-4">
      <span className="block">{t('void.body', { amount: formatMoney(amount, locale) })}</span>
      <span className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-reason`} className="text-sm font-semibold text-text">
          {t('void.reason')}
        </label>
        <textarea
          id={`${id}-reason`}
          name="reason"
          rows={3}
          required
          maxLength={500}
          dir="auto"
          value={reason}
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-reason-hint${error ? ` ${id}-reason-error` : ''}`}
          onChange={(event) => {
            setReason(event.target.value);
            if (error) setError(null);
          }}
          className="block w-full resize-y rounded-lg border border-border-strong/50 bg-surface-raised px-3 py-2 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-invalid:border-danger"
        />
        <span id={`${id}-reason-hint`} className="text-xs text-text-muted">
          {t('void.reasonHint')}
        </span>
        {error ? (
          <span
            id={`${id}-reason-error`}
            role="alert"
            className="text-sm font-medium text-tone-danger-fg"
          >
            {t(`errors.${error}`)}
          </span>
        ) : null}
      </span>
    </span>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDone(false);
          setOpen(true);
        }}
        className={
          compact
            ? 'inline-flex h-8 items-center justify-center rounded-lg border border-danger/40 px-3 text-xs font-semibold text-tone-danger-fg transition-colors hover:bg-tone-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger'
            : 'inline-flex h-10 items-center justify-center rounded-lg border border-danger/40 px-4 text-sm font-semibold text-tone-danger-fg transition-colors hover:bg-tone-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger'
        }
      >
        {t('actions.void')}
      </button>
      {done ? (
        <span role="status" className="sr-only">
          {t('void.voided')}
        </span>
      ) : null}
      <ConfirmDialog
        open={open}
        tone="destructive"
        title={t('void.title')}
        description={description}
        confirmLabel={pending ? t('void.sending') : t('void.confirm')}
        cancelLabel={t('form.cancel')}
        onConfirm={() => void confirm()}
        onCancel={close}
      />
    </>
  );
}
