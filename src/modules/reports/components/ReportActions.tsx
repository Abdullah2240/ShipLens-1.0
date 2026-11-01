'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useRouter } from '@/i18n/navigation';
import { formatInt } from '@/platform/i18n/format';
import { returnInputSchema } from '../schema';
import type { ReportAction, ReportStatus } from '../types';
import { asLocale, safeMoney } from './report-format';

export interface ReportActionsProps {
  reportId: string;
  status: ReportStatus;
  /** From the server, for the viewer: the only source of which buttons show. */
  allowedActions: ReportAction[];
  liveCount: number;
  liveAmount: string;
  /** Named in the approve confirmation. */
  branchName?: string;
  /** The total frozen at submission; the approve confirmation quotes it. */
  frozenAmount?: string | null;
  /** More controls after the lifecycle actions, for example a share button. */
  extra?: ReactNode;
}

type DialogKind = 'submit' | 'nil' | 'approve' | 'return';
type Notice = { kind: 'error'; code: ErrorCode } | { kind: 'done' };

const ERROR_CODES = [
  'invalid_transition',
  'self_approval',
  'totals_mismatch',
  'branch_closed',
  'nil_confirmation_required',
  'too_short',
  'too_long',
  'required',
  'generic',
] as const;
type ErrorCode = (typeof ERROR_CODES)[number];

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);

/** The longest return reason the server accepts. */
export const RETURN_REASON_MAX = 500;

type FieldIssue = { path?: unknown; code?: unknown; message?: unknown };

interface Failure {
  status: number;
  code: ErrorCode;
  fields: { path: string; code: ErrorCode }[];
}

/** Reads `{ error: { code, details: { fields } } }`; unknown codes become `generic`. */
function failureOf(status: number, json: unknown): Failure {
  const error = (json as { error?: { code?: unknown; details?: { fields?: unknown } } } | null)
    ?.error;
  const rawFields = Array.isArray(error?.details?.fields)
    ? (error.details.fields as FieldIssue[])
    : [];
  const fields = rawFields.map((field) => ({
    path: typeof field?.path === 'string' ? field.path : '',
    // Our own codes travel in `message`; `code` holds the validator's generic one.
    code: isErrorCode(field?.message)
      ? field.message
      : isErrorCode(field?.code)
        ? field.code
        : ('generic' as const),
  }));
  return { status, code: isErrorCode(error?.code) ? error.code : 'generic', fields };
}

const buttonBase =
  'inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 lg:h-10 lg:w-full lg:flex-none';
const primaryButton = `${buttonBase} bg-primary text-primary-contrast shadow-xs hover:bg-primary-hover`;
const secondaryButton = `${buttonBase} border border-border-strong/60 bg-surface-raised text-text hover:bg-surface-sunken`;

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

function ActionIcon({ action }: { action: ReportAction }) {
  const d =
    action === 'approve'
      ? 'M3.5 8.5l3 3 6-7'
      : action === 'return'
        ? 'M6 4L2.5 7.5 6 11M3 7.5h6.5a3.5 3.5 0 010 7H8'
        : 'M8 12.5V3.5M4 7.5l4-4 4 4';
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-4 shrink-0 ${action === 'return' ? 'rtl:-scale-x-100' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

interface FormDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  pendingLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}

/** A modal form with our own validation messages; same look as `ConfirmDialog`. */
function FormDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  pendingLabel,
  onSubmit,
  onCancel,
  children,
}: FormDialogProps) {
  const common = useTranslations('common.actions');
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      dialog.querySelector<HTMLElement>('textarea, input')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocusTo.current?.focus();
      returnFocusTo.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onCancel();
      }}
      className="m-auto w-[min(92vw,30rem)] rounded-card border border-border bg-surface-raised p-0 text-text shadow-card backdrop:bg-black/50"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) onSubmit();
        }}
      >
        <div className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-2">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <p id={descId} className="text-sm text-text-muted">
              {description}
            </p>
          </div>
          {children}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-sunken p-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-border-strong px-4 py-2 text-sm font-semibold hover:bg-surface disabled:opacity-60"
          >
            {common('cancel')}
          </button>
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending || undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? <Spinner /> : null}
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

const fieldError = 'flex items-start gap-1.5 text-sm font-medium text-tone-danger-fg';

/**
 * Submit, resubmit, return and approve for one report. Shows exactly the server's
 * `allowedActions`; a conflict shows its reason and reloads the page to the current state.
 * A sticky bar at the bottom of the screen on phones, a side panel on wide screens.
 */
export function ReportActions({
  reportId,
  status,
  allowedActions,
  liveCount,
  liveAmount,
  branchName,
  frozenAmount,
  extra,
}: ReportActionsProps) {
  const t = useTranslations('reports');
  const locale = asLocale(useLocale());
  const router = useRouter();
  const id = useId();

  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [pending, setPending] = useState<ReportAction | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [nilConfirmed, setNilConfirmed] = useState(false);
  const [nilError, setNilError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<ErrorCode | null>(null);
  const inFlight = useRef(false);

  const can = (action: ReportAction) => allowedActions.includes(action);
  const hasActions = allowedActions.length > 0;
  if (!hasActions && !extra && !notice) return null;

  const submitLabel = status === 'returned' ? t('actions.resubmit') : t('actions.submit');
  const countPhrase = t('detail.collectionCount', {
    count: liveCount,
    total: formatInt(liveCount, locale),
  });

  function closeDialog() {
    setDialog(null);
    setNilConfirmed(false);
    setNilError(null);
    setReasonError(null);
  }

  async function run(action: ReportAction, body: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    setNotice(null);
    try {
      const response = await fetch(`/api/v1/reports/${reportId}/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: unknown = await response.json().catch(() => null);
      if (response.ok) {
        closeDialog();
        setReason('');
        setNotice({ kind: 'done' });
        router.refresh();
        return;
      }
      const failure = failureOf(response.status, json);
      if (failure.status === 422) {
        const nil = failure.fields.find((f) => f.path === 'confirmNil');
        const why = failure.fields.find((f) => f.path === 'reason');
        if (nil) {
          // The collections changed since the page loaded: ask for the nil confirmation.
          setDialog('nil');
          setNilError(t(`errors.${nil.code}`));
          router.refresh();
          return;
        }
        if (why) {
          setDialog('return');
          setReasonError(why.code);
          return;
        }
      }
      closeDialog();
      setNotice({ kind: 'error', code: failure.status === 422 ? 'generic' : failure.code });
      if (failure.status === 409 || failure.status === 403 || failure.status === 404) {
        router.refresh();
      }
    } catch {
      closeDialog();
      setNotice({ kind: 'error', code: 'generic' });
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function open(kind: DialogKind) {
    setNotice(null);
    setNilConfirmed(false);
    setNilError(null);
    setReasonError(null);
    setDialog(kind);
  }

  function confirmNil() {
    if (!nilConfirmed) {
      setNilError(t('actions.nilRequired'));
      return;
    }
    void run('submit', { confirmNil: true });
  }

  function confirmReturn() {
    const parsed = returnInputSchema.safeParse({ reason });
    if (!parsed.success) {
      const code = parsed.error.issues[0]?.message;
      setReasonError(isErrorCode(code) ? code : 'generic');
      return;
    }
    void run('return', { reason: parsed.data.reason });
  }

  const busy = pending !== null;
  const label = (action: ReportAction, idle: string) =>
    pending === action ? (
      <>
        <Spinner />
        {t('actions.submitting')}
      </>
    ) : (
      <>
        <ActionIcon action={action} />
        {idle}
      </>
    );

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="report-actions"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface-raised/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.35)] backdrop-blur lg:static lg:z-auto lg:rounded-card lg:border lg:bg-surface-raised lg:p-5 lg:shadow-card lg:backdrop-blur-none"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col">
        <h2
          id={`${id}-title`}
          className="sr-only lg:not-sr-only lg:mb-3 lg:text-sm lg:font-semibold lg:text-text"
        >
          {t('actions.title')}
        </h2>

        {/* Live regions stay mounted so screen readers announce what appears in them. */}
        <div role="alert">
          {notice?.kind === 'error' ? (
            <div
              data-notice="error"
              className="mb-3 flex items-start gap-2.5 rounded-lg border border-tone-warning-fg/35 bg-tone-warning-bg px-3 py-2.5 text-sm text-text"
            >
              <svg
                viewBox="0 0 20 20"
                className="mt-0.5 size-4 shrink-0 text-tone-warning-fg"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M10 2.75l8 14.5H2l8-14.5z" strokeLinejoin="round" />
                <path d="M10 8v4" strokeLinecap="round" />
                <circle cx="10" cy="14.6" r="0.6" fill="currentColor" stroke="none" />
              </svg>
              <p className="min-w-0 flex-1">{t(`errors.${notice.code}`)}</p>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="shrink-0 rounded-sm text-xs font-semibold text-tone-warning-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('actions.dismiss')}
              </button>
            </div>
          ) : null}
        </div>

        <div role="status">
          {notice?.kind === 'done' ? (
            <div
              data-notice="done"
              className="mb-3 flex items-start gap-2.5 rounded-lg border border-tone-success-fg/30 bg-tone-success-bg px-3 py-2.5 text-sm text-text"
            >
              <svg
                viewBox="0 0 16 16"
                className="mt-0.5 size-4 shrink-0 text-tone-success-fg"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3.5 8.5l3 3 6-7" />
              </svg>
              <p className="min-w-0 flex-1">{t('actions.done')}</p>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="shrink-0 rounded-sm text-xs font-semibold text-tone-success-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('actions.dismiss')}
              </button>
            </div>
          ) : null}
        </div>

        {hasActions || extra ? (
          <div className="flex flex-wrap gap-2 lg:flex-col" data-testid="report-action-buttons">
            {can('submit') ? (
              <button
                type="button"
                disabled={busy}
                aria-busy={pending === 'submit' || undefined}
                onClick={() => open(liveCount === 0 ? 'nil' : 'submit')}
                className={primaryButton}
              >
                {label('submit', submitLabel)}
              </button>
            ) : null}
            {can('approve') ? (
              <button
                type="button"
                disabled={busy}
                aria-busy={pending === 'approve' || undefined}
                onClick={() => open('approve')}
                className={primaryButton}
              >
                {label('approve', t('actions.approve'))}
              </button>
            ) : null}
            {can('return') ? (
              <button
                type="button"
                disabled={busy}
                aria-busy={pending === 'return' || undefined}
                onClick={() => open('return')}
                className={secondaryButton}
              >
                {label('return', t('actions.return'))}
              </button>
            ) : null}
            {extra}
          </div>
        ) : null}
      </div>

      {can('submit') ? (
        <ConfirmDialog
          open={dialog === 'submit'}
          title={t('actions.confirmSubmitTitle')}
          description={t('actions.confirmSubmitBody', {
            amount: safeMoney(liveAmount, locale),
            count: countPhrase,
          })}
          confirmLabel={submitLabel}
          onConfirm={() => {
            setDialog(null);
            void run('submit', {});
          }}
          onCancel={closeDialog}
        />
      ) : null}

      {can('submit') ? (
        <FormDialog
          open={dialog === 'nil'}
          title={t('actions.nilTitle')}
          description={t('actions.nilBody')}
          confirmLabel={submitLabel}
          pending={pending === 'submit'}
          pendingLabel={t('actions.submitting')}
          onSubmit={confirmNil}
          onCancel={closeDialog}
        >
          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken/60 p-3 text-sm font-medium text-text">
              <input
                type="checkbox"
                name="confirmNil"
                required
                checked={nilConfirmed}
                onChange={(e) => {
                  setNilConfirmed(e.target.checked);
                  if (e.target.checked) setNilError(null);
                }}
                aria-invalid={nilError ? true : undefined}
                aria-describedby={nilError ? `${id}-nil-error` : undefined}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span>{t('actions.nilConfirmLabel')}</span>
            </label>
            {nilError ? (
              <p id={`${id}-nil-error`} className={fieldError}>
                {nilError}
              </p>
            ) : null}
          </div>
        </FormDialog>
      ) : null}

      {can('approve') ? (
        <ConfirmDialog
          open={dialog === 'approve'}
          title={t('actions.confirmApproveTitle')}
          description={t('actions.confirmApproveBody', {
            branch: branchName ?? '',
            amount: safeMoney(frozenAmount ?? liveAmount, locale),
          })}
          confirmLabel={t('actions.approve')}
          onConfirm={() => {
            setDialog(null);
            void run('approve', {});
          }}
          onCancel={closeDialog}
        />
      ) : null}

      {can('return') ? (
        <FormDialog
          open={dialog === 'return'}
          title={t('actions.returnTitle')}
          description={t('actions.returnBody')}
          confirmLabel={t('actions.returnConfirm')}
          pending={pending === 'return'}
          pendingLabel={t('actions.submitting')}
          onSubmit={confirmReturn}
          onCancel={closeDialog}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-reason`} className="text-sm font-semibold text-text">
              {t('actions.returnReasonLabel')}
            </label>
            <textarea
              id={`${id}-reason`}
              name="reason"
              rows={4}
              required
              maxLength={RETURN_REASON_MAX}
              dir="auto"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError(null);
              }}
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={`${id}-reason-hint${reasonError ? ` ${id}-reason-error` : ''}`}
              className="block w-full resize-y rounded-lg border border-border-strong/50 bg-surface-raised px-3 py-2 text-sm text-text shadow-xs transition-colors hover:border-border-strong focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-invalid:border-tone-danger-fg"
            />
            <div className="flex items-start justify-between gap-3">
              <p id={`${id}-reason-hint`} className="text-xs text-text-muted">
                {t('actions.returnReasonHint')}
              </p>
              <span
                dir="ltr"
                aria-hidden="true"
                className="shrink-0 text-xs text-text-muted tabular"
              >
                {formatInt(reason.length, locale)} / {formatInt(RETURN_REASON_MAX, locale)}
              </span>
            </div>
            {reasonError ? (
              <p id={`${id}-reason-error`} className={fieldError}>
                {t(`errors.${reasonError}`)}
              </p>
            ) : null}
          </div>
        </FormDialog>
      ) : null}
    </section>
  );
}
