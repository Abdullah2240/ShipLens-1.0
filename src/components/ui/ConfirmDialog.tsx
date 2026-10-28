'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useTranslations('common.actions');
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const destructive = tone === 'destructive';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusTo.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
      (destructive ? cancelRef : confirmRef).current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocusTo.current?.focus();
      returnFocusTo.current = null;
    }
  }, [open, destructive]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        // Keep the open state owned by the parent: Escape asks, the parent decides.
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onCancel();
      }}
      className="m-auto w-[min(92vw,26rem)] rounded-card border border-border bg-surface-raised p-0 text-text shadow-card backdrop:bg-black/50"
    >
      <div className="flex flex-col gap-2 p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? (
          <p id={descId} className="text-sm text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-surface-sunken p-4">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-border-strong px-4 py-2 text-sm font-semibold hover:bg-surface"
        >
          {cancelLabel ?? t('cancel')}
        </button>
        <button
          ref={confirmRef}
          type="button"
          onClick={onConfirm}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
            destructive
              ? 'bg-danger text-danger-contrast hover:bg-danger-hover'
              : 'bg-primary text-primary-contrast hover:bg-primary-hover'
          }`}
        >
          {confirmLabel ?? t('confirm')}
        </button>
      </div>
    </dialog>
  );
}
