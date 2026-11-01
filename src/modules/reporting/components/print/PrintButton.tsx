'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { PrintKind } from '@/modules/reporting/service-print';

export const PRINT_AUDIT_PATH = '/api/v1/exports/print';

/**
 * Save as PDF: records the print (kind and row count only) and then opens the browser's
 * print dialog, where "Save as PDF" is a destination. If the record cannot be written,
 * nothing is printed and an inline error explains why. Hidden in print.
 */
export function PrintButton({
  kind,
  reportId,
  rowCount,
}: {
  kind: PrintKind;
  reportId?: string;
  rowCount: number;
}) {
  const t = useTranslations('exports.print');
  const [state, setState] = useState<'idle' | 'preparing' | 'error'>('idle');

  async function onClick() {
    if (state === 'preparing') return;
    setState('preparing');
    let ok = false;
    try {
      const response = await fetch(PRINT_AUDIT_PATH, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(reportId ? { kind, reportId, rowCount } : { kind, rowCount }),
      });
      ok = response.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      setState('error');
      return;
    }
    setState('idle');
    window.print();
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end print:hidden">
      <button
        type="button"
        onClick={onClick}
        disabled={state === 'preparing'}
        aria-busy={state === 'preparing'}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-contrast transition-colors hover:bg-primary-hover disabled:cursor-progress disabled:opacity-75"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4.5 6V2.5h7V6M4.5 11.5H3A1.5 1.5 0 0 1 1.5 10V7.5A1.5 1.5 0 0 1 3 6h10a1.5 1.5 0 0 1 1.5 1.5V10a1.5 1.5 0 0 1-1.5 1.5h-1.5M4.5 9.5h7v4h-7z" />
        </svg>
        {state === 'preparing' ? t('preparing') : t('button')}
      </button>
      {state === 'error' ? (
        <p role="alert" className="max-w-xs text-sm text-danger">
          {t('error')}
        </p>
      ) : null}
    </div>
  );
}
